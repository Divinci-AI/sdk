import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * divinci qa runs train <suiteId> <runResultId>
 *
 * One-click: export best-scoring pairs from a completed QA run and kick off
 * a Modal + Unsloth LoRA fine-tune. Returns 202 immediately; poll with
 * `divinci fine-tune status <fineTuneAIId>`.
 */
export function registerQATrainFromRunCommand(parent: Command): void {
  parent
    .command("train <suiteId> <runResultId>")
    .description("Export top-scoring QA pairs and start a LoRA fine-tune (Modal/Unsloth)")
    .option("--model <name>", "Base model to fine-tune", "modal-gemma-4-27b-it-qlora")
    .option("--provider <name>", "Fine-tune provider", "modal")
    .option("--threshold <n>", "Minimum score to include a pair (0–1)", "0.7")
    .option("--include-rejected", "Also export low-scoring responses as DPO rejected pairs", false)
    .option("--auto-release", "Automatically create a release when training completes", false)
    .option("--title <t>", "Custom title for the fine-tune job")
    .action(async (suiteId: string, runResultId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        // Use the internal white-label route (OAuth/session auth via
        // ensureAuthMiddlewareHTTP + permissionMiddleware), matching the sibling
        // `qa run` / `qa runs list|get` commands. The /api/v1/qa/* surface is
        // api-key-only (requireAPIKey), so an OAuth CLI session 401'd there even
        // though the SAME trainFromQA handler is mounted on this route too.
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}/runs/${runResultId}/train`;

        const body: Record<string, unknown> = {
          provider: opts.provider,
          modelName: opts.model,
          scoreThreshold: parseFloat(opts.threshold),
          includeLowScoreRejected: opts.includeRejected,
          autoReleaseOnCompletion: opts.autoRelease,
        };
        if (opts.title) body.title = opts.title;

        const result = await withSpinner("Launching fine-tune job...", async () => {
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
          try { return JSON.parse(text) as any; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        if (!globalOpts.json) {
          console.warn(`\nFine-tune job started!`);
          console.warn(`  Fine-tune ID : ${result.fineTuneAIId}`);
          console.warn(`  Job ID       : ${result.jobId}`);
          console.warn(`  Status       : ${result.status}`);
          console.warn(`  Pairs        : ${result.pairCount} (skipped: ${result.skipped})`);
          console.warn(`  Model        : ${result.modelName}`);
          console.warn(`  Provider     : ${result.provider}`);
          console.warn(`\nPoll status:`);
          console.warn(`  divinci fine-tune status ${result.fineTuneAIId}`);
          console.warn("");
        }

        output(result, { keyValue: !globalOpts.json });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
