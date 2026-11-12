/**
 * divinci rag chunks — paginate raw chunks under a single RAG vector.
 *
 * Wraps `GET /white-label/:wlId/rag-vector/:ragId/all-chunks`. Audit-only
 * surface: no query, no LLM, just enumerate what's actually indexed.
 * Use this when you suspect an index has duplicate or low-quality chunks
 * and want to inspect content before reindexing.
 */
import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface ChunkListItem {
  _id: string;
  text: string;
  source: "original" | "user-added" | "user-edited";
  docSource?: { model?: string; _id?: string };
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
  version?: number;
}

interface ChunksResponse {
  ragId: string;
  ragTitle: string | null;
  total: number | null;
  offset: number | null;
  length: number;
  sourceDocCount: number;
  storageBackend?: "mongo" | "d1" | "inline";
  nextCursor?: string | number | null;
  page: ChunkListItem[];
  note?: string;
}

export function registerRagChunksCommand(parent: Command): void {
  parent
    .command("chunks <vectorId>")
    .description("List raw chunks under a RAG vector (audit primitive — no query, no LLM)")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--length <n>", "Page size (max 200)", "50")
    .option("--preview <chars>", "Truncate each chunk's text to N chars in human output", "300")
    .option("--backend <name>", "Storage backend: auto (Mongo + D1 fallback), mongo, d1 (force file1 D1), or inline (scroll vector backend payload — Qdrant only; last resort for orphaned legacy vectors)", "auto")
    .option("--cursor <c>", "Opaque pagination cursor for backend=inline (use nextCursor from prior response)", "")
    .action(async (vectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
        const length = Math.max(1, Math.min(200, parseInt(opts.length, 10) || 50));
        const preview = Math.max(50, parseInt(opts.preview, 10) || 300);

        const backend = (typeof opts.backend === "string" ? opts.backend : "auto").toLowerCase();
        const cursor = typeof opts.cursor === "string" ? opts.cursor : "";
        const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const res = await withSpinner(`Listing chunks for ${vectorId} (offset=${offset}, length=${length}, backend=${backend}${cursor ? `, cursor=${cursor.slice(0, 12)}…` : ""})...`, () =>
          httpClient.get<ChunksResponse>(
            `${routeBase}/rag-vector/${vectorId}/all-chunks?offset=${offset}&length=${length}&backend=${encodeURIComponent(backend)}${cursorParam}`,
            undefined,
            // The all-chunks AUDIT path on v8 Vertex-AI/D1 vectors can take far
            // longer than the 30s SDK default (per-vector D1 worker cold start +
            // prefix scan). Raise to 90s — under Cloudflare's ~100s proxy 524
            // ceiling on api.*.divinci.app. Vectors that still exceed this need
            // the async-audit job (see notebooks/2026-05-30-rag-all-chunks-timeout-off.md).
            { timeout: 90_000 },
          )
        );

        if (isJsonMode()) { output(res as any); return; }

        console.log();
        console.log(colors.bold(res.ragTitle || res.ragId));
        const totalDisplay = res.total === null ? "?" : String(res.total);
        const offsetDisplay = res.offset === null ? "?" : String(res.offset);
        const endDisplay = res.total === null ? "?" : String(Math.min((res.offset ?? 0) + res.length, res.total));
        const backendLabel = res.storageBackend ? `  backend=${res.storageBackend}` : "";
        console.log(
          `  id=${res.ragId}  total=${totalDisplay}  ` +
          `showing=[${offsetDisplay}, ${endDisplay})  ` +
          `sourceDocs=${res.sourceDocCount}${backendLabel}`,
        );
        if (res.nextCursor) {
          console.log(`  nextCursor=${colors.gray(String(res.nextCursor))}`);
        }
        if (res.note) console.log(`  ${colors.yellow("note")}: ${res.note}`);
        console.log();

        for (let i = 0; i < res.page.length; i++) {
          const c = res.page[i];
          const idx = (res.offset ?? 0) + i;
          const text = (c.text || "").replace(/\s+/g, " ").trim();
          const truncated = text.length > preview ? text.slice(0, preview) + "…" : text;
          const docModel = c.docSource?.model || "?";
          const docId = c.docSource?._id || "?";
          const mdParts: string[] = [];
          if (c.metadata && typeof c.metadata === "object") {
            const m = c.metadata as Record<string, unknown>;
            if (typeof m.sftPairId === "string") mdParts.push(`sftPairId=${m.sftPairId}`);
            if (typeof m.mode === "string") mdParts.push(`mode=${m.mode}`);
          }
          const mdTag = mdParts.length ? `  [${mdParts.join(" ")}]` : "";
          console.log(
            `  ${colors.gray(`[${idx}]`)} ${colors.gray(c._id)}  ${colors.gray(`src=${docModel}/${docId}`)}${mdTag}`,
          );
          console.log(`    ${truncated}`);
        }
        console.log();
        if (res.nextCursor) {
          console.log(colors.gray(
            `  next: divinci rag chunks ${vectorId} --backend ${backend} --cursor ${res.nextCursor} --length ${res.length}`,
          ));
          console.log();
        } else if (res.total !== null && res.offset !== null && res.offset + res.length < res.total) {
          console.log(colors.gray(
            `  next: divinci rag chunks ${vectorId} --offset ${res.offset + res.length} --length ${res.length}`,
          ));
          console.log();
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
