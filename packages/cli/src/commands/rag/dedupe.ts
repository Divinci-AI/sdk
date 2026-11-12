/**
 * divinci rag dedupe — Phase 2 (chunks) + Phase 3 (files) dedupe commands.
 *
 * - `divinci rag dedupe <vectorId>` → exact-text chunk dedupe
 * - `divinci rag dedupe-files <vectorId>` → upstream file-level dedupe
 * - `divinci rag scan-artifacts <vectorId>` → flag PDF-parse artifact rot
 */
import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface DedupeChunkGroup {
  hash: string;
  count: number;
  keepId: string;
  removeIds: string[];
  textPreview: string;
}
interface DedupeChunksResponse {
  ragId: string;
  strategy: string;
  totalScanned: number;
  duplicateGroupCount: number;
  totalDupRowsToRemove: number;
  applied: boolean;
  removeIdsWithEmbeddings?: number;
  keepersMovedToEmbeddedCopy?: number;
  duplicateGroups?: DedupeChunkGroup[];
  truncated?: boolean;
  mongoModifiedCount?: number;
  vectorIndexDeleted?: number;
  note?: string;
}

interface DedupeFileGroup {
  fingerprint: string;
  count: number;
  keepDocId: string;
  removeDocIds: string[];
}
interface DedupeFilesResponse {
  ragId: string;
  strategy: string;
  scannedFiles: number;
  duplicateGroupCount: number;
  totalFilesToRemove: number;
  applied: boolean;
  duplicateGroups?: DedupeFileGroup[];
  truncated?: boolean;
  chunkSoftDeleteModifiedCount?: number;
  filesRemovedFromVector?: number;
  note?: string;
}

interface SuspectSource {
  docId: string;
  chunkCount: number;
  brokenWordsPerChunk: number;
  interLetterSpacesPerChunk: number;
  avgPunctRatio: number;
  score: number;
  worstSamples: Array<{ chunkId: string, brokenWords: number, preview: string }>;
}
interface ScanArtifactsResponse {
  ragId: string;
  totalChunksScanned: number;
  totalSourceDocs: number;
  suspectSourceCount: number;
  suspectSources: SuspectSource[];
  note: string;
}

export function registerRagDedupeChunksCommand(parent: Command): void {
  parent
    .command("dedupe <vectorId>")
    .description("Exact-text chunk dedupe (Phase 2). Dry-run by default; --apply soft-deletes duplicates.")
    .option("--strategy <s>", "Dedupe strategy (only 'exact' supported)", "exact")
    .option("--apply", "Actually delete duplicates (default: dry-run)", false)
    .action(async (vectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const res = await withSpinner(
          `Dedupe-chunks (${opts.apply ? "APPLY" : "dry-run"}) on ${vectorId}...`,
          () => httpClient.post<DedupeChunksResponse>(
            `${routeBase}/rag-vector/${vectorId}/chunk-dedupe`,
            { strategy: opts.strategy, apply: !!opts.apply },
          ),
        );

        if (isJsonMode()) { output(res as any); return; }

        console.log();
        console.log(colors.bold(`Chunk dedupe — ${res.ragId}`));
        console.log(`  strategy=${res.strategy}  scanned=${res.totalScanned}  ` +
          `duplicateGroups=${res.duplicateGroupCount}  rowsToRemove=${res.totalDupRowsToRemove}`);
        // "Duplicate" does not imply "unembedded" — repeated ingest attempts
        // embed multiple copies. Surface both numbers so the operator can see
        // how much live content the removal set touches before applying.
        if (typeof res.removeIdsWithEmbeddings === "number") {
          const n = res.removeIdsWithEmbeddings;
          const paint = n > 0 ? colors.yellow : colors.gray;
          console.log(`  ${paint(`removalSetWithEmbeddings=${n}`)}` +
            `  ${colors.gray(`keepersMovedToEmbeddedCopy=${res.keepersMovedToEmbeddedCopy ?? 0}`)}`);
        }
        if (res.applied) {
          console.log(`  ${colors.green(`✓ applied — ${res.mongoModifiedCount} chunks soft-deleted`)}` +
            (typeof res.vectorIndexDeleted === "number"
              ? `, ${res.vectorIndexDeleted} index points dropped`
              : ""));
        } else {
          console.log(`  ${colors.yellow("dry-run — re-run with --apply to soft-delete")}`);
        }
        if (res.note) console.log(`  ${colors.gray(res.note)}`);
        console.log();
        for (const g of (res.duplicateGroups || []).slice(0, 20)) {
          console.log(`  ${colors.bold(`×${g.count}`)}  keep=${colors.gray(g.keepId)}  remove=${g.removeIds.length}`);
          console.log(`    ${colors.gray(g.textPreview.slice(0, 160))}${g.textPreview.length > 160 ? "…" : ""}`);
        }
        if (res.truncated) console.log(colors.gray(`  ... (${res.duplicateGroupCount - 20} more groups; use --json for full list)`));
        console.log();
      } catch (error) { handleCommandError(error); }
    });
}

export function registerRagDedupeFilesCommand(parent: Command): void {
  parent
    .command("dedupe-files <vectorId>")
    .description("File-level dedupe by chunk-content fingerprint (Phase 3). Removes duplicate source files from this vector.")
    .option("--strategy <s>", "Dedupe strategy (only 'chunks-fingerprint' supported)", "chunks-fingerprint")
    .option("--apply", "Actually unlink duplicate files (default: dry-run)", false)
    .action(async (vectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const res = await withSpinner(
          `Dedupe-files (${opts.apply ? "APPLY" : "dry-run"}) on ${vectorId}...`,
          () => httpClient.post<DedupeFilesResponse>(
            `${routeBase}/rag-vector/${vectorId}/file-dedupe`,
            { strategy: opts.strategy, apply: !!opts.apply },
          ),
        );

        if (isJsonMode()) { output(res as any); return; }

        console.log();
        console.log(colors.bold(`File dedupe — ${res.ragId}`));
        console.log(`  strategy=${res.strategy}  scannedFiles=${res.scannedFiles}  ` +
          `duplicateGroups=${res.duplicateGroupCount}  filesToRemove=${res.totalFilesToRemove}`);
        if (res.applied) {
          console.log(`  ${colors.green(`✓ applied — ${res.filesRemovedFromVector} files unlinked, ${res.chunkSoftDeleteModifiedCount} chunks soft-deleted`)}`);
        } else {
          console.log(`  ${colors.yellow("dry-run — re-run with --apply to unlink")}`);
        }
        if (res.note) console.log(`  ${colors.gray(res.note)}`);
        console.log();
        for (const g of (res.duplicateGroups || []).slice(0, 20)) {
          console.log(`  ${colors.bold(`×${g.count}`)}  keep=${colors.gray(g.keepDocId)}`);
          for (const rid of g.removeDocIds.slice(0, 5)) {
            console.log(`    remove ${colors.gray(rid)}`);
          }
          if (g.removeDocIds.length > 5) console.log(colors.gray(`    ... ${g.removeDocIds.length - 5} more`));
        }
        if (res.truncated) console.log(colors.gray(`  ... (${res.duplicateGroupCount - 20} more groups; use --json for full list)`));
        console.log();
      } catch (error) { handleCommandError(error); }
    });
}

export function registerRagScanArtifactsCommand(parent: Command): void {
  parent
    .command("scan-artifacts <vectorId>")
    .description("Heuristic scan for PDF-parse artifacts (broken words, inter-letter spacing). Flags source docs to reindex.")
    .option("--limit <n>", "Max suspect sources to return", "20")
    .action(async (vectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const limit = Math.max(1, Math.min(50, parseInt(opts.limit, 10) || 20));
        const res = await withSpinner(
          `Scanning ${vectorId} for parse artifacts...`,
          () => httpClient.get<ScanArtifactsResponse>(
            `${routeBase}/rag-vector/${vectorId}/scan-chunk-artifacts?limit=${limit}`,
          ),
        );

        if (isJsonMode()) { output(res as any); return; }

        console.log();
        console.log(colors.bold(`Parse-artifact scan — ${res.ragId}`));
        console.log(`  scannedChunks=${res.totalChunksScanned}  scannedSources=${res.totalSourceDocs}  ` +
          `suspectSources=${res.suspectSourceCount}`);
        console.log(`  ${colors.gray(res.note)}`);
        console.log();
        for (const s of res.suspectSources.slice(0, limit)) {
          const sev = s.score > 2 ? colors.red : s.score > 1 ? colors.yellow : colors.gray;
          console.log(`  ${sev(`score=${s.score.toFixed(2)}`)}  docId=${colors.gray(s.docId)}  ` +
            `chunks=${s.chunkCount}  brokenWords/chunk=${s.brokenWordsPerChunk.toFixed(2)}  ` +
            `interLetterSpaces/chunk=${s.interLetterSpacesPerChunk.toFixed(2)}  ` +
            `punctRatio=${(s.avgPunctRatio * 100).toFixed(1)}%`);
          for (const w of s.worstSamples.slice(0, 1)) {
            console.log(`    ${colors.gray(`worst sample (bw=${w.brokenWords}): ${w.preview.slice(0, 200)}${w.preview.length > 200 ? "…" : ""}`)}`);
          }
        }
        console.log();
      } catch (error) { handleCommandError(error); }
    });
}
