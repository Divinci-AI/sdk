import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * divinci rag set-source-url --file-id <id> [--url <https://...>] [--clear]
 *
 * Sets (or clears) the source URL on a RAG file. The URL renders as a
 * clickable backlink on the chat context bubble for every chunk of the file.
 * HTML-scraped pages get it automatically at ingestion; this assigns one to
 * uploads/transcripts or corrects an existing value.
 *
 * Routes through PATCH {routeBase}/rag/files/:fileId, which exists on both
 * the API-key surface (/api/v1) and the OAuth surface (/white-label/:ws/rag).
 */
export function registerRagSetSourceUrlCommand(parent: Command): void {
  parent
    .command("set-source-url")
    .description("Set or clear the source URL backlink on a RAG file")
    .requiredOption("--file-id <id>", "RAG file ID")
    .option("--url <url>", "Source page URL (http(s) only)")
    .option("--clear", "Clear the existing source URL")
    .action(async (opts, cmd) => {
      try {
        if (!opts.url && !opts.clear) {
          throw new Error("Provide --url <https://...> to set, or --clear to remove.");
        }
        if (opts.url && opts.clear) {
          throw new Error("--url and --clear are mutually exclusive.");
        }
        if (opts.url && !/^https?:\/\//i.test(opts.url)) {
          throw new Error("--url must be an http(s) URL.");
        }

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner(
          opts.clear ? "Clearing source URL..." : "Setting source URL...",
          () =>
            httpClient.patch<{ success: boolean; file: { _id: string; sourceUrl: string | null; updatedFields: string[] } }>(
              `${routeBase}/rag/files/${opts.fileId}`,
              { sourceUrl: opts.clear ? null : opts.url }
            )
        );

        output(data.file ?? data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
