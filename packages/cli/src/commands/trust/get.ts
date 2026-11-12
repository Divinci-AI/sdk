import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustGet } from "./_client.js";

interface RunDetail {
  runId: string;
  status: string;
  score?: number;
  benchmarkId?: string;
  benchmarkVersion?: string;
  modelAssistantId?: string;
  modelProviderId?: string;
  modelId?: string;
  visibility?: string;
  createdAt?: string;
  completedAt?: string;
  manifestR2Key?: string;
  signerKeyId?: string;
  metadata?: Record<string, unknown>;
}

/** GET /v1/trustbench/runs/:id answers `{ run, benchmark?, access? }`, never a bare run. */
interface RunEnvelope {
  run?: RunDetail;
  benchmark?: { bmId?: string; slug?: string; name?: string; version?: string };
}

/** The run inside the envelope. A bare run is accepted too, so an older or newer server never prints `undefined`. */
export function runFromResponse(data: RunEnvelope | RunDetail): RunDetail {
  const wrapped = (data as RunEnvelope).run;
  if (wrapped && typeof wrapped === "object") return wrapped;
  if (typeof (data as RunDetail).runId === "string") return data as RunDetail;
  throw new Error("Unexpected response from /v1/trustbench/runs/:id: no run in the body");
}

/**
 * `divinci trust get <runId>` — one run, in full.
 *
 * MCP had `trust_get_run` and the CLI had only `list`, so the CLI could not
 * answer "why did this run fail?" — the reason lives in `metadata.errorMessage`,
 * which the list table has no room for. That gap is not academic: a red-team
 * run refused for rate limiting and one refused for a dead credential are both
 * a bare `failed` in the list, and telling them apart decides whether you
 * retry or go fix a key.
 */
export function registerTrustGetCommand(parent: Command): void {
  parent
    .command("get <runId>")
    .description("Show one TrustBench run in full, including its failure reason")
    .action(async (runId: string, _opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const data = await withSpinner("Fetching run...", () =>
          trustGet<RunEnvelope | RunDetail>(http, `/v1/trustbench/runs/${encodeURIComponent(runId)}`)
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const run = runFromResponse(data);
        const bench = (data as RunEnvelope).benchmark;
        const line = (k: string, v: unknown) => {
          if (v === undefined || v === null || v === "") return;
          // eslint-disable-next-line no-console
          console.log(`  ${colors.dim(k.padEnd(16))}${String(v)}`);
        };
        // eslint-disable-next-line no-console
        console.log(`\n${colors.bold(run.runId)}  ${run.status}`);
        line("score", run.score);
        line("benchmark", run.benchmarkId && `${bench?.slug ?? run.benchmarkId} v${run.benchmarkVersion ?? bench?.version ?? "?"}`);
        line("benchmark id", bench?.slug ? run.benchmarkId : undefined);
        line("name", bench?.name);
        line("model", run.modelAssistantId);
        line("attributed", run.modelProviderId && `${run.modelProviderId}/${run.modelId}`);
        line("visibility", run.visibility);
        line("created", run.createdAt);
        line("completed", run.completedAt);
        line("signer", run.signerKeyId);
        line("manifest", run.manifestR2Key);

        // The reason a run failed is the whole point of this command.
        const meta = run.metadata ?? {};
        const err = meta.errorMessage;
        if (typeof err === "string" && err) {
          // eslint-disable-next-line no-console
          console.log(`\n${colors.bold("failure")}\n  ${err.replace(/\n/g, "\n  ")}`);
          if (meta.errorCode) {
            // eslint-disable-next-line no-console
            console.log(colors.dim(`  code: ${String(meta.errorCode)}`));
          }
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
