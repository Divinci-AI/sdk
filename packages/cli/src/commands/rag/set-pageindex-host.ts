import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

// Swap a PageIndex-backed RAG vector between the two host variants:
//   - pageindex          (customer BYOK; needs PAGEINDEX_API_KEY in their org)
//   - divinci-pageindex  (Divinci-hosted; uses the platform's API key)
//
// Both variants produce the same TreeIndex JSON at the same R2 key, so
// the swap is safe without re-indexing — existing tree indexes remain
// queryable. Subsequent uploads use the new host.
//
// Cross-family swaps (pageindex → qdrant-cosine, etc.) are NOT allowed
// here — they require fork-and-reindex via the existing fork flow.
export function registerRagSetPageIndexHostCommand(parent: Command): void {
  parent
    .command("set-pageindex-host <ragVectorId>")
    .description("Swap a PageIndex vector between BYOK (pageindex) and Divinci-hosted (divinci-pageindex)")
    .requiredOption("--host <id>", 'Target host: "pageindex" (BYOK) or "divinci-pageindex" (Divinci-hosted)')
    .action(async (ragVectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        if (opts.host !== "pageindex" && opts.host !== "divinci-pageindex") {
          throw new Error(`--host must be "pageindex" or "divinci-pageindex", got "${opts.host}"`);
        }

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/rag-vector/${ragVectorId}/settings`;

        const data = await withSpinner(
          `Swapping vector ${ragVectorId} to host=${opts.host}...`,
          async () => {
            const res = await fetch(url, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.accessToken}`,
              },
              body: JSON.stringify({ vectorIndexTool: opts.host }),
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
