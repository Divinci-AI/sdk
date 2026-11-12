/**
 * divinci rag backfill-chunks-count — one-shot backfill for the
 * denormalized RagVectorFile2.chunksCount field. Run once per workspace
 * after the chunksCount denormalization PR lands. Idempotent: safe to
 * re-run; updates only the files whose stored value differs from truth.
 */
import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface BackfillResponse {
  totalFiles: number;
  updatedFiles: number;
  totalChunks: number;
}

export function registerRagBackfillChunksCountCommand(parent: Command): void {
  parent
    .command("backfill-chunks-count")
    .description("Backfill the denormalized chunksCount field on all RagVectorFile2 docs in the current workspace.")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const res = await withSpinner(
          "Backfilling chunksCount across all files in the workspace...",
          () => httpClient.post<BackfillResponse>(
            `${routeBase}/rag-vector/files/backfill-chunks-count`,
            {},
          ),
        );

        if (isJsonMode()) { output(res as any); return; }

        console.log();
        console.log(colors.bold("Backfill complete"));
        console.log(`  totalFiles:   ${res.totalFiles}`);
        console.log(`  updatedFiles: ${colors.green(String(res.updatedFiles))} ${res.updatedFiles === 0 ? colors.gray("(already in sync)") : ""}`);
        console.log(`  totalChunks:  ${res.totalChunks}`);
        console.log();
      } catch (error) { handleCommandError(error); }
    });
}
