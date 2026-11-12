import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import {
  VALID_CHUNKING_TOOLS,
  CHUNKING_TOOL_OPTION_DESCRIPTION,
  assertValidChunkingTool,
} from "./chunking-tools.js";
import { existsSync, statSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".aac", ".aiff",
  ".mp4", ".mpeg",
]);

interface UploadResult {
  status: string;
  file: { _id: string; title: string; status: string };
  workflow?: { instanceId: string; status: string };
}

// The non-audio multipart upload endpoint (POST .../rag/files, directCreateRagVectorFile)
// returns a plain array of saved file records — NOT the { file, workflow } shape above.
// Only the audio presigned-finalize endpoint returns the { file, workflow } shape.
interface MultipartFileRecord {
  _id: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

interface FileStatusResult {
  _id: string;
  status: string;
  title?: string;
  originalFilename?: string;
  ragVectors?: TargetFileStatus[];
}

export interface TargetFileStatus {
  _id: string;
  title?: string;
  fileStatus?: string;
  failedReason?: string;
}

export interface TargetAttachResult {
  state: "attached" | "failed" | "waiting";
  /** Targets the file is not yet indexed in. */
  waitingOn: string[];
  failures: Array<{ vectorId: string, reason: string }>;
}

/**
 * Is the file actually IN every vector it was uploaded to?
 *
 * A file reaching "completed" only means it was chunked. Attaching it to each
 * target vector happens afterwards, in the background, and can fail on its
 * own. Measured 2026-10-04 (production): an ingest of 386 files reported every
 * one "completed" while 85 were in no vector at all — 82 Workers AI 429s had
 * failed their attach. `--wait` stopped at "completed", so nothing said so.
 *
 * A target missing from `ragVectors` counts as waiting, not attached: the
 * attach may not have started, and the --timeout deadline bounds the wait.
 */
export function classifyTargetAttach(
  ragVectors: TargetFileStatus[] | undefined,
  targetIds: string[],
): TargetAttachResult {
  const byId = new Map((ragVectors ?? []).map((v) => [String(v._id), v]));
  const waitingOn: string[] = [];
  const failures: Array<{ vectorId: string, reason: string }> = [];
  for (const id of targetIds) {
    const v = byId.get(id);
    const fs = String(v?.fileStatus ?? "").toLowerCase();
    if (fs === "indexed") continue;
    if (fs === "failed") {
      failures.push({ vectorId: id, reason: v?.failedReason || "no reason recorded" });
      continue;
    }
    waitingOn.push(id);
  }
  if (failures.length > 0) return { state: "failed", waitingOn, failures };
  if (waitingOn.length > 0) return { state: "waiting", waitingOn, failures };
  return { state: "attached", waitingOn, failures };
}

// Chunking tools the server actually accepts. Re-exported from the shared
// CLI constant (./chunking-tools.js) so upload/reindex/estimate can never
// drift apart again — do NOT redeclare the list here.
export const VALID_UPLOAD_CHUNKING_TOOLS = VALID_CHUNKING_TOOLS;

/**
 * Terminal/running classification for an upload's processing status.
 *
 * THE SERVER'S VOCABULARY IS THE TRUTH, and the CLI cannot import it: the
 * authority is `RagVectorTextChunksStatus` in @divinci-ai/models, which the CLI
 * does not depend on. So these literals are duplicated here on purpose and
 * pinned by scripts/ci/tests/test_rag_upload_status_vocabulary.py, which fails
 * if the enum moves.
 *
 * ⚠️ Why this exists at all: `--wait` used to break only on
 * "CHUNKED_AND_EMBEDDED" | "ready" (success) and "FAILED_TO_CHUNK" | "failed"
 * (failure). NONE of those four is a real status -- two are enum KEY names, two
 * are invented -- so the loop could not terminate on ANY upload. Measured
 * 2026-09-20: a file that indexed in ~12s left `--wait` polling for
 * 40,092s (11.1 hours) before an unrelated request timeout finally escaped.
 *
 * Three vocabularies overlap on this path, so all three are handled:
 *   - models  RagVectorTextChunksStatus  "file to chunks", "completed", ...
 *   - types   RagDocumentStatus          "processing", "completed", "error", ...
 *   - legacy  whatever older servers returned ("ready", "failed")
 */
export type UploadPhase = "done" | "failed" | "running" | "unknown";

const DONE = new Set([
  "completed",        // models COMPLETED + types
  "ready",            // legacy
  "editing chunks",   // models EDITING -- not running, and not a failure
]);

const FAILED = new Set([
  "failed to chunk",  // models FAILED_TO_CHUNK
  "source missing",   // models SOURCE_MISSING
  "error",            // types
  "failed",           // legacy
]);

const RUNNING = new Set([
  "file to chunks",   // models CHUNKING
  "chunks to storage",// models STORING
  "transcribing",     // models TRANSCRIBING
  "pending",          // types
  "uploading",
  "processing",
  "chunking",
  "embedding",
]);

/** Pure, and exported so the unit test can pin every branch. */
export function classifyUploadStatus(status: string | undefined | null): UploadPhase {
  const s = String(status ?? "").trim().toLowerCase();
  if (DONE.has(s)) return "done";
  if (FAILED.has(s)) return "failed";
  if (RUNNING.has(s)) return "running";
  return "unknown";
}

export function registerRagUploadCommand(parent: Command): void {
  parent
    .command("upload <file>")
    .description("Upload a file to the knowledge base for RAG indexing")
    .option("--targets <ids>", "Comma-separated RAG vector target IDs")
    .option("--title <title>", "Document title")
    .option("--description <desc>", "Document description")
    .option("--language <lang>", "Language hint for audio transcription (e.g. en, es, fr)")
    .option("--chapter-aware", "Prepend section headings to each chunk for structured documents (books, manuals)")
    .option("--chunking-tool <tool>", CHUNKING_TOOL_OPTION_DESCRIPTION)
    .option("--published-date <date>", "Document publish date (ISO date, e.g. 2024-03-15) — ranks newer docs higher when recency weighting is on")
    .option("--extract-published-date", "Let the AI find the publish date inside the document (small extra cost; ignored with --published-date)")
    .option("--wait", "Wait for processing to complete")
    .option("--poll-interval <seconds>", "Polling interval when --wait is used", "10")
    .option(
      "--timeout <seconds>",
      "Max time to wait under --wait before giving up (the work may still finish server-side)",
      "900"
    )
    .action(async (filePath, opts, cmd) => {
      try {
        assertValidChunkingTool(opts.chunkingTool as string | undefined);

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        // Validate file exists
        if (!existsSync(filePath)) {
          console.error(colors.red(`File not found: ${filePath}`));
          process.exit(1);
        }

        const stat = statSync(filePath);
        const fileName = basename(filePath);
        const ext = extname(filePath).toLowerCase();
        const isAudio = AUDIO_EXTENSIONS.has(ext);
        const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(1);

        console.log(colors.dim(`File: ${fileName} (${fileSizeMB} MB${isAudio ? ", audio" : ""})`));

        // Parse target IDs
        let targetIds: string[] = [];
        if (opts.targets) {
          targetIds = opts.targets.split(",").map((id: string) => id.trim()).filter(Boolean);
        }

        if (targetIds.length === 0) {
          // Fetch available targets and let user know they need to specify
          const targetsData = await withSpinner("Fetching available targets...", () =>
            httpClient.get<{ targets: Array<{ id: string; title: string; vectorIndexTool: string }> }>(
              `${routeBase}/rag/targets`
            )
          );

          if (targetsData.targets.length === 0) {
            console.error(colors.red("No RAG vector indexes found. Create one first."));
            process.exit(1);
          }

          console.error(colors.yellow("No --targets specified. Available targets:"));
          for (const t of targetsData.targets) {
            console.error(`  ${colors.cyan(t.id)}  ${t.title} (${t.vectorIndexTool})`);
          }
          console.error(colors.dim("\nUsage: divinci rag upload <file> --targets <id1,id2,...>"));
          process.exit(1);
        }

        let result: UploadResult | MultipartFileRecord[];
        let fileId: string | undefined;
        let fileStatus: string | undefined;
        let workflowInstanceId: string | undefined;

        if ((opts.publishedDate || opts.extractPublishedDate) && isAudio) {
          console.error(colors.yellow("Note: publish-date options are not supported on the audio path (transcript date is captured automatically); ignoring."));
        }

        if (isAudio) {
          // Audio files: use presigned upload flow (3 steps)
          // Step 1: Get presigned R2 upload URL
          const presignedResults = await withSpinner("Preparing upload...", () =>
            httpClient.post<Array<{
              url: string;
              expiration: number;
              location: string;
              userId: string;
              purpose: string;
              filename: string;
              byteSize: number;
              signiture: string;
            }>>(
              `${routeBase}/rag/presigned`,
              [{ byteSize: stat.size, filename: fileName }]
            )
          );

          if (!presignedResults || presignedResults.length === 0) {
            throw new Error("Failed to get presigned upload URL");
          }

          const presigned = presignedResults[0];

          // Step 2: PUT file directly to R2 via presigned URL
          const fileBuffer = readFileSync(filePath);
          await withSpinner(`Uploading ${fileName} (${fileSizeMB} MB)...`, async () => {
            const response = await fetch(presigned.url, {
              method: "PUT",
              body: fileBuffer,
            });
            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`R2 upload failed (${response.status}): ${errText.substring(0, 200)}`);
            }
          });

          // Step 3: Finalize — send presigned result JSON to trigger audio-to-rag pipeline
          const audioResult = await withSpinner("Starting audio processing pipeline...", () =>
            httpClient.post<UploadResult>(
              `${routeBase}/rag/files/audio-from-presigned`,
              {
                presignedResult: JSON.stringify(presigned),
                ragVectorIds: targetIds,
                title: opts.title || fileName,
                description: opts.description,
                language: opts.language,
              }
            )
          );
          result = audioResult;
          fileId = audioResult.file?._id;
          fileStatus = audioResult.file?.status;
          workflowInstanceId = audioResult.workflow?.instanceId;
        } else {
          // Non-audio files: use multipart upload.
          // NOTE: this endpoint (directCreateRagVectorFile) responds with a plain
          // array of saved file records, not the { file, workflow } shape the
          // audio path returns above — extract the id/status straight off the
          // first record instead of a nonexistent `.file` property.
          const fileBuffer = readFileSync(filePath);
          const chunkingConfig = opts.chapterAware
            ? { langextract: { chapterAware: true } }
            : { langextract: { chapterAware: false } };
          const multipartResult = await withSpinner(`Uploading ${fileName}...`, () =>
            httpClient.upload<MultipartFileRecord[]>(
              `${routeBase}/rag/files`,
              fileBuffer,
              fileName,
              {
                ragVectorIds: JSON.stringify(targetIds),
                title: opts.title || fileName,
                description: opts.description || "",
                chunkingTool: opts.chunkingTool || "langextract",
                chunkingToolConfig: JSON.stringify(chunkingConfig),
                ...(opts.publishedDate ? { publishedDate: opts.publishedDate } : {}),
                ...(opts.extractPublishedDate && !opts.publishedDate ? { extractPublishedDate: "true" } : {}),
              }
            )
          );
          result = multipartResult;
          fileId = multipartResult[0]?._id;
          fileStatus = multipartResult[0]?.status;
        }

        if (isJsonMode()) {
          output(result);
          return;
        }

        console.log(colors.green(`Upload started successfully!`));
        console.log(`  File ID: ${colors.cyan(fileId || "unknown")}`);
        console.log(`  Status:  ${colors.yellow(fileStatus || "processing")}`);
        if (workflowInstanceId) {
          console.log(`  Workflow: ${colors.dim(workflowInstanceId)}`);
        }

        // Wait for processing if requested
        if (opts.wait && fileId) {
          const pollInterval = Math.max(parseInt(opts.pollInterval, 10) || 10, 5) * 1000;
          const waitTimeoutMs = Math.max(parseInt(opts.timeout, 10) || 900, 30) * 1000;
          console.log(colors.dim(`\nWaiting for processing to complete (polling every ${pollInterval / 1000}s)...`));

          const deadline = Date.now() + waitTimeoutMs;
          let lastStatus = "";
          let sawUnknown = false;
          let sawAttachWait = false;
          let lastWaitingOn: string[] = [];

          for (;;) {
            if (Date.now() >= deadline) {
              console.error(
                colors.red(
                  `\nStopped waiting after ${Math.round(waitTimeoutMs / 1000)}s ` +
                    `(last status: ${lastStatus || "unknown"}).`
                )
              );
              if (lastWaitingOn.length > 0) {
                console.error(
                  colors.red(`Chunked, but still not indexed in: ${lastWaitingOn.join(", ")}`)
                );
              }
              console.error(
                colors.dim(
                  `The work may still be running server-side. Check with:\n` +
                    `  divinci rag status ${fileId}`
                )
              );
              process.exit(1);
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));

            const statusData = await httpClient.get<FileStatusResult>(
              `${routeBase}/rag/files/${fileId}`
            );

            const status = statusData.status;
            if (status !== lastStatus) {
              console.log(`  Status: ${colors.yellow(status)}`);
              lastStatus = status;
            }

            const phase = classifyUploadStatus(status);

            if (phase === "done") {
              const attach = classifyTargetAttach(statusData.ragVectors, targetIds);
              if (attach.state === "attached") {
                console.log(colors.green(`\nProcessing complete — indexed in ${targetIds.length} vector(s).`));
                break;
              }
              if (attach.state === "failed") {
                console.error(colors.red("\nChunked, but NOT added to:"));
                for (const f of attach.failures) {
                  console.error(colors.red(`  ${f.vectorId}: ${f.reason}`));
                }
                console.error(colors.dim(`Retry with: divinci rag reindex ${fileId} --targets ${attach.failures.map((f) => f.vectorId).join(",")}`));
                process.exit(1);
              }
              if (!sawAttachWait) {
                sawAttachWait = true;
                console.log(colors.dim(`  Chunked; waiting to be indexed in ${attach.waitingOn.join(", ")}...`));
              }
              lastWaitingOn = attach.waitingOn;
              continue;
            }

            if (phase === "failed") {
              console.error(colors.red(`\nProcessing failed (status: ${status}).`));
              process.exit(1);
            }

            // Unknown status: keep waiting, but say so ONCE. Silently treating
            // it as "still running" is exactly how this loop used to spin
            // forever; the deadline above is what bounds it either way.
            if (phase === "unknown" && !sawUnknown) {
              sawUnknown = true;
              console.log(
                colors.dim(
                  `  (unrecognized status ${JSON.stringify(status)} — still waiting; ` +
                    `bounded by --timeout)`
                )
              );
            }
          }
        } else if (fileId) {
          console.log(colors.dim(`\nCheck status: divinci rag status ${fileId}`));
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
