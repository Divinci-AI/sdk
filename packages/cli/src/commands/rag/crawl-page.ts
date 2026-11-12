/**
 * Scrape ONE page into a RAG vector and wait for it — the single-URL half of
 * `divinci rag crawl`, factored out so the URL-list fallback can run it N at a
 * time without re-implementing the wait.
 *
 * What the old inline wait got wrong, measured on production 2026-10-07 (six
 * parallel `rag crawl --wait` over 20 pages: 463 s, 14 of 20 exited 1):
 *   - it slept a full poll interval BEFORE its first poll, so every page cost at
 *     least 10 s of nothing;
 *   - every index poll downloaded the WHOLE vector document (every chunk source
 *     it holds), so a poll got slower as the vector filled;
 *   - one request that outlived the client's 30 s timeout killed the command,
 *     because the client never retries a timeout — while the server went on to
 *     index the page anyway.
 * This module polls first, asks one small question per poll (this page's file
 * status), and treats a slow answer as a missed poll.
 */

import { classifyTargetAttach, type TargetFileStatus } from "./upload.js";
import { createTolerantPoller, POLL_REQUEST_TIMEOUT_MS } from "../../utils/transient.js";

// Default tool ids. `@mendable/firecrawl` is FireCrawl Cloud — the scraper
// staging/prod actually have an API key for. (The OSS `@divinci-ai/firecrawl`
// needs a self-hosted FIRECRAWL_OSS_URL that isn't configured, so it silently
// fails.) langextract is the chunker the DFO content already uses. The
// embeddings tool is intentionally left blank — the server auto-resolves it
// from the target vector's own `embeddingModel` (see getVectorIndexes /
// getFirstMatchingEmbeddingsTool), so a crawl always embeds with the same
// model the vector was built on.
// Default to the free self-hosted fetch scraper. @mendable/firecrawl is the
// CLOUD FireCrawl service — credit-metered, and a full-site crawl can exhaust
// an account's monthly credits in minutes (observed 2026-06-12). Pass
// --scraper @mendable/firecrawl explicitly when its extraction quality is
// worth the spend.
export const DEFAULT_SCRAPER = "@divinci-ai/fetch-scraper";
export const DEFAULT_CHUNKER = "@divinci-ai/langextract";

// langextract validates its config strictly — an empty {} is rejected with a
// generic 400. Supply its standard defaults when the chunker is langextract
// and no explicit config was provided.
const LANGEXTRACT_DEFAULT_CONFIG = { maxCharBuffer: 1000, tokenizerType: "auto", overlapChars: 200 };

export function chunkerConfigFor(chunkerId: string): Record<string, unknown> {
  return chunkerId === "@divinci-ai/langextract" ? { ...LANGEXTRACT_DEFAULT_CONFIG } : {};
}

export function splitVectorIds(csv: string): string[] {
  return String(csv).split(",").map((v) => v.trim()).filter(Boolean);
}

/**
 * chunkConfig is what wires a scraped page into a vector. Omitting it
 * (--no-index) scrapes the page and stores the HTML doc without adding it to
 * any vector index.
 */
export function buildChunkConfig(opts: { index: boolean; chunker: string; vector: string }) {
  if (!opts.index) return undefined;
  return {
    chunkerTool: { id: opts.chunker, authId: "", config: chunkerConfigFor(opts.chunker) },
    addToRagVector: splitVectorIds(opts.vector).map((vectorIndexId) => ({
      vectorIndexId,
      // Empty id → server resolves the vector's own embedding model.
      embeddingsTool: { id: "", authId: "", config: {} },
    })),
  };
}

export interface PageHttp {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, options?: { timeout?: number }): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

export interface CrawlHistoryItem {
  _id: string;
  status?: string;
  scrapedPaths?: string[];
  unscrapedPaths?: string[];
  failedPaths?: string[];
}
interface CrawlHistoryResponse { crawls?: CrawlHistoryItem[] }

interface PageFileRef { _id: string; updateTimestamp?: number; status?: string }
interface PageDoc { _id?: string; files2?: PageFileRef[]; files1?: PageFileRef[] }
interface FileStatusDoc { status?: string; ragVectors?: TargetFileStatus[] }
interface ChunkSourceRef { docId: string; reason?: string }
export interface VectorDoc {
  chunkSources?: ChunkSourceRef[];
  pendingChunkSources?: ChunkSourceRef[];
  failedChunkSources?: ChunkSourceRef[];
}

/** POST the single-page scrape; returns the crawl id to wait on. */
export async function startPageScrape(
  http: PageHttp,
  routeBase: string,
  args: { url: string; scraper: string; chunker: string; vector: string; index: boolean; forceRefresh?: boolean },
): Promise<{ crawlId: string }> {
  const body: Record<string, unknown> = {
    url: args.url,
    scraperTool: { id: args.scraper, authId: "", config: {} },
  };
  const chunkConfig = buildChunkConfig(args);
  if (chunkConfig) body.chunkConfig = chunkConfig;
  // --force-refresh: ignore any cached copy of each page (lastUpdate must be
  // newer than minCacheDate to be reused → nothing qualifies → fresh scrape).
  if (args.forceRefresh) body.minCacheDate = Date.now();
  return http.post<{ crawlId: string }>(`${routeBase}/rag-vector/html-page/scrape`, body);
}

export type PageEvent =
  | { type: "scrape"; status: string }
  | { type: "index"; state: "waiting-for-file" | "embedding" }
  | { type: "slow"; message: string };

export type PageResult =
  | { status: "scraped"; crawlId: string }
  | { status: "indexed"; crawlId: string; fileId: string }
  | { status: "failed"; phase: "scrape"; crawlId: string; crawl?: CrawlHistoryItem }
  | { status: "failed"; phase: "index"; crawlId: string; fileId: string; reason?: string }
  | { status: "timeout"; phase: "scraping" | "indexing"; crawlId: string };

export interface WaitForPageDeps {
  http: PageHttp;
  routeBase: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onEvent?: (event: PageEvent) => void;
}

export interface WaitForPageArgs {
  url: string;
  crawlId: string;
  /** Vector the page is being indexed into (the first of a comma list). */
  vectorId: string;
  /** False for --no-index: stop once the page is scraped. */
  index: boolean;
  pollMs: number;
  timeoutMs: number;
}

/**
 * The first polls come quickly: a single page usually scrapes in a few seconds,
 * and waiting a full interval for the first look is where `--wait` used to lose
 * its time. After the ramp it settles to the caller's interval.
 */
const RAMP_MS = [2_000, 3_000, 5_000];
const delayFor = (poll: number, pollMs: number) => Math.min(pollMs, RAMP_MS[poll] ?? pollMs);

export async function waitForPage(deps: WaitForPageDeps, args: WaitForPageArgs): Promise<PageResult> {
  const { http, routeBase } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const emit = deps.onEvent ?? (() => {});
  const deadline = now() + args.timeoutMs;
  const host = encodeURIComponent(new URL(args.url).host);
  const slow = createTolerantPoller((e) => emit({ type: "slow", message: e.message }));
  const get = <T>(path: string) => slow(() => http.get<T>(path, undefined, { timeout: POLL_REQUEST_TIMEOUT_MS }));

  // ---- Phase 1: scrape. Poll first, sleep after. ----
  let polls = 0;
  for (;;) {
    const history = await get<CrawlHistoryResponse>(`${routeBase}/rag-vector/html-page/hosts/${host}`);
    if (history) {
      const crawl = history.crawls?.find((c) => c._id === args.crawlId);
      const status = crawl?.status || "pending";
      emit({ type: "scrape", status });
      if (status === "completed") break;
      if (status === "failed") return { status: "failed", phase: "scrape", crawlId: args.crawlId, crawl };
    }
    if (now() >= deadline) return { status: "timeout", phase: "scraping", crawlId: args.crawlId };
    await sleep(delayFor(polls++, args.pollMs));
  }
  if (!args.index) return { status: "scraped", crawlId: args.crawlId };

  // ---- Phase 2: index. Resolve the page's file once, then ask only about it. ----
  let fileId: string | undefined;
  polls = 0;
  for (;;) {
    if (!fileId) fileId = await resolvePageFileId(get, routeBase, args.url);
    if (fileId) {
      const verdict = await indexVerdict(get, routeBase, fileId, args.vectorId);
      if (verdict?.state === "attached") return { status: "indexed", crawlId: args.crawlId, fileId };
      if (verdict?.state === "failed") {
        return { status: "failed", phase: "index", crawlId: args.crawlId, fileId, reason: verdict.reason };
      }
      if (verdict) emit({ type: "index", state: "embedding" });
    } else {
      emit({ type: "index", state: "waiting-for-file" });
    }
    if (now() >= deadline) return { status: "timeout", phase: "indexing", crawlId: args.crawlId };
    await sleep(delayFor(polls++, args.pollMs));
  }
}

type Get = <T>(path: string) => Promise<T | undefined>;

/**
 * The newest file a scraped page produced.
 *
 * NOTE: the page's files2[] is only populated by the per-id GET
 * (/html-page/:pageId, which $lookup-joins files) — the by-URL lookup
 * (/html-page/url) returns the raw doc with NO files2, so the pageId is
 * resolved by URL first and the joined page fetched by id.
 */
async function resolvePageFileId(get: Get, routeBase: string, url: string): Promise<string | undefined> {
  const pageRef = await get<PageDoc>(`${routeBase}/rag-vector/html-page/url?url=${encodeURIComponent(url)}`).catch(() => undefined);
  const page = pageRef?._id ? await get<PageDoc>(`${routeBase}/rag-vector/html-page/${pageRef._id}`).catch(() => undefined) : undefined;
  const files = [...(page?.files2 ?? []), ...(page?.files1 ?? [])];
  return files.sort((a, b) => (b.updateTimestamp ?? 0) - (a.updateTimestamp ?? 0))[0]?._id;
}

/** Is this page already searchable in the vector? Used to resume an interrupted list. */
export async function isPageIndexed(http: PageHttp, routeBase: string, url: string, vectorId: string): Promise<boolean> {
  const get: Get = async <T>(path: string) => {
    try {
      return await http.get<T>(path, undefined, { timeout: POLL_REQUEST_TIMEOUT_MS });
    } catch {
      return undefined;
    }
  };
  const fileId = await resolvePageFileId(get, routeBase, url);
  if (!fileId) return false;
  return (await indexVerdict(get, routeBase, fileId, vectorId))?.state === "attached";
}

/**
 * Is this file in the vector yet? One small request: the file's own status
 * carries a per-vector verdict (the same one `rag upload --wait` trusts). A
 * server that predates that field gets the old whole-vector check instead.
 */
async function indexVerdict(
  get: Get, routeBase: string, fileId: string, vectorId: string,
): Promise<{ state: "attached" | "waiting" | "failed"; reason?: string } | undefined> {
  const file = await get<FileStatusDoc>(`${routeBase}/rag/files/${fileId}`);
  if (!file) return undefined;
  if (file.ragVectors !== undefined) {
    const attach = classifyTargetAttach(file.ragVectors, [vectorId]);
    if (attach.state === "attached") return { state: "attached" };
    if (attach.state === "failed") return { state: "failed", reason: attach.failures[0]?.reason };
    return { state: "waiting" };
  }
  const vector = await get<VectorDoc>(`${routeBase}/rag-vector/${vectorId}`);
  if (!vector) return undefined;
  if (vector.chunkSources?.some((s) => s.docId === fileId)) return { state: "attached" };
  const failed = vector.failedChunkSources?.find((s) => s.docId === fileId);
  if (failed) return { state: "failed", reason: failed.reason };
  return { state: "waiting" };
}
