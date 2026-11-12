import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerTrainingDataGenerateCommand(parent: Command): void {
  parent
    .command("generate <ragFileId>")
    .description("Generate training data Q&A pairs from a RAG file")
    .option("--model <model>", "LLM model for generation", "gpt-4o-mini")
    .option("--qa-per-chunk <n>", "Q&A pairs per chunk", "3")
    .option("--chunk-size <n>", "Tokens per chunk", "256")
    .option("--quality <n>", "Minimum quality score (0-1)", "0.7")
    .option("--no-wait", "Return immediately without polling for completion")
    .action(async (ragFileId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const job = await withSpinner("Creating training data job...", () =>
          client.trainingData.generateFromRag(workspaceId, ragFileId, {
            llmModel: opts.model,
            qaPerChunk: parseInt(opts.qaPerChunk, 10),
            chunkSize: parseInt(opts.chunkSize, 10),
            qualityThreshold: parseFloat(opts.quality),
          })
        );

        if (!opts.wait || globalOpts.json) {
          output(job, { keyValue: true });
          return;
        }

        // Poll for completion with progress
        console.warn(`Job ${job._id} created. Polling for completion...`);
        const controller = new AbortController();

        process.on("SIGINT", () => {
          controller.abort();
          console.warn(`\nDetached from polling. Job still running server-side.`);
          console.warn(`  Check status:  divinci training-data status ${job._id}`);
          console.warn(`  Stop and delete: divinci training-data delete ${job._id}`);
          process.exit(0);
        });

        const completed = await client.trainingData.waitFor(
          workspaceId,
          job._id,
          {
            signal: controller.signal,
            onProgress: (j) => {
              const prog = j.progress;
              if (prog) {
                process.stderr.write(
                  `\r  ${prog.chunksProcessed}/${prog.chunksTotal} chunks, ${prog.qaPairsGenerated} pairs generated`
                );
              }
            },
          },
        );

        process.stderr.write("\n");
        if (completed.status === "Completed") {
          console.warn(`Job completed. ${completed.progress?.qaPairsGenerated || 0} Q&A pairs generated.`);
        } else {
          console.error(`Job ${completed.status}.`);
        }

        output(completed, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
