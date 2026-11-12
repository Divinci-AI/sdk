import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { SIGNED_IN_ONLY } from "./trust-auth.js";

/**
 * divinci qa publish-to-trust <suiteId> --release <id> --scorer <key> [--rag-group <id>] [--public]
 *
 * Publish an existing ScoredQA run as a signed TrustBench TrustRun manifest:
 * aggregates scores[scorerKey] across the suite's tests for the given release,
 * signs the manifest (Ed25519), and writes it to R2. Returns 202 with a
 * trustRunId + verifyUrl. Defaults to private; pass --public to make it
 * publicly verifiable.
 *
 * Only answers served by ONE RAG group are published — the release's own group
 * unless --rag-group names another (e.g. one swept with
 * `qa multi-release-run -g`) — and each test contributes its latest answer.
 *
 * Closes a W3.9 CLI/SDK coverage gap — TrustBench publishing previously had no
 * CLI or SDK reach despite being a v1 product capability.
 */
export function registerQAPublishToTrustCommand(parent: Command): void {
  parent
    .command("publish-to-trust <suiteId>")
    .description("Publish a ScoredQA run as a signed TrustBench TrustRun manifest")
    .requiredOption("--release <releaseId>", "Release whose scored results to publish")
    .requiredOption("--scorer <scorerKey>", "Scorer key to aggregate (e.g. llm-relevance)")
    .option(
      "--rag-group <groupId>",
      "RAG group whose answers to publish (default: the release's own group). Use for results from multi-release-run -g",
    )
    .option("--public", "Make the TrustRun publicly verifiable (default: private)", false)
    .option(
      "--acknowledge-prompts-public",
      "Required with a public publish of a workspace benchmark: confirms the suite's questions, the answers and the judge's reasoning become readable by anyone, permanently",
      false,
    )
    .option(
      "--run <runResultId>",
      "Publish exactly this multi-release run's answers (no fills from other passes). Default: the latest answer per test",
    )
    .option(
      "--allow-degraded-retrieval",
      "Publish even though retrieval failed on some answers (refused by default; the override is signed into the outputs)",
      false,
    )
    .option(
      "--new-version",
      "The suite changed since its benchmark's current version: publish as the next version (v2, v3, …), a new board that starts empty",
      false,
    )
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        if (!config.accessToken) throw new Error(SIGNED_IN_ONLY);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        // Internal white-label route (OAuth/session auth), matching the sibling
        // qa commands — NOT the api-key-only /api/v1 surface.
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${encodeURIComponent(suiteId)}/publish-to-trust`;

        const body = {
          releaseId: opts.release,
          scorerKey: opts.scorer,
          visibility: opts.public ? "public" : "private",
          ...(opts.ragGroup ? { ragVectorGroupId: opts.ragGroup as string } : {}),
          ...(opts.run ? { runResultId: opts.run as string } : {}),
          ...(opts.allowDegradedRetrieval ? { allowDegradedRetrieval: true } : {}),
          ...(opts.newVersion ? { newVersion: true } : {}),
          ...(opts.acknowledgePromptsPublic ? { acknowledgePromptsPublic: true } : {}),
        };

        const result = await withSpinner("Publishing TrustRun…", async () => {
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
          try { return JSON.parse(text) as { trustRunId?: string; verifyUrl?: string; listingNotice?: { reason?: string; detail?: string } }; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        if (!globalOpts.json) {
          console.warn(`\nTrustRun published (${body.visibility})!`);
          if (result.trustRunId) console.warn(`  TrustRun ID : ${result.trustRunId}`);
          if (result.verifyUrl) console.warn(`  Verify URL  : ${result.verifyUrl}`);
          if (result.listingNotice) {
            console.warn(
              `  ⚠ This new version is NOT on the public board (it was listed before): ${result.listingNotice.reason}` +
                (result.listingNotice.detail ? ` (${result.listingNotice.detail})` : ""),
            );
          }
          console.warn("");
        }

        output(result, { keyValue: !globalOpts.json });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
