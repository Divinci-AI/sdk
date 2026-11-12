import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { SIGNED_IN_ONLY } from "./trust-auth.js";

/**
 * divinci qa publish-to-trust-batch <suiteId> --run <runResultId> --scorer <key> [--release <id>...]
 *
 * Sign every release x RAG-group row of one multi-release run as a PRIVATE
 * TrustBench run, pinned to that run's answers: what fills the workspace's
 * private board (`divinci trust benchmarks board`). Rows that cannot be signed
 * are listed with the reason; the rest are still signed. Bounded by a
 * per-workspace signing rate (50/hour), refused up front if exceeded.
 */
export function registerQAPublishToTrustBatchCommand(parent: Command): void {
  parent
    .command("publish-to-trust-batch <suiteId>")
    .description("Sign every release row of a run as a private TrustBench run (pinned to that run)")
    .requiredOption("--run <runResultId>", "The multi-release run whose rows to sign")
    .requiredOption("--scorer <scorerKey>", "Scorer key to aggregate (e.g. llm-factual)")
    .option("--release <releaseId...>", "Only these releases' rows (default: every row)")
    .option("--new-version", "The suite changed since its benchmark's current version: sign against the next version", false)
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        if (!config.accessToken) throw new Error(SIGNED_IN_ONLY);
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const body = {
          runResultId: opts.run as string,
          scorerKey: opts.scorer as string,
          ...(Array.isArray(opts.release) && opts.release.length ? { releaseIds: opts.release as string[] } : {}),
          ...(opts.newVersion ? { newVersion: true } : {}),
        };
        const result = await withSpinner("Signing rows…", async () => {
          const res = await fetch(`${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${encodeURIComponent(suiteId)}/publish-to-trust/batch`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          let data: { signed?: number; alreadySigned?: number; refused?: number; results?: Array<Record<string, unknown>>; message?: string };
          try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response (${res.status}): ${text.substring(0, 200)}`); }
          if (!res.ok && !Array.isArray(data.results)) throw new Error(`HTTP ${res.status}: ${data.message ?? text.substring(0, 300)}`);
          return data;
        });
        if (!globalOpts.json) {
          console.warn(`\nSigned ${result.signed ?? 0}, already signed ${result.alreadySigned ?? 0}, refused ${result.refused ?? 0} (all private).`);
        }
        output(globalOpts.json ? result : (result.results ?? []), {
          table: {
            columns: [
              { key: "releaseId", header: "RELEASE" },
              { key: "ragGroupId", header: "GROUP" },
              { key: "status", header: "STATUS" },
              { key: "trustRunId", header: "RUN" },
              { key: "reason", header: "REASON" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
