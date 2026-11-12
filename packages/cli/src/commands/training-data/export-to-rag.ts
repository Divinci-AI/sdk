import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, outputSuccess } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci training-data export-to-rag <jobId>` — wraps
 * POST /api/v1/white-label/<wlId>/sft-generation/<jobId>/export-to-rag.
 *
 * Phase 4D of the SFT→RAG surface-area work. Calls the existing route
 * which synthesizes each approved Q/A pair into a declarative passage,
 * filters via round-trip cosine similarity, and ingests as RAG chunks.
 * The full body-param contract is documented on the route handler;
 * this command surfaces the most-commonly-used options as flags.
 */
export function registerTrainingDataExportToRagCommand(parent: Command): void {
  parent
    .command("export-to-rag <jobId>")
    .description(
      "Convert an SFT generation job's approved Q/A pairs into RAG chunks via " +
      "passage synthesis (gemini-3.1-flash-lite-preview by default) with " +
      "round-trip-filter quality gating",
    )
    .option(
      "--rag-source <id>",
      "Top-level RagVectorSource bucket the resulting file belongs to (optional)",
    )
    .option(
      "--rag-vector <id...>",
      "Vector-index IDs to attach the file to for embedding. Empty = auto-assign.",
    )
    .option(
      "--mode <auto|synthesize|answer-only>",
      "Synthesis mode: auto picks per-pair based on answer shape",
      "auto",
    )
    .option(
      "--no-round-trip-filter",
      "Disable the dual-cosine round-trip filter that gates synthesized passages",
    )
    .option(
      "--threshold <n>",
      "Round-trip similarity threshold (0..1, default 0.70)",
    )
    .option(
      "--concurrency <n>",
      "Max in-flight synthesis LLM calls (1..32, default 8)",
    )
    .option(
      "--title <s>",
      "Title for the resulting RagVectorFile2",
    )
    .option(
      "--force",
      "Skip the idempotency check and create a fresh file even if one already exists",
    )
    .option(
      "--no-one-chunk-per-passage",
      "Fall back to addNewFileFromText + default chunker (Phase 1.5 behavior) " +
      "instead of one-passage-per-chunk via insertChunks (Phase 2A default)",
    )
    .option(
      "--byok <toolId>",
      "Override the synthesis LLM tool. With a customer authId this becomes a " +
      "BYOK call billed to the customer's wallet",
    )
    .option(
      "--byok-auth <authId>",
      "BYOK authId for the --byok tool (defaults to DIVINCI shared key)",
    )
    .option(
      "--no-bge-prefixes",
      "Don't prepend BGE query:/passage: prefixes even when the embedding tool " +
      "is BGE-family. Default: prepend if BGE.",
    )
    .option(
      "--attest",
      "Persist a TrustBench-compatible SftToRagSynthesisRun document and return " +
      "trustSynthesisRunId in the response. Off by default.",
    )
    .option("--output <fmt>", "Output format: json | table", "table")
    .action(async (jobId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const result = await withSpinner(
          `Exporting SFT job ${jobId} to RAG...`,
          () => client.trainingData.exportToRag(workspaceId, jobId, {
            ragSourceId: opts.ragSource,
            ragVectors: opts.ragVector,
            synthesisMode: opts.mode,
            enableRoundTripFilter: opts.roundTripFilter !== false,
            roundTripSimilarityThreshold: opts.threshold !== undefined ? parseFloat(opts.threshold) : undefined,
            synthesisConcurrency: opts.concurrency !== undefined ? parseInt(opts.concurrency, 10) : undefined,
            title: opts.title,
            force: opts.force === true,
            oneChunkPerPassage: opts.oneChunkPerPassage !== false,
            assistantTool: opts.byok ? { id: opts.byok, authId: opts.byokAuth } : undefined,
            applyBgePrefixes: opts.bgePrefixes !== false,
            attestWithTrustBench: opts.attest === true,
          }),
        );

        // `output(data)` formats per the global JSON/table mode set by
        // CLI bootstrap (see formatter.ts). Pass a plain object/array
        // and the formatter handles rendering.
        outputSuccess(result.idempotent
          ? `Idempotent — existing RAG file: ${result.ragVectorFileId}`
          : `Created RAG file: ${result.ragVectorFileId}`);
        output({
          ragVectorFileId: result.ragVectorFileId,
          totalPairsProcessed: result.totalPairsProcessed,
          synthesized: result.synthesizedCount,
          answerOnly: result.answerOnlyCount,
          dropped: result.droppedCount,
          meanQpSim: Number(result.meanQuestionPassageSimilarity.toFixed(3)),
          meanApSim: Number(result.meanAnswerPassageSimilarity.toFixed(3)),
          synthesisCostNanoUsd: result.synthesisCostNanoUsd,
          isBYOK: result.isBYOK,
          ...(result.trustSynthesisRunId ? { trustSynthesisRunId: result.trustSynthesisRunId } : {}),
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
