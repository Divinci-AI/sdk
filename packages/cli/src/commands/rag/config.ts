import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { parseRerank, RERANK_HELP } from "./targets.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerRagConfigCommand(parent: Command): void {
  parent
    .command("config <collectionId>")
    .description("Update retrieval settings for a RAG vector index")
    .option("--min-score <number>", "Minimum similarity score threshold for vector search (0-1, default 0.62)")
    .option("--context-per-message <number>", "Max content chunks returned per query (default 5)")
    .option("--embedding-model <model>", "Embedding model used for indexing and querying")
    .option("--embedding-auth-id <id>", "BYOK key id (provider VOYAGE) used to embed this index, or none to use Divinci's key")
    .option("--rerank <model>", `${RERANK_HELP}, or off to turn it off`)
    .action(async (collectionId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const body: Record<string, unknown> = {};

        if (opts.minScore !== undefined) {
          const val = parseFloat(opts.minScore);
          if (isNaN(val) || val < 0 || val > 1) {
            console.error(colors.red("--min-score must be a number between 0 and 1"));
            process.exit(1);
          }
          body.minimumSimilarity = val;
        }

        if (opts.contextPerMessage !== undefined) {
          const val = parseInt(opts.contextPerMessage, 10);
          if (isNaN(val) || val < 0) {
            console.error(colors.red("--context-per-message must be a non-negative integer"));
            process.exit(1);
          }
          body.contextPerMessage = val;
        }

        if (opts.embeddingAuthId !== undefined) {
          // "none" is the explicit way back to Divinci's key; an empty string would be dropped by shells.
          body.embeddingAuthId = opts.embeddingAuthId === "none" ? null : opts.embeddingAuthId;
        }
        if (opts.embeddingModel !== undefined) {
          body.embeddingModel = opts.embeddingModel;
        }

        if (opts.rerank !== undefined) {
          body.rerankModel = parseRerank(opts.rerank, true);
        }

        if (Object.keys(body).length === 0) {
          console.error(colors.red("At least one option is required: --min-score, --context-per-message, --embedding-model, --embedding-auth-id, or --rerank"));
          process.exit(1);
        }

        const result = await withSpinner("Updating collection settings...", () =>
          httpClient.patch<{ success: boolean; collection: { id: string; minimumSimilarity: number; contextPerMessage: number; embeddingModel?: string } }>(
            `${routeBase}/rag/targets/${collectionId}`,
            body
          )
        );

        if (isJsonMode()) {
          output(result);
          return;
        }

        console.log(colors.green("Collection settings updated!"));
        console.log(`  Collection:         ${colors.cyan(collectionId)}`);
        if (body.minimumSimilarity !== undefined) {
          console.log(`  Min Similarity:     ${colors.yellow(String(result.collection.minimumSimilarity))}`);
        }
        if (body.contextPerMessage !== undefined) {
          console.log(`  Context/Message:    ${colors.yellow(String(result.collection.contextPerMessage))}`);
        }
        if (body.embeddingModel !== undefined) {
          console.log(`  Embedding Model:    ${colors.yellow(result.collection.embeddingModel || "")}`);
        }
        if (body.rerankModel !== undefined) {
          console.log(`  Re-rank:            ${colors.yellow(body.rerankModel === null ? "off" : String(body.rerankModel))}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
