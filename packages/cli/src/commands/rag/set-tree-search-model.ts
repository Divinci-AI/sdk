import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * Set (or clear) a RAG vector's tree-search model. PageIndex-primary
 * vectors use this to pick which model runs tree reasoning. Pass --clear
 * to revert to the server's default chain.
 */
export function registerRagSetTreeSearchModelCommand(parent: Command): void {
  parent
    .command("set-tree-search-model <ragVectorId>")
    .description("Set or clear the tree-search model on a RAG vector (PageIndex)")
    .option("--model <id>", "Assistant tool ID to use for tree reasoning (e.g. gemini-3-1-flash-light, gemini-3-flash)")
    .option("--clear", "Clear the override and revert to the server default")
    .action(async (ragVectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        if (!opts.model && !opts.clear) {
          throw new Error("Pass either --model <id> or --clear");
        }
        if (opts.model && opts.clear) {
          throw new Error("Pass either --model OR --clear, not both");
        }

        const body: Record<string, unknown> = {
          treeSearchModel: opts.clear ? null : opts.model,
        };

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/rag-vector/${ragVectorId}/settings`;

        const data = await withSpinner(
          `Updating tree-search model on vector ${ragVectorId}...`,
          async () => {
            const res = await fetch(url, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.accessToken}`,
              },
              body: JSON.stringify(body),
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
            try { return JSON.parse(text) as any; } catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
          },
        );

        output({ ragVectorId, applied: data.applied }, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
