import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * Arena-style multi-release QA: run the same suite against N releases and
 * print a comparison report.
 *
 * Uses the internal `/white-label/:id/scored-qa/suites/:suiteId/multi-release-run`
 * endpoint directly because (a) LLM runs are long (minutes) and the SDK
 * doesn't know to extend the default timeout, and (b) we want the Markdown
 * rendering back inline.
 */
/** Statuses after which polling a run can learn nothing more. */
export const TERMINAL_RUN_STATUSES = new Set(["complete", "error", "cancelled", "failed", "orphaned"]);

export interface RunOutcome {
  /** What to do after this pass. */
  action: "done" | "resume" | "stop";
  /** Tests this pass left without a scored answer (errors + never started). */
  unfinished: number;
  reason: string;
}

/**
 * Decide what follows a finished pass.
 *
 * A pass ends with tests unscored for two common reasons, and `--resume` fixes
 * both: the 30-minute overall cap (RAG race take 11, 2026-10-04: 19 of 86 tests
 * never started at ~2 min/test, concurrency 4) and an orphaned run — the API
 * instance was replaced by a deploy, which takes out any long run
 * (notes/KNOWN-GAPS.yaml `multi-release-qa-runs-die-on-every-prod-deploy`).
 * Resume carries every scored answer and runs only what is missing, so it is
 * safe to repeat; it stops once a pass makes no progress, because errors that
 * reproduce every time (a broken retriever) would otherwise loop.
 */
export function decideRunOutcome(
  run: { status?: string, variantErrors?: Array<{ errorCount?: number }> },
  previousUnfinished: number | null,
  resumesLeft: number,
): RunOutcome {
  const unfinished = (run.variantErrors ?? []).reduce((n, v) => n + (v.errorCount ?? 0), 0);
  if (run.status === "cancelled") return { action: "done", unfinished, reason: "run was cancelled" };
  const orphaned = run.status === "orphaned";
  if (!orphaned && unfinished === 0) return { action: "done", unfinished, reason: "every test scored" };
  const why = orphaned ? "the run was orphaned (its API instance went away)" : `${unfinished} test(s) unscored`;
  if (resumesLeft <= 0) return { action: "stop", unfinished, reason: why };
  if (!orphaned && previousUnfinished !== null && unfinished >= previousUnfinished) {
    return { action: "stop", unfinished, reason: `${why}, and the last resume finished none of them` };
  }
  return { action: "resume", unfinished, reason: why };
}

export function registerQAMultiReleaseRunCommand(parent: Command): void {
  parent
    .command("multi-release-run <suiteId>")
    .description("Run a QA suite against multiple releases and print a comparison report")
    .requiredOption("-r, --release <id...>", "Release IDs to run against (pass flag multiple times or space-separate)")
    .option("-g, --rag-group <id...>", "RAG group IDs to sweep (same release × each group)")
    .option("-m, --max-tests <n>", "Cap tests per release (default: all suite tests up to 500)")
    .option("-c, --concurrency <n>", "Per-release test concurrency", "3")
    .option("--per-test-timeout-ms <ms>", "Per-test timeout in ms", "180000")
    .option("--overall-timeout-ms <ms>", "Overall wall-clock budget per release in ms", "600000")
    .option("--resume <runId>", "Finish an earlier run's passes instead of starting new ones: carries every scored answer and runs only the tests that run is missing or left unscored. Pass the same releases and RAG groups it had.")
    .option("--auto-resume <n>", "Resume automatically, up to n times, while tests are left unscored (overall-timeout cap, or a deploy orphaning the run). Stops when a resume finishes nothing new.", "0")
    .option("--markdown", "Print the Markdown report instead of JSON")
    .option("--http-timeout-ms <ms>", "HTTP client timeout in ms (raise for large suites)", "7200000")
    .option("--confirm-cost", "Acknowledge estimated cost ≥ hard-confirm threshold ($10). Server rejects without this when the dry-run estimate is over the threshold; use `divinci qa estimate-run` first to see the cost.")
    .option("--judge <toolId>", "Judge model override. Default is gemini-3.5-flash (batch-eligible, $1.50/$9.00 per M tokens). Other batch-eligible: gemini-2.5-flash ($0.15/$0.60 per M), gemini-3.1-flash-lite-preview ($0.25/$1.50 per M). Non-batch: gemini-3.1-pro-preview ($2.00/$12.00 per M, ≤200K).")
    .option(
      "--batch-mode <mode>",
      "Gemini Batch API routing: 'auto' (default — opt in when totalScorerCalls >= --batch-threshold and all scorers are batch-eligible), 'force' (always try batch), 'never' (always sync). Batch is 50% off list and async (5-30 min).",
      "auto",
    )
    .option(
      "--batch-threshold <n>",
      "Minimum total scorer calls (items × scorers) for 'auto' batch mode to engage. Default 500.",
      "500",
    )
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const releaseIds: string[] = Array.isArray(opts.release) ? opts.release : [opts.release];
        const ragGroupIds: string[] | undefined = opts.ragGroup
          ? (Array.isArray(opts.ragGroup) ? opts.ragGroup : [opts.ragGroup])
          : undefined;
        // Validate --batch-mode value — commander accepts any string for
        // free-form options; surface the typo early so the user doesn't see
        // it as a confusing server 400.
        const validBatchModes = ["auto", "force", "never"] as const;
        type BatchMode = typeof validBatchModes[number];
        const batchMode = String(opts.batchMode ?? "auto") as BatchMode;
        if (!validBatchModes.includes(batchMode)) {
          throw new Error(`Invalid --batch-mode '${opts.batchMode}'. Expected one of: ${validBatchModes.join(", ")}.`);
        }
        const batchThreshold = parseInt(opts.batchThreshold ?? "500", 10);
        if (!Number.isFinite(batchThreshold) || batchThreshold < 1) {
          throw new Error(`Invalid --batch-threshold '${opts.batchThreshold}'. Must be a positive integer.`);
        }

        const body: Record<string, unknown> = {
          releaseIds,
          // Only forward when user specified; otherwise let the server
          // default to "all tests in the suite, up to 500".
          maxTestsPerRelease: opts.maxTests !== undefined ? parseInt(opts.maxTests, 10) : undefined,
          concurrency: parseInt(opts.concurrency, 10),
          perTestTimeoutMs: parseInt(opts.perTestTimeoutMs, 10),
          overallTimeoutMs: parseInt(opts.overallTimeoutMs, 10),
          includeMarkdown: !!opts.markdown,
          batchMode,
          batchThreshold,
          ...(opts.judge ? { judgeModelOverride: String(opts.judge) } : {}),
          ...(ragGroupIds ? { ragGroupIds } : {}),
          ...(opts.confirmCost ? { confirmCost: true } : {}),
          ...(opts.resume ? { resumeRunId: String(opts.resume) } : {}),
        };

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}/multi-release-run`;
        const pollUrl = (runResultId: string) =>
          `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/runs/${runResultId}`;

        const variantCount = ragGroupIds ? releaseIds.length * ragGroupIds.length : releaseIds.length;

        const kickoff = async (resumeRunId: string | undefined): Promise<any> => withSpinner(
          resumeRunId
            ? `Resuming run ${resumeRunId}...`
            : ragGroupIds
              ? `Queuing ${releaseIds.length} release(s) × ${ragGroupIds.length} RAG group(s) = ${variantCount} variants...`
              : `Queuing suite across ${releaseIds.length} release(s)...`,
          async () => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}` },
              body: JSON.stringify(resumeRunId ? { ...body, resumeRunId } : body),
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
            try { return JSON.parse(text) as any; }
            catch { throw new Error(`Non-JSON response (status ${res.status}): ${text.substring(0, 200)}`); }
          },
        );

        const maxPollMs = parseInt(opts.httpTimeoutMs, 10);
        const poll = async (runResultId: string): Promise<{ run: any, orphanReason?: string } | null> => {
          const pollStart = Date.now();
          while (Date.now() - pollStart < maxPollMs) {
            await new Promise(r => setTimeout(r, 8_000));
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            process.stderr.write(`\r  Waiting... ${elapsed}s elapsed`);
            const res = await fetch(pollUrl(runResultId), {
              headers: { Authorization: `Bearer ${config.accessToken}` },
            });
            if (!res.ok) continue;
            const text = await res.text();
            try {
              const parsed = JSON.parse(text);
              const run = parsed?.run ?? parsed;
              if (TERMINAL_RUN_STATUSES.has(run.status)) {
                process.stderr.write("\n");
                return { run, orphanReason: parsed?.orphanReason };
              }
            } catch { /* keep polling */ }
          }
          return null;
        };

        let resumesLeft = Math.max(0, parseInt(opts.autoResume ?? "0", 10) || 0);
        let resumeFrom: string | undefined = opts.resume ? String(opts.resume) : undefined;
        let previousUnfinished: number | null = null;
        let data: any = null;
        let runResultId = "";
        for (;;) {
          const kicked = await kickoff(resumeFrom);
          runResultId = kicked.runResultId;
          if (!runResultId) {
            output(kicked, { keyValue: true });
            return;
          }
          console.warn(`  Run ID: ${runResultId} — polling for completion...`);
          const polled = await poll(runResultId);
          if (!polled) {
            console.warn(`\nRun ${runResultId} still running after ${Math.round(maxPollMs / 60000)}min. Check later:`);
            console.warn(`  divinci qa runs get ${suiteId} ${runResultId}`);
            return;
          }
          data = polled.run;
          const outcome = decideRunOutcome(data, previousUnfinished, resumesLeft);
          if (outcome.action === "resume") {
            console.warn(`  ↻ ${outcome.reason} — resuming (${resumesLeft} auto-resume(s) left)`);
            resumesLeft -= 1;
            // An orphaned pass reports no error counts, so it says nothing
            // about progress; only a finished pass's count is a baseline.
            previousUnfinished = data.status === "orphaned" ? null : outcome.unfinished;
            resumeFrom = runResultId;
            continue;
          }
          if (outcome.action === "stop") {
            if (polled.orphanReason) console.warn(`  ${polled.orphanReason}`);
            const flags = [
              ...releaseIds.map((r) => `-r ${r}`),
              ...(ragGroupIds ?? []).map((g) => `-g ${g}`),
            ].join(" ");
            console.warn(`  ⚠ ${outcome.reason}. Finish it with:`);
            console.warn(`    divinci qa multi-release-run ${suiteId} ${flags} --resume ${runResultId}`);
          }
          break;
        }

        if (data?.status === "orphaned") {
          // No report to print: the run never finished. Non-zero so scripts
          // stop polling a dead run (KNOWN-GAPS multi-release-qa-runs-die-on-every-prod-deploy).
          process.exitCode = 1;
          return;
        }

        if (opts.markdown && data?.markdown) {
          // eslint-disable-next-line no-console
          console.log(data.markdown);
        } else {
          output(data.report, { keyValue: true });
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
