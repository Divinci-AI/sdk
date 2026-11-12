import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken, getWebUrl } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel } from "../../output/safe-text.js";

/**
 * List persisted run results for a suite, newest first.
 * Uses the internal endpoint directly (same pattern as multi-release-run)
 * to avoid SDK version skew during active development.
 */
/** Milliseconds as "4.1s" (or "280ms" under a second); null when not a number. */
export function formatDurationMs(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One release row's timing: median answer time (retrieval + generation, what a
 * user waits for), its retrieval part, and the per-test time including scoring.
 * null when the row recorded none of them.
 */
export function formatRowTiming(rel: {
  medianAnswerMs?: number | null;
  medianRetrievalMs?: number | null;
  medianLatencyMs?: number | null;
}): string | null {
  const parts: string[] = [];
  const answer = formatDurationMs(rel.medianAnswerMs);
  const retrieval = formatDurationMs(rel.medianRetrievalMs);
  const total = formatDurationMs(rel.medianLatencyMs);
  if (answer) parts.push(`answer=${answer}`);
  if (retrieval) parts.push(`retrieval=${retrieval}`);
  if (total) parts.push(`with-scoring=${total}`);
  return parts.length > 0 ? `${parts.join("  ")}  (medians)` : null;
}

export function registerQARunsListCommand(parent: Command): void {
  parent
    .command("list <suiteId>")
    .alias("ls")
    .description("List run history for a QA suite (newest first)")
    .option("-n, --limit <n>", "Max results to show", "20")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const limit = parseInt(opts.limit, 10);
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}/runs?limit=${limit}`;

        const data = await withSpinner("Fetching run history...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as any; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        const runs = data?.runs ?? [];
        if (runs.length === 0) {
          // eslint-disable-next-line no-console
          console.log("No run results found for this suite.");
          return;
        }

        output(runs, {
          table: {
            columns: [
              { key: "_id", header: "Run ID" },
              { key: "status", header: "Status" },
              {
                key: "summary",
                header: "Avg Score",
                format: (v: any) => (v?.avgScore !== null && v?.avgScore !== undefined ? `${Math.round(v.avgScore * 100)}%` : "—"),
              },
              {
                key: "summary",
                header: "Tests",
                format: (v: any) => (v?.testCount !== undefined ? String(v.testCount) : "—"),
              },
              {
                key: "summary",
                header: "Releases",
                format: (v: any) => (v?.releaseCount !== undefined ? String(v.releaseCount) : "—"),
              },
              {
                key: "startedAt",
                header: "Started",
                format: (v: any) => (v ? new Date(v).toLocaleString() : "—"),
              },
            ],
          },
        });

        const webUrl = getWebUrl(config);
        if (webUrl && config.workspaceId) {
          // eslint-disable-next-line no-console
          console.log(`\nView in browser: ${webUrl}/white-label/${config.workspaceId}/scored-qa/suites/${suiteId}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}

/**
 * Get a specific run result with full per-test scoring breakdown and
 * per-scorer reasoning. Use this as the primary debugging tool for low scores.
 */
export function registerQARunsGetCommand(parent: Command): void {
  parent
    .command("get <runResultId>")
    .description("Get a run result with per-test scores and scorer reasoning")
    .option("--markdown", "Print the Markdown report instead of the structured breakdown")
    .option("--json", "Output raw JSON")
    .option("--min-score <n>", "Only show tests scoring below this threshold (0-1)", "1")
    .action(async (runResultId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/runs/${runResultId}`;

        const data = await withSpinner("Fetching run result...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as any; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        const run = data?.run;
        if (!run) throw new Error("No run data in response");

        // Raw JSON mode
        if (opts.json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(run, null, 2));
          return;
        }

        // Markdown mode
        if (opts.markdown && run.markdown) {
          // eslint-disable-next-line no-console
          console.log(run.markdown);
          return;
        }

        const report = run.report;
        if (!report) {
          // eslint-disable-next-line no-console
          console.log(`Status: ${run.status}. Report not yet available.`);
          return;
        }

        // Header summary
        // eslint-disable-next-line no-console
        console.log(`\n── Run ${runResultId.slice(0, 12)}… ─────────────────────────────`);
        // eslint-disable-next-line no-console
        console.log(`Status: ${run.status}  |  Started: ${new Date(run.startedAt).toLocaleString()}`);
        // eslint-disable-next-line no-console
        console.log("");

        // Per-release summary
        for (const rel of (report.perRelease ?? [])) {
          const score = rel.overallScore !== null ? `${Math.round(rel.overallScore * 100)}%` : "—";
          // eslint-disable-next-line no-console
          console.log(`  ${safeLabel(rel.title ?? rel.releaseId.slice(0, 12))}  overall=${score}  passed=${rel.passedCount}/${rel.testCount}`);
          const timing = formatRowTiming(rel);
          if (timing) {
            // eslint-disable-next-line no-console
            console.log(`    timing: ${timing}`);
          }
          const scorerKeys = Object.keys(rel.scoreAverages ?? {});
          if (scorerKeys.length > 0) {
            const detail = scorerKeys
              .map(k => `${k.replace(/^llm-/, "")}=${Math.round(rel.scoreAverages[k] * 100)}%`)
              .join("  ");
            // eslint-disable-next-line no-console
            console.log(`    scorers: ${detail}`);
          }
        }

        // Ranking
        const ranking = report.ranking?.byOverallScore ?? [];
        if (ranking.length > 1) {
          // eslint-disable-next-line no-console
          console.log(`\n  Ranking: ${ranking.map((r: any) => `#${r.rank} ${r.releaseId.slice(0, 8)} (${r.overallScore !== null ? Math.round(r.overallScore * 100) + "%" : "—"})`).join(" → ")}`);
        }

        // Per-test breakdown (filtered by --min-score)
        const minScore = parseFloat(opts.minScore);
        const primaryReleaseId = report.perRelease?.[0]?.releaseId;
        const tests = (report.perTest ?? [])
          .filter((t: any) => {
            if (!primaryReleaseId) return true;
            const s = t.scoresByRelease?.[primaryReleaseId];
            return s === null || s === undefined || s < minScore;
          })
          .sort((a: any, b: any) => {
            const as = a.scoresByRelease?.[primaryReleaseId] ?? 1;
            const bs = b.scoresByRelease?.[primaryReleaseId] ?? 1;
            return as - bs;
          });

        if (tests.length === 0) {
          // eslint-disable-next-line no-console
          console.log(`\n  All tests scored ≥ ${Math.round(minScore * 100)}%`);
          return;
        }

        const threshold = minScore < 1 ? ` scoring < ${Math.round(minScore * 100)}%` : "";
        // eslint-disable-next-line no-console
        console.log(`\n── Per-test breakdown${threshold} (${tests.length} test${tests.length !== 1 ? "s" : ""}) ──────────────────`);

        for (const test of tests) {
          const promptSnippet = (test.prompt || "").replace(/\s+/g, " ").slice(0, 100);
          const score = primaryReleaseId
            ? (test.scoresByRelease?.[primaryReleaseId] !== null && test.scoresByRelease?.[primaryReleaseId] !== undefined
              ? `${Math.round(test.scoresByRelease[primaryReleaseId] * 100)}%`
              : "—")
            : "—";
          // eslint-disable-next-line no-console
          console.log(`\n  [${score}] ${promptSnippet}${test.prompt?.length > 100 ? "…" : ""}`);

          // Per-scorer reasoning for each release
          for (const rel of (report.perRelease ?? [])) {
            const detail = test.scoreDetailByRelease?.[rel.releaseId];
            if (!detail) continue;
            const relLabel = rel.title ?? rel.releaseId.slice(0, 8);
            for (const [scoreId, entry] of Object.entries(detail) as [string, any][]) {
              const scorerName = scoreId.replace(/^llm-/, "");
              const scorePct = `${Math.round(entry.score * 100)}%`;
              // eslint-disable-next-line no-console
              console.log(`    ${relLabel} / ${scorerName}: ${scorePct}`);
              if (entry.reasoning) {
                // Wrap long reasoning at 100 chars, indent
                const lines = entry.reasoning.match(/.{1,100}(\s|$)/g) ?? [entry.reasoning];
                for (const line of lines) {
                  // eslint-disable-next-line no-console
                  console.log(`      ${line.trim()}`);
                }
              }
            }
          }
        }

        const webUrl = getWebUrl(config);
        if (webUrl && config.workspaceId) {
          const suiteId = run.report?.suiteId ?? run.suiteId;
          if (suiteId) {
            // eslint-disable-next-line no-console
            console.log(`View in browser: ${webUrl}/white-label/${config.workspaceId}/scored-qa/suites/${suiteId}/runs/${runResultId}`);
          }
        }
        // eslint-disable-next-line no-console
        console.log("");
      } catch (error) {
        handleCommandError(error);
      }
    });
}

/**
 * Cancel a running multi-release-run. Idempotent — calling on a run already
 * in a terminal state returns 200 with a no-op message. Worker honors the
 * cancel between concurrency batches (~6s response time after the call).
 */
export function registerQARunsCancelCommand(parent: Command): void {
  parent
    .command("cancel <runResultId>")
    .description("Cancel a running multi-release-run (eject — kills the worker between batches, ~6s response)")
    .option("--reason <reason>", "Optional free-text reason for the cancel (audit trail)")
    .action(async (runResultId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/runs/${runResultId}/cancel`;

        const body: Record<string, unknown> = {};
        if (opts.reason) body.reason = opts.reason;

        const data = await withSpinner("Cancelling run...", async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as { run: { _id: string; status: string }; cancelled: boolean; reason: string | null }; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        if (data.cancelled) {
          // eslint-disable-next-line no-console
          console.log(`✓ Cancellation request landed. Worker will exit on its next between-batch check (~6s).`);
          // eslint-disable-next-line no-console
          console.log(`  Run ID: ${data.run._id}`);
          // eslint-disable-next-line no-console
          console.log(`  Status: ${data.run.status}`);
          if (data.reason) {
            // eslint-disable-next-line no-console
            console.log(`  Reason: ${data.reason}`);
          }
        } else {
          // eslint-disable-next-line no-console
          console.log(`ℹ Run already in terminal state: ${data.run.status}. No-op.`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
