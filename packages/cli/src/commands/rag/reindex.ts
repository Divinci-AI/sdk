import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { CHUNKING_TOOL_OPTION_DESCRIPTION, assertValidChunkingTool } from "./chunking-tools.js";

export function registerRagReindexCommand(parent: Command): void {
  parent
    .command("reindex <fileId>")
    .description("Re-process a file through the chunking + embedding pipeline")
    .option("--targets <ids>", "Comma-separated RAG vector IDs to index into (defaults to file's existing targets)")
    .option("--chapter-aware", "Prepend section headings to each chunk for structured documents (books, manuals)")
    .option("--chunking-tool <tool>", CHUNKING_TOOL_OPTION_DESCRIPTION)
    .option("--wait", "Wait for processing to complete")
    .option("--poll-interval <seconds>", "Polling interval when --wait is used", "10")
    .action(async (fileId, opts, cmd) => {
      try {
        assertValidChunkingTool(opts.chunkingTool as string | undefined);

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        // --chapter-aware prepends a langextract-stage config (chapterAware: true).
        // Only tools that actually run a langextract stage understand it — fail
        // loud instead of silently sending a combination the server will ignore.
        const CHAPTER_AWARE_COMPATIBLE_TOOLS = new Set(["langextract", "liteparse-langextract"]);
        if (opts.chapterAware && opts.chunkingTool && !CHAPTER_AWARE_COMPATIBLE_TOOLS.has(opts.chunkingTool)) {
          console.error(colors.red(
            `--chapter-aware requires a langextract-based chunking tool (langextract or liteparse-langextract), got --chunking-tool ${opts.chunkingTool}.`
          ));
          process.exit(1);
        }

        // Build chunker config
        const chunkerConfig = opts.chapterAware
          ? { langextract: { chapterAware: true } }
          : undefined;

        // Build request body
        const body: Record<string, unknown> = {};
        if (chunkerConfig) {
          body.chunkerConfig = chunkerConfig;
        }
        if (opts.chunkingTool) {
          // Explicit --chunking-tool always wins for which processor is used,
          // even when --chapter-aware is also given (the chapter-aware config
          // above still gets merged in — it isn't overridden back to langextract).
          body.chunkerTool = opts.chunkingTool;
        } else if (chunkerConfig) {
          // Legacy behavior: chapter-aware alone forces the langextract processor.
          body.chunkerTool = "@divinci-ai/langextract";
        }
        if (opts.targets) {
          body.ragVectorIds = opts.targets.split(",").map((id: string) => id.trim()).filter(Boolean);
        }

        const result = await withSpinner("Queuing file for reprocessing...", () =>
          httpClient.post<{ success: boolean; file: { _id: string; status: string }; queue: { status: string } }>(
            `${routeBase}/rag/files/${fileId}/reindex`,
            body
          )
        );

        if (isJsonMode()) {
          output(result);
          return;
        }

        console.log(colors.green("Reindex queued successfully!"));
        console.log(`  File ID:  ${colors.cyan(fileId)}`);
        console.log(`  Status:   ${colors.yellow(result.file?.status || "processing")}`);
        if (opts.chunkingTool) {
          console.log(`  Chunking tool: ${colors.dim(opts.chunkingTool)}`);
        }
        if (opts.chapterAware) {
          console.log(`  Mode:     ${colors.dim("chapter-aware (headings prepended to chunks)")}`);
        }

        if (opts.wait) {
          const pollInterval = Math.max(parseInt(opts.pollInterval, 10) || 10, 5) * 1000;
          console.log(colors.dim(`\nWaiting for processing to complete (polling every ${pollInterval / 1000}s)...`));

          let lastStatus = "";
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));

            const statusData = await httpClient.get<{ _id: string; status: string }>(
              `${routeBase}/rag/files/${fileId}`
            );

            const status = statusData.status;
            if (status !== lastStatus) {
              console.log(`  Status: ${colors.yellow(status)}`);
              lastStatus = status;
            }

            if (status === "CHUNKED_AND_EMBEDDED" || status === "ready" || status === "COMPLETED" || status === "completed") {
              console.log(colors.green("\nReindexing complete!"));
              break;
            }

            if (status === "FAILED_TO_CHUNK" || status === "failed" || status === "error") {
              console.error(colors.red("\nReindexing failed."));
              process.exit(1);
            }
          }
        } else {
          console.log(colors.dim(`\nCheck status: divinci rag status ${fileId}`));
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
