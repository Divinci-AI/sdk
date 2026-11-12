import { Command } from "commander";
import { isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustGet, trustPost, sleep } from "./_client.js";

interface CreatedRun {
  runId: string;
  status: string;
  estimatedDurationSec?: number;
  estimatedCostCents?: number;
  pollUrl?: string;
}

interface RunDoc {
  runId: string;
  status: string;
  score?: number;
  benchmarkId?: string;
  benchmarkVersion?: string;
  modelAssistantId?: string;
  visibility?: string;
  manifestR2Key?: string;
  metadata?: { durationMs?: number; errorMessage?: string; errorCode?: string };
}

const TERMINAL = new Set(["complete", "failed", "canceled"]);

function printJson(data: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(data, null, 2));
}

function printRunSummary(run: RunDoc): void {
  const statusColor =
    run.status === "complete"
      ? colors.green
      : run.status === "failed" || run.status === "canceled"
        ? colors.red
        : colors.yellow;
  // eslint-disable-next-line no-console
  console.log(
    `${colors.cyanBold(run.runId)}  ${statusColor(run.status)}` +
      (typeof run.score === "number" ? `  ${colors.bold(`score ${run.score}`)}` : "")
  );
  const detail: string[] = [];
  if (run.benchmarkId) detail.push(`benchmark=${run.benchmarkId}@${run.benchmarkVersion ?? "?"}`);
  if (run.modelAssistantId) detail.push(`model=${run.modelAssistantId}`);
  if (run.metadata?.durationMs) detail.push(`${Math.round(run.metadata.durationMs / 1000)}s`);
  if (run.visibility) detail.push(run.visibility);
  if (detail.length) {
    // eslint-disable-next-line no-console
    console.log(colors.dim(`  ${detail.join("  ·  ")}`));
  }
  if (run.manifestR2Key) {
    // eslint-disable-next-line no-console
    console.log(colors.dim(`  verify: divinci trust verify ${run.runId}`));
  }
  if (run.status === "failed" && run.metadata?.errorMessage) {
    // eslint-disable-next-line no-console
    console.log(colors.red(`  ${run.metadata.errorCode ?? "error"}: ${run.metadata.errorMessage}`));
  }
}

export function registerTrustRunCommand(parent: Command): void {
  parent
    .command("run <benchmark>")
    .description(
      "Run a TrustBench benchmark against a Divinci model assistant (produces a cryptographically signed run log)"
    )
    .requiredOption(
      "--model <assistant-id>",
      "Divinci assistantTool id to evaluate"
    )
    .option("--whitelabel <id>", "Whitelabel ownership context")
    .option("--public", "Publish the run to the public registry", false)
    .option(
      "--acknowledge-prompts-public",
      "Required with a public publish of a workspace benchmark: confirms the suite's questions, the answers and the judge's reasoning become readable by anyone, permanently",
      false,
    )
    .option("--no-wait", "Return immediately rather than polling to completion")
    .option("--timeout <seconds>", "Polling timeout in seconds", "600")
    .option("--output <fmt>", "Output format: json | table", "table")
    .action(async (benchmark: string, opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const asJson = isJsonMode() || opts.output === "json";

        const body: Record<string, unknown> = {
          benchmarkId: benchmark,
          modelAssistantId: opts.model,
          visibility: opts.public ? "public" : "private",
        };
        if (opts.whitelabel) body.whitelabelId = opts.whitelabel;
        if (opts.acknowledgePromptsPublic) body.acknowledgePromptsPublic = true;

        const created = await withSpinner("Submitting run...", () =>
          trustPost<CreatedRun>(http, "/v1/trustbench/runs", body, {
            "X-Trustbench-Surface": "cli",
          })
        );

        // commander maps --no-wait to opts.wait === false (default true).
        if (opts.wait === false) {
          if (asJson) {
            printJson(created);
            return;
          }
          // eslint-disable-next-line no-console
          console.log(
            `${colors.green("✔")} Run submitted: ${colors.cyanBold(created.runId)} ${colors.dim(`(${created.status})`)}`
          );
          // eslint-disable-next-line no-console
          console.log(
            colors.dim(
              `Track: divinci trust list  ·  verify later: divinci trust verify ${created.runId}`
            )
          );
          return;
        }

        const timeoutSec = Number.parseInt(opts.timeout, 10) || 600;
        const deadline = Date.now() + timeoutSec * 1000;
        const final = await withSpinner("Running benchmark...", async () => {
          // Poll the run until it reaches a terminal state or the timeout.
          // No server-side wait endpoint exists — this loop is CLI-side.
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const res = await trustGet<{ run: RunDoc }>(
              http,
              `/v1/trustbench/runs/${encodeURIComponent(created.runId)}`
            );
            if (TERMINAL.has(res.run.status)) return res.run;
            if (Date.now() >= deadline) {
              throw new Error(
                `Timed out after ${timeoutSec}s — run ${created.runId} is still "${res.run.status}". ` +
                  `It keeps running server-side; check later with: divinci trust list`
              );
            }
            await sleep(3000);
          }
        });

        if (asJson) {
          printJson(final);
          return;
        }
        printRunSummary(final);
        if (final.status !== "complete") {
          process.exitCode = 1;
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
