/**
 * divinci rag targets — RAG vector index management
 *
 * Subcommands:
 *   rag targets list                            — List all vector indexes
 *   rag targets get <collectionId>              — Get index details
 *   rag targets create                          — Create a new vector index
 *   rag targets migrate <collectionId>          — Clone with new config + bulk reindex all files
 *   rag targets reindex <collectionId>          — Re-queue all files in an index
 *   rag targets config <collectionId>           — Update retrieval settings
 *   rag targets delete <collectionId>           — Delete an index
 *   rag targets prune-refs <collectionId>       — Remove ghost file refs
 *   rag targets d1-provision [collectionId]    — Provision per-vector D1 databases
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { COMPRESSION_STRATEGIES } from "@divinci-ai/types";
import { safeLabel, stripControlChars } from "../../output/safe-text.js";

interface RagTarget {
  id: string;
  title: string;
  vectorIndexTool: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  chunkingTool?: string;
  contextPerMessage?: number;
  minimumSimilarity?: number;
  compressionStrategy?: string;
  compressionTargetRatio?: number;
  description?: string;
  status?: string;
  fileCount?: number;
  raptorConfig?: {
    underlyingVectorTool?: string;
    treeDepth?: number;
    clusterSize?: number;
    summaryModel?: string;
    retrievalMode?: string;
    topKPerLevel?: number;
  };
  lightragConfig?: {
    extractionModel?: string;
    maxCommunitySize?: number;
    retrievalMode?: string;
    graphBuildStatus?: string;
  };
  neo4jRetrievalStrategy?: string;
}

// Imported from @divinci-ai/types — mirror of @divinci-ai/models COMPRESSION_STRATEGIES.
// Drift is caught by both packages' drift-guard tests.
const VALID_COMPRESSION_STRATEGIES: readonly string[] = COMPRESSION_STRATEGIES;

/** Backend used when `rag targets create` is given no --tool. */
export const DEFAULT_VECTOR_TOOL = "qdrant";

/**
 * `--rerank` values accepted by `rag targets create` / `rag config`, mapped to
 * the server's rerankModel. "off" clears it (config only).
 */
export const RERANK_MODELS: Record<string, string | null> = {
  jev: "typesafe/jev",
  "typesafe/jev": "typesafe/jev",
  off: null,
  none: null,
};
export const RERANK_HELP =
  "Re-rank retrieved passages with Jev (TypeSafe), which reads each candidate and puts the ones that " +
  "state the answer first. Highest retrieval quality; adds ~1s and ~$0.001 per query. Values: jev";

export function parseRerank(value: string, allowOff: boolean): string | null {
  const key = value.trim().toLowerCase();
  if (!(key in RERANK_MODELS) || (!allowOff && RERANK_MODELS[key] === null)) {
    throw new Error(`--rerank must be ${allowOff ? "jev or off" : "jev"} (got "${value}")`);
  }
  return RERANK_MODELS[key];
}
const VALID_RAPTOR_SUMMARY_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash", "gemini-3-flash-lite"];
const VALID_RAPTOR_RETRIEVAL_MODES = ["collapsed", "tree-traversal"];
const VALID_LIGHTRAG_RETRIEVAL_MODES = ["low-level", "high-level", "hybrid"];
const VALID_NEO4J_RETRIEVAL_STRATEGIES = ["vector-only", "graph-enhanced", "cypher-generation", "hybrid-rrf"];

function printTarget(t: RagTarget): void {
  console.log(`${colors.cyanBold(safeLabel(t.title))} ${colors.dim(`(${t.id})`)}`);
  console.log(`  ${colors.dim("Tool:")} ${t.vectorIndexTool}`);
  if (t.embeddingModel) {
    const dimStr = t.embeddingDimension ? colors.dim(` ${t.embeddingDimension}d`) : "";
    console.log(`  ${colors.dim("Embedding:")} ${t.embeddingModel}${dimStr}`);
  }
  if (t.chunkingTool) console.log(`  ${colors.dim("Chunking:")} ${t.chunkingTool}`);
  if (t.contextPerMessage !== undefined) console.log(`  ${colors.dim("Context/msg:")} ${t.contextPerMessage}`);
  if (t.minimumSimilarity !== undefined) console.log(`  ${colors.dim("Min similarity:")} ${t.minimumSimilarity}`);
  if (t.compressionStrategy && t.compressionStrategy !== "none") {
    console.log(`  ${colors.dim("Compression:")} ${t.compressionStrategy} (${t.compressionTargetRatio ?? 4}x)`);
  }
  if (t.fileCount !== undefined) console.log(`  ${colors.dim("Files:")} ${t.fileCount}`);
  if (t.description) console.log(`  ${colors.dim("Description:")} ${stripControlChars(t.description)}`);
  if (t.raptorConfig) {
    const rc = t.raptorConfig;
    const parts = [
      rc.underlyingVectorTool && `underlying=${rc.underlyingVectorTool}`,
      rc.treeDepth !== undefined && `depth=${rc.treeDepth}`,
      rc.clusterSize !== undefined && `cluster=${rc.clusterSize}`,
      rc.summaryModel && `summary=${rc.summaryModel}`,
      rc.retrievalMode && `mode=${rc.retrievalMode}`,
      rc.topKPerLevel !== undefined && `topK=${rc.topKPerLevel}`,
    ].filter(Boolean).join(" ");
    if (parts) console.log(`  ${colors.dim("RAPTOR:")} ${parts}`);
  }
  if (t.lightragConfig) {
    const lc = t.lightragConfig;
    const parts = [
      lc.extractionModel && `extract=${lc.extractionModel}`,
      lc.maxCommunitySize !== undefined && `maxCommunity=${lc.maxCommunitySize}`,
      lc.retrievalMode && `mode=${lc.retrievalMode}`,
      lc.graphBuildStatus && `graph=${lc.graphBuildStatus}`,
    ].filter(Boolean).join(" ");
    if (parts) console.log(`  ${colors.dim("LightRAG:")} ${parts}`);
  }
  if (t.neo4jRetrievalStrategy) {
    console.log(`  ${colors.dim("Neo4j strategy:")} ${t.neo4jRetrievalStrategy}`);
  }
}

// Case-insensitive substring match on title. Blue-green crawl refreshes
// (rag crawl --force-refresh) clone the source vector into a draft titled
// "<source title> (draft <ISO>)" and repoint the release to it on
// completion — the original vector id never changes and never disappears,
// so a target list has no other way to surface "what did this title spawn"
// short of eyeballing every row. --filter turns that into one command, e.g.
// `divinci rag targets list --filter "SDK Docs"` shows the live vector next
// to any in-flight or orphaned draft clones of it.
function applyFilter(targets: RagTarget[], filter?: string): RagTarget[] {
  if (!filter) return targets;
  const needle = filter.toLowerCase();
  return targets.filter((t) => t.title.toLowerCase().includes(needle));
}

export function registerRagTargetsCommand(parent: Command): void {
  const targets = parent
    .command("targets")
    .description("Manage RAG vector indexes (upload targets)")
    // Default: list (backwards compat — `divinci rag targets` still works).
    // No --filter here: commander attributes a flag declared on BOTH a
    // parent command and its subcommand to the parent, so `targets list
    // --filter x` would silently lose the flag if it were also declared
    // here. Use `divinci rag targets list --filter <substring>` instead.
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching RAG targets...", () =>
          httpClient.get<{ targets: RagTarget[]; total: number }>(
            `${routeBase}/rag/targets`
          )
        );

        output(data.targets, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "vectorIndexTool", header: "Vector Tool" },
              { key: "embeddingModel", header: "Embedding Model" },
              { key: "status", header: "Status" },
              { key: "fileCount", header: "Files" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── list ──────────────────────────────────────────────────────────────────
  targets
    .command("list")
    .description("List RAG vector indexes")
    .option("--filter <substring>", "Only show targets whose title contains this substring (case-insensitive)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching RAG targets...", () =>
          httpClient.get<{ targets: RagTarget[]; total: number }>(
            `${routeBase}/rag/targets`
          )
        );

        output(applyFilter(data.targets, opts.filter), {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "vectorIndexTool", header: "Vector Tool" },
              { key: "embeddingModel", header: "Embedding Model" },
              { key: "status", header: "Status" },
              { key: "fileCount", header: "Files" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── get ───────────────────────────────────────────────────────────────────
  targets
    .command("get <collectionId>")
    .description("Get details of a specific vector index")
    .action(async (collectionId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching targets...", () =>
          httpClient.get<{ targets: RagTarget[] }>(`${routeBase}/rag/targets`)
        );

        const found = data.targets.find(t => t.id === collectionId);
        if (!found) {
          console.error(colors.red(`Vector index not found: ${collectionId}`));
          process.exit(1);
        }

        if (isJsonMode()) {
          output(found);
          return;
        }
        printTarget(found);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── create ────────────────────────────────────────────────────────────────
  targets
    .command("create")
    .description("Create a new RAG vector index")
    .requiredOption("--title <name>", "Index title")
    // Defaulted: a required backend choice made every first-time caller guess,
    // and the first guess (vectorize) fails once the account's index quota is spent.
    .option("--tool <type>", "Vector tool: vectorize | qdrant | vertex-ai | vertex-ai-v2 | pageindex | divinci-pageindex | mongodb-atlas | raptor | lightrag | neo4j-hybrid", DEFAULT_VECTOR_TOOL)
    .option("--embedding-model <model>", "Embedding model (e.g. @cf/baai/bge-base-en-v1.5, gemini-embedding-001@1536, voyage-4); see `divinci rag models`")
    .option("--embedding-auth-id <id>", "BYOK key id (provider VOYAGE) to embed with instead of Divinci's key; find it with `divinci byok list`")
    .option("--chunking-tool <tool>", "Chunking tool: langextract | openparse", "langextract")
    .option("--context-per-message <n>", "Max chunks per query", "5")
    .option("--min-similarity <n>", "Score threshold 0–1 (default: server picks per embedding model — 0.4 for embeddinggemma, 0.62 otherwise)")
    .option("--similarity-metric <type>", "COSINE | DOT | L2_SQUARED", "COSINE")
    .option("--description <text>", "Index description")
    .option("--purpose <type>", "general | product-catalog | canvas | knowledge-base")
    .option("--rerank <model>", RERANK_HELP)
    .option("--compression <strategy>", `Context compression: ${VALID_COMPRESSION_STRATEGIES.join(" | ")} (default: none)`)
    .option("--compression-ratio <n>", "Target compression ratio (2–20, default: 4)")
    // RAPTOR build-time config (only when --tool raptor)
    .option("--raptor-underlying-tool <tool>", "RAPTOR underlying vector tool (e.g. qdrant, vectorize)")
    .option("--raptor-tree-depth <n>", "RAPTOR tree depth (1–10)")
    .option("--raptor-cluster-size <n>", "RAPTOR cluster size (2–100)")
    .option("--raptor-summary-model <model>", `RAPTOR summary model: ${VALID_RAPTOR_SUMMARY_MODELS.join(" | ")}`)
    .option("--raptor-retrieval-mode <mode>", `RAPTOR retrieval mode: ${VALID_RAPTOR_RETRIEVAL_MODES.join(" | ")}`)
    .option("--raptor-top-k-per-level <n>", "RAPTOR topK per tree level (1–20)")
    // LightRAG config (only when --tool lightrag)
    .option("--lightrag-extraction-model <model>", "LightRAG entity extraction model")
    .option("--lightrag-max-community-size <n>", "LightRAG max community size")
    .option("--lightrag-retrieval-mode <mode>", `LightRAG retrieval mode: ${VALID_LIGHTRAG_RETRIEVAL_MODES.join(" | ")}`)
    // Neo4j Hybrid config (only when --tool neo4j-hybrid)
    .option("--neo4j-retrieval-strategy <strategy>", `Neo4j retrieval strategy: ${VALID_NEO4J_RETRIEVAL_STRATEGIES.join(" | ")}`)
    // BYOK key reference — required for tools that need whitelabel-owned credentials (e.g. Neo4j Hybrid)
    .option("--auth-key <byokId>", "BYOK key ObjectId to authenticate this vector index (required for Neo4j Hybrid)")
    // Copy files from an existing vector (useful for mirroring content across RAG tools / arenas)
    .option("--copy-files-from <sourceVectorId>", "After create, bulk-attach every fileId from the source vector to the new one")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (opts.compression && !VALID_COMPRESSION_STRATEGIES.includes(opts.compression)) {
          console.error(colors.red(`Invalid compression strategy "${opts.compression}". Valid: ${VALID_COMPRESSION_STRATEGIES.join(", ")}`));
          process.exit(1);
        }

        const hasRaptorFlag = !!(opts.raptorUnderlyingTool || opts.raptorTreeDepth || opts.raptorClusterSize || opts.raptorSummaryModel || opts.raptorRetrievalMode || opts.raptorTopKPerLevel);
        const hasLightragFlag = !!(opts.lightragExtractionModel || opts.lightragMaxCommunitySize || opts.lightragRetrievalMode);
        const hasNeo4jFlag = !!opts.neo4jRetrievalStrategy;

        if (hasRaptorFlag && opts.tool !== "raptor") {
          console.error(colors.red(`--raptor-* flags require --tool raptor (got --tool ${opts.tool})`));
          process.exit(1);
        }
        if (hasLightragFlag && opts.tool !== "lightrag") {
          console.error(colors.red(`--lightrag-* flags require --tool lightrag (got --tool ${opts.tool})`));
          process.exit(1);
        }
        if (hasNeo4jFlag && opts.tool !== "neo4j-hybrid") {
          console.error(colors.red(`--neo4j-retrieval-strategy requires --tool neo4j-hybrid (got --tool ${opts.tool})`));
          process.exit(1);
        }
        if (opts.raptorSummaryModel && !VALID_RAPTOR_SUMMARY_MODELS.includes(opts.raptorSummaryModel)) {
          console.error(colors.red(`Invalid --raptor-summary-model "${opts.raptorSummaryModel}". Valid: ${VALID_RAPTOR_SUMMARY_MODELS.join(", ")}`));
          process.exit(1);
        }
        if (opts.raptorRetrievalMode && !VALID_RAPTOR_RETRIEVAL_MODES.includes(opts.raptorRetrievalMode)) {
          console.error(colors.red(`Invalid --raptor-retrieval-mode "${opts.raptorRetrievalMode}". Valid: ${VALID_RAPTOR_RETRIEVAL_MODES.join(", ")}`));
          process.exit(1);
        }
        if (opts.lightragRetrievalMode && !VALID_LIGHTRAG_RETRIEVAL_MODES.includes(opts.lightragRetrievalMode)) {
          console.error(colors.red(`Invalid --lightrag-retrieval-mode "${opts.lightragRetrievalMode}". Valid: ${VALID_LIGHTRAG_RETRIEVAL_MODES.join(", ")}`));
          process.exit(1);
        }
        if (opts.neo4jRetrievalStrategy && !VALID_NEO4J_RETRIEVAL_STRATEGIES.includes(opts.neo4jRetrievalStrategy)) {
          console.error(colors.red(`Invalid --neo4j-retrieval-strategy "${opts.neo4jRetrievalStrategy}". Valid: ${VALID_NEO4J_RETRIEVAL_STRATEGIES.join(", ")}`));
          process.exit(1);
        }

        const body: Record<string, unknown> = {
          title: opts.title,
          vectorIndexTool: opts.tool,
          chunkingTool: opts.chunkingTool,
          contextPerMessage: parseInt(opts.contextPerMessage, 10),
          // Only when asked: a hardcoded 0.62 here overrode the server's
          // model-aware default and starved embeddinggemma vectors.
          ...(opts.minSimilarity !== undefined && { minimumSimilarity: parseFloat(opts.minSimilarity) }),
          similarityMetric: opts.similarityMetric,
        };
        if (opts.embeddingModel) body.embeddingModel = opts.embeddingModel;
        if (opts.embeddingAuthId) body.embeddingAuthId = opts.embeddingAuthId;
        if (opts.description) body.description = opts.description;
        if (opts.purpose) body.purpose = opts.purpose;
        if (opts.compression) body.compressionStrategy = opts.compression;
        if (opts.rerank) body.rerankModel = parseRerank(opts.rerank, false);
        if (opts.compressionRatio) body.compressionTargetRatio = parseInt(opts.compressionRatio, 10);

        if (opts.tool === "raptor" && hasRaptorFlag) {
          const raptorConfig: Record<string, unknown> = {};
          if (opts.raptorUnderlyingTool) raptorConfig.underlyingVectorTool = opts.raptorUnderlyingTool;
          if (opts.raptorTreeDepth) raptorConfig.treeDepth = parseInt(opts.raptorTreeDepth, 10);
          if (opts.raptorClusterSize) raptorConfig.clusterSize = parseInt(opts.raptorClusterSize, 10);
          if (opts.raptorSummaryModel) raptorConfig.summaryModel = opts.raptorSummaryModel;
          if (opts.raptorRetrievalMode) raptorConfig.retrievalMode = opts.raptorRetrievalMode;
          if (opts.raptorTopKPerLevel) raptorConfig.topKPerLevel = parseInt(opts.raptorTopKPerLevel, 10);
          body.raptorConfig = raptorConfig;
        }
        if (opts.tool === "lightrag" && hasLightragFlag) {
          const lightragConfig: Record<string, unknown> = {};
          if (opts.lightragExtractionModel) lightragConfig.extractionModel = opts.lightragExtractionModel;
          if (opts.lightragMaxCommunitySize) lightragConfig.maxCommunitySize = parseInt(opts.lightragMaxCommunitySize, 10);
          if (opts.lightragRetrievalMode) lightragConfig.retrievalMode = opts.lightragRetrievalMode;
          body.lightragConfig = lightragConfig;
        }
        if (opts.tool === "neo4j-hybrid" && opts.neo4jRetrievalStrategy) {
          body.neo4jRetrievalStrategy = opts.neo4jRetrievalStrategy;
        }
        if (opts.authKey) {
          body.authKey = opts.authKey;
        }

        const data = await withSpinner("Creating index...", () =>
          httpClient.post<{ collection: RagTarget }>(`${routeBase}/rag/targets`, body)
        );

        // --copy-files-from: bulk-attach all fileIds from a source vector so
        // the new vector mirrors the same content set. Runs before output so
        // --json consumers see the final file-copy result in the payload.
        let copyResult: { queued: number; skipped: number; total: number } | undefined;
        if (opts.copyFilesFrom) {
          if (!/^[a-f0-9]{24}$/.test(opts.copyFilesFrom)) {
            console.warn(colors.yellow(`⚠ --copy-files-from expects a 24-char hex ObjectId; got "${opts.copyFilesFrom}". Skipping file copy.`));
          } else {
            try {
              const source = await withSpinner(
                `Fetching files from source vector ${opts.copyFilesFrom}...`,
                () => httpClient.get<{ files?: Array<{ fileId: string }> }>(
                  `${routeBase}/rag-vector/${opts.copyFilesFrom}`
                )
              );
              const fileIds = (source.files ?? [])
                .map((f) => f?.fileId)
                .filter((id): id is string => typeof id === "string");

              if (fileIds.length === 0) {
                copyResult = { queued: 0, skipped: 0, total: 0 };
              } else {
                const bulkResult = await withSpinner(
                  `Queuing ${fileIds.length} file${fileIds.length === 1 ? "" : "s"} on the new vector...`,
                  () => httpClient.post<{ queued?: number; skipped?: number; total?: number; message?: string }>(
                    `${routeBase}/rag-vector/${data.collection.id}/files/bulk-add`,
                    { fileIds }
                  )
                );
                copyResult = {
                  queued: bulkResult.queued ?? fileIds.length,
                  skipped: bulkResult.skipped ?? 0,
                  total: bulkResult.total ?? fileIds.length,
                };
              }
            } catch (copyErr) {
              console.warn(colors.yellow(`⚠ File copy failed (new vector still created): ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`));
            }
          }
        }

        if (isJsonMode()) {
          output({ collection: data.collection, ...(copyResult && { copyFilesFrom: copyResult }) });
          return;
        }

        console.log(colors.green("Vector index created."));
        printTarget(data.collection);
        if (copyResult) {
          if (copyResult.total === 0) {
            console.log(colors.dim(`Source vector has no files — nothing to copy.`));
          } else {
            console.log(colors.green(
              `Files copied: queued ${copyResult.queued} / ${copyResult.total}${copyResult.skipped ? ` (skipped ${copyResult.skipped})` : ""}`
            ));
          }
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── migrate ───────────────────────────────────────────────────────────────
  targets
    .command("migrate <collectionId>")
    .description(
      "Clone a vector index with new config and re-index all files.\n" +
      "Use this to change embedding model/dimension (e.g. 768d → 1536d).\n" +
      "Source index is left untouched.\n\n" +
      "Example:\n" +
      "  divinci rag targets migrate <id> \\\n" +
      "    --embedding-model gemini-embedding-001@1536 \\\n" +
      "    --title \"Vectorize 1536d\""
    )
    .option("--title <name>", "Title for the new index (default: '<source> (migrated)')")
    .option("--embedding-model <model>", "New embedding model (key param for dimension change)")
    .option("--chunking-tool <tool>", "Override chunking tool: langextract | openparse")
    .option("--context-per-message <n>", "Max chunks per query")
    .option("--min-similarity <n>", "Score threshold 0–1")
    .option("--similarity-metric <type>", "COSINE | DOT | L2_SQUARED")
    .option("--description <text>", "Description for the new index")
    .option("--compression <strategy>", `Compression strategy override: ${VALID_COMPRESSION_STRATEGIES.join(", ")} (default: source value)`)
    .option("--compression-ratio <n>", "Compression target ratio 2-128 (default: source value)")
    .action(async (collectionId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (opts.compression && !VALID_COMPRESSION_STRATEGIES.includes(opts.compression)) {
          console.error(colors.red(`Invalid compression strategy: ${opts.compression}. Valid: ${VALID_COMPRESSION_STRATEGIES.join(", ")}`));
          process.exit(1);
        }

        const body: Record<string, unknown> = {};
        if (opts.title) body.title = opts.title;
        if (opts.embeddingModel) body.embeddingModel = opts.embeddingModel;
        if (opts.chunkingTool) body.chunkingTool = opts.chunkingTool;
        if (opts.contextPerMessage) body.contextPerMessage = parseInt(opts.contextPerMessage, 10);
        if (opts.minSimilarity) body.minimumSimilarity = parseFloat(opts.minSimilarity);
        if (opts.similarityMetric) body.similarityMetric = opts.similarityMetric;
        if (opts.description) body.description = opts.description;
        if (opts.compression) body.compressionStrategy = opts.compression;
        if (opts.compressionRatio) body.compressionTargetRatio = parseInt(opts.compressionRatio, 10);

        if (!isJsonMode() && opts.embeddingModel) {
          console.log(colors.dim(`Migrating ${collectionId} → new embedding model: ${opts.embeddingModel}`));
        }

        const data = await withSpinner("Creating new index and queuing files...", () =>
          httpClient.post<{
            newCollectionId: string;
            newCollection: RagTarget;
            sourceCollectionId: string;
            queued: number;
            total: number;
            message: string;
          }>(`${routeBase}/rag/targets/${collectionId}/migrate`, body)
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        console.log(colors.green("Migration started."));
        console.log(`  ${colors.dim("New collection ID:")} ${colors.cyan(data.newCollectionId)}`);
        console.log(`  ${colors.dim("Files queued:")} ${data.queued} / ${data.total}`);
        console.log(`  ${colors.dim("Message:")} ${data.message}`);
        console.log("");
        printTarget({ ...data.newCollection, id: data.newCollectionId });
        console.log("");
        console.log(colors.dim("Files are reindexing in the background. Monitor with:"));
        console.log(`  divinci rag targets get ${data.newCollectionId}`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── reindex ───────────────────────────────────────────────────────────────
  targets
    .command("reindex <collectionId>")
    .description("Re-queue all files in a vector index for reprocessing (in-place)")
    .option("--chunking-tool <tool>", "Override chunking tool for all files")
    .option("--file-ids <ids>", "Comma-separated file IDs to reindex (default: all)")
    .option("--yes", "Skip confirmation prompt")
    .action(async (collectionId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (!opts.yes && !isJsonMode()) {
          const { default: readline } = await import("readline");
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const confirmed = await new Promise<boolean>((resolve) => {
            rl.question(
              colors.yellow(`Re-index ALL files in ${collectionId}? (y/N) `),
              (answer) => { rl.close(); resolve(answer.toLowerCase() === "y"); }
            );
          });
          if (!confirmed) {
            console.log(colors.dim("Aborted."));
            return;
          }
        }

        const body: Record<string, unknown> = {};
        if (opts.chunkingTool) body.chunkingTool = opts.chunkingTool;
        if (opts.fileIds) {
          body.fileIds = opts.fileIds.split(",").map((s: string) => s.trim()).filter(Boolean);
        }

        const data = await withSpinner("Queuing files for reindexing...", () =>
          httpClient.post<{ queued: number; skipped: number; total: number; message: string }>(
            `${routeBase}/rag/targets/${collectionId}/bulk-reindex`,
            body
          )
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        console.log(colors.green("Reindex queued."));
        console.log(`  ${colors.dim("Queued:")} ${data.queued}`);
        console.log(`  ${colors.dim("Skipped:")} ${data.skipped}`);
        console.log(`  ${colors.dim("Total:")} ${data.total}`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── config ────────────────────────────────────────────────────────────────
  targets
    .command("config <collectionId>")
    .description("Update retrieval settings without re-indexing files")
    .option("--context-per-message <n>", "Max chunks returned per query")
    .option("--min-similarity <n>", "Score threshold 0–1")
    .option("--embedding-model <model>", "Update model reference (note: does not re-index; use migrate for full reindex)")
    .option("--tool <type>", "Switch between pageindex variants only: pageindex | divinci-pageindex (no re-indexing needed)")
    .option("--tree-model <model>", "LLM model for PageIndex tree generation (e.g. vertex_ai/gemini-3.1-flash-lite). Applies on next reindex.")
    .option("--compression <strategy>", `Context compression strategy: ${VALID_COMPRESSION_STRATEGIES.join(" | ")}`)
    .option("--compression-ratio <n>", "Target compression ratio (2–20). 4 = keep 25% of tokens. Default: 4.")
    // RAPTOR query-time knobs (build-time fields are rejected by server)
    .option("--raptor-retrieval-mode <mode>", `RAPTOR retrieval mode: ${VALID_RAPTOR_RETRIEVAL_MODES.join(" | ")} (raptor only)`)
    .option("--raptor-top-k-per-level <n>", "RAPTOR topK per tree level (1–20, raptor only)")
    // LightRAG update knobs
    .option("--lightrag-extraction-model <model>", "LightRAG entity extraction model (lightrag only)")
    .option("--lightrag-max-community-size <n>", "LightRAG max community size (lightrag only)")
    .option("--lightrag-retrieval-mode <mode>", `LightRAG retrieval mode: ${VALID_LIGHTRAG_RETRIEVAL_MODES.join(" | ")} (lightrag only)`)
    // Neo4j Hybrid strategy
    .option("--neo4j-retrieval-strategy <strategy>", `Neo4j retrieval strategy: ${VALID_NEO4J_RETRIEVAL_STRATEGIES.join(" | ")} (neo4j-hybrid only)`)
    // Rotate BYOK credentials (use empty string to clear the ref)
    .option("--auth-key <byokId>", "Rotate the BYOK key ObjectId (use empty string to clear)")
    .action(async (collectionId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (opts.compression && !VALID_COMPRESSION_STRATEGIES.includes(opts.compression)) {
          console.error(colors.red(`Invalid compression strategy "${opts.compression}". Valid: ${VALID_COMPRESSION_STRATEGIES.join(", ")}`));
          process.exit(1);
        }
        if (opts.raptorRetrievalMode && !VALID_RAPTOR_RETRIEVAL_MODES.includes(opts.raptorRetrievalMode)) {
          console.error(colors.red(`Invalid --raptor-retrieval-mode "${opts.raptorRetrievalMode}". Valid: ${VALID_RAPTOR_RETRIEVAL_MODES.join(", ")}`));
          process.exit(1);
        }
        if (opts.lightragRetrievalMode && !VALID_LIGHTRAG_RETRIEVAL_MODES.includes(opts.lightragRetrievalMode)) {
          console.error(colors.red(`Invalid --lightrag-retrieval-mode "${opts.lightragRetrievalMode}". Valid: ${VALID_LIGHTRAG_RETRIEVAL_MODES.join(", ")}`));
          process.exit(1);
        }
        if (opts.neo4jRetrievalStrategy && !VALID_NEO4J_RETRIEVAL_STRATEGIES.includes(opts.neo4jRetrievalStrategy)) {
          console.error(colors.red(`Invalid --neo4j-retrieval-strategy "${opts.neo4jRetrievalStrategy}". Valid: ${VALID_NEO4J_RETRIEVAL_STRATEGIES.join(", ")}`));
          process.exit(1);
        }

        const body: Record<string, unknown> = {};
        if (opts.contextPerMessage) body.contextPerMessage = parseInt(opts.contextPerMessage, 10);
        if (opts.minSimilarity) body.minimumSimilarity = parseFloat(opts.minSimilarity);
        if (opts.embeddingModel) body.embeddingModel = opts.embeddingModel;
        if (opts.tool) body.vectorIndexTool = opts.tool;
        if (opts.treeModel) body.treeSearchModel = opts.treeModel;
        if (opts.compression) body.compressionStrategy = opts.compression;
        if (opts.compressionRatio) body.compressionTargetRatio = parseInt(opts.compressionRatio, 10);

        if (opts.raptorRetrievalMode || opts.raptorTopKPerLevel) {
          const raptorConfig: Record<string, unknown> = {};
          if (opts.raptorRetrievalMode) raptorConfig.retrievalMode = opts.raptorRetrievalMode;
          if (opts.raptorTopKPerLevel) raptorConfig.topKPerLevel = parseInt(opts.raptorTopKPerLevel, 10);
          body.raptorConfig = raptorConfig;
        }
        if (opts.lightragExtractionModel || opts.lightragMaxCommunitySize || opts.lightragRetrievalMode) {
          const lightragConfig: Record<string, unknown> = {};
          if (opts.lightragExtractionModel) lightragConfig.extractionModel = opts.lightragExtractionModel;
          if (opts.lightragMaxCommunitySize) lightragConfig.maxCommunitySize = parseInt(opts.lightragMaxCommunitySize, 10);
          if (opts.lightragRetrievalMode) lightragConfig.retrievalMode = opts.lightragRetrievalMode;
          body.lightragConfig = lightragConfig;
        }
        if (opts.neo4jRetrievalStrategy) {
          body.neo4jRetrievalStrategy = opts.neo4jRetrievalStrategy;
        }
        if (opts.authKey !== undefined) {
          body.authKey = opts.authKey;
        }

        if (Object.keys(body).length === 0) {
          console.error(colors.red(
            "Provide at least one option: --context-per-message, --min-similarity, --embedding-model, --tool, --tree-model, --compression, --compression-ratio, --raptor-retrieval-mode, --raptor-top-k-per-level, --lightrag-extraction-model, --lightrag-max-community-size, --lightrag-retrieval-mode, --neo4j-retrieval-strategy, --auth-key"
          ));
          process.exit(1);
        }

        const data = await withSpinner("Updating config...", () =>
          httpClient.patch<{ success: boolean; collection: Record<string, unknown> }>(
            `${routeBase}/rag/targets/${collectionId}`,
            body
          )
        );

        if (isJsonMode()) {
          output(data.collection);
          return;
        }

        console.log(colors.green("Config updated."));
        const c = data.collection;
        if (c.vectorIndexTool) console.log(`  ${colors.dim("Tool:")} ${c.vectorIndexTool}`);
        if (c.contextPerMessage !== undefined) console.log(`  ${colors.dim("Context/msg:")} ${c.contextPerMessage}`);
        if (c.minimumSimilarity !== undefined) console.log(`  ${colors.dim("Min similarity:")} ${c.minimumSimilarity}`);
        if (c.embeddingModel) console.log(`  ${colors.dim("Embedding:")} ${c.embeddingModel}`);
        if (c.embeddingDimension) console.log(`  ${colors.dim("Dimension:")} ${c.embeddingDimension}`);
        if (c.treeSearchModel) console.log(`  ${colors.dim("Tree model:")} ${c.treeSearchModel}`);
        if (c.compressionStrategy) {
          const ratio = c.compressionTargetRatio as number ?? 4;
          const savings = Math.round((1 - 1 / ratio) * 100);
          console.log(`  ${colors.dim("Compression:")} ${c.compressionStrategy} (${ratio}x → ~${savings}% token savings)`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── prune-refs ────────────────────────────────────────────────────────────
  targets
    .command("prune-refs <collectionId>")
    .description("Remove ghost file refs from a vector index's files[], failedFiles[], pendingFiles[] arrays")
    .action(async (collectionId: string, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Pruning ghost refs...", () =>
          httpClient.post<{
            pruned: number;
            before: number;
            after: number;
            message?: string;
            details?: { fromFiles: number; fromFailedFiles: number; fromPendingFiles: number };
          }>(`${routeBase}/rag/targets/${collectionId}/prune-ghost-refs`, {})
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        if (data.pruned === 0) {
          console.log(colors.green("No ghost refs found."));
          console.log(`  ${colors.dim("Total file refs:")} ${data.before}`);
          return;
        }

        console.log(colors.green(`Pruned ${data.pruned} ghost ref${data.pruned !== 1 ? "s" : ""}.`));
        console.log(`  ${colors.dim("Before:")} ${data.before}`);
        console.log(`  ${colors.dim("After:")} ${data.after}`);
        if (data.details) {
          if (data.details.fromFiles > 0) console.log(`  ${colors.dim("From files[]:")} ${data.details.fromFiles}`);
          if (data.details.fromFailedFiles > 0) console.log(`  ${colors.dim("From failedFiles[]:")} ${data.details.fromFailedFiles}`);
          if (data.details.fromPendingFiles > 0) console.log(`  ${colors.dim("From pendingFiles[]:")} ${data.details.fromPendingFiles}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── d1-provision ──────────────────────────────────────────────────────────
  targets
    .command("d1-provision [collectionId]")
    .description(
      "Provision per-vector D1 databases for cloudflare-v2 / vertex-ai vectors.\n" +
      "Idempotent — already-provisioned vectors are skipped.\n\n" +
      "Examples:\n" +
      "  divinci rag targets d1-provision                  # Provision all unprovisioned vectors\n" +
      "  divinci rag targets d1-provision <collectionId>  # Re-provision a specific deleted vector\n" +
      "  divinci rag targets d1-provision --dry-run        # Preview without changes"
    )
    .option("--dry-run", "Preview what would be provisioned without making changes")
    .option("--yes", "Skip confirmation prompt")
    .action(async (collectionId: string | undefined, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (!opts.dryRun && !opts.yes && !isJsonMode()) {
          const { default: readline } = await import("readline");
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const msg = collectionId
            ? `Provision D1 for vector ${collectionId}? (y/N) `
            : "Provision D1 for ALL unprovisioned vectors in this workspace? (y/N) ";
          const confirmed = await new Promise<boolean>((resolve) => {
            rl.question(colors.yellow(msg), (answer) => { rl.close(); resolve(answer.toLowerCase() === "y"); });
          });
          if (!confirmed) {
            console.log(colors.dim("Aborted."));
            return;
          }
        }

        const body: Record<string, unknown> = {};
        if (opts.dryRun) body.dryRun = true;
        if (collectionId) body.ragVectorIds = [collectionId];

        const data = await withSpinner(
          opts.dryRun ? "Previewing D1 provisioning..." : "Provisioning D1 databases...",
          () => httpClient.post<{
            success: boolean;
            dryRun?: boolean;
            provisioned: number;
            skipped: number;
            failed: number;
            results?: Array<{ vectorId: string; title: string; status: string; databaseId?: string; workerName?: string; error?: string }>;
          }>(`${routeBase}/rag-vector/d1-provision`, body)
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const summary = opts.dryRun ? "Dry run complete." : "D1 provisioning complete.";
        console.log(data.failed > 0 ? colors.yellow(summary) : colors.green(summary));
        console.log(`  ${colors.dim("Provisioned:")} ${data.provisioned}`);
        console.log(`  ${colors.dim("Skipped:")}     ${data.skipped}`);
        if (data.failed > 0) console.log(`  ${colors.dim("Failed:")}      ${colors.red(String(data.failed))}`);

        if (data.results && data.results.length > 0) {
          console.log("");
          for (const r of data.results) {
            const statusIcon = r.status === "provisioned" ? "✓" : r.status === "skipped" ? "·" : "✗";
            const statusColor = r.status === "provisioned" ? colors.green : r.status === "skipped" ? colors.dim : colors.red;
            console.log(`  ${statusColor(statusIcon)} ${safeLabel(r.title)} ${colors.dim(`(${r.vectorId})`)}`);
            if (r.databaseId) console.log(`      ${colors.dim("D1:")} ${r.databaseId}`);
            if (r.workerName) console.log(`      ${colors.dim("Worker:")} ${r.workerName}`);
            if (r.error) console.log(`      ${colors.red("Error:")} ${r.error}`);
          }
        }

        if (opts.dryRun && (data.provisioned ?? 0) > 0) {
          console.log("");
          console.log(colors.dim(`Run without --dry-run to provision ${data.provisioned} vector(s).`));
        }

        if (!opts.dryRun && (data.provisioned ?? 0) > 0) {
          console.log("");
          console.log(colors.dim("After provisioning completes, re-index files with:"));
          console.log(`  divinci rag targets reindex ${collectionId ?? "<collectionId>"}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── delete ────────────────────────────────────────────────────────────────
  targets
    .command("delete <collectionId>")
    .description("Delete a RAG vector (detach-only): removes the backend index + vector metadata but preserves all indexed file source content. Manage file deletion via `divinci rag files delete` / the RAG Files page.")
    .option("--force", "Skip confirmation prompt")
    .action(async (collectionId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (!opts.force) {
          const readline = await import("readline");
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const confirmed = await new Promise<boolean>((resolve) => {
            rl.question(
              colors.yellow(`Delete RAG vector index "${collectionId}"? This removes all associated chunks. Type "yes" to confirm: `),
              (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === "yes"); }
            );
          });
          if (!confirmed) {
            console.log(colors.dim("Deletion cancelled."));
            return;
          }
        }

        const result = await withSpinner("Deleting RAG vector index...", () =>
          httpClient.delete<{ status: string; message?: string; deletedId?: string }>(
            `${routeBase}/rag/targets/${collectionId}`
          )
        );

        if (isJsonMode()) {
          output(result);
          return;
        }

        console.log(colors.green(`Index ${collectionId} deleted.`));
        if (result.message) console.log(`  ${colors.dim("Message:")} ${result.message}`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
