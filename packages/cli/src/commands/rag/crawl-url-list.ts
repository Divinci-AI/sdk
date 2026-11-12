/**
 * `divinci rag crawl --urls-file <file> --vector <id>` — index exactly these URLs.
 *
 * Two routes, one command:
 *   1. the server's feed route (the same one `connectors web-crawl --urls-file`
 *      uses): the list goes up in one request and the server scrapes it with its
 *      own concurrency and resumes across hops. This is the default.
 *   2. a bounded client-side pool of single-page scrapes, used when the server
 *      route cannot take the job (several target vectors, --no-index, or a
 *      server that rejects the request shape) or when --client-side asks for it.
 *
 * Why this exists: in RAG race take 11 the left agent indexed 386 pages with a
 * hand-written `xargs -P 6` loop of single-URL `rag crawl --wait` calls because
 * `rag crawl --help` mentioned only one URL (or link-following), while the
 * server-side list route sat under `connectors`. The loop took ~16 minutes and,
 * measured again on 2026-10-07, loses most of its waits to client timeouts.
 */

import { readFile } from "node:fs/promises";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { isTransientRequestError } from "../../utils/transient.js";
import { parseUrlList } from "../connectors/url-list.js";
import { followWebCrawl, reportWebCrawlOutcome } from "../connectors/web-crawl-follow.js";
import type { ResolvedConfig } from "../../config/config-manager.js";
import type { createClient } from "../../client/create-client.js";
import type { WebCrawlSettings } from "@divinci-ai/server";
import {
  isPageIndexed, splitVectorIds, startPageScrape, waitForPage, type PageHttp, type PageResult,
} from "./crawl-page.js";

export interface UrlListOptions {
  urlsFile: string;
  /** Optional site name; defaults to the origin of the first URL. */
  siteUrl?: string;
  vector: string;
  scraper: string;
  chunker: string;
  index: boolean;
  forceRefresh: boolean;
  wait: boolean;
  clientSide: boolean;
  resume: boolean;
  concurrency: number;
  pollIntervalSeconds: string;
  /** Overall timeout for the server route, when the user set one. */
  timeoutSeconds?: string;
  /** Per-page timeout for the client-side pool (seconds). */
  pageTimeoutSeconds: number;
}

export interface UrlListContext {
  client: ReturnType<typeof createClient>;
  config: ResolvedConfig;
  routeBase: string;
  json: boolean;
}

/** HTTP statuses that mean "the server cannot take this request shape" rather than "something is broken". */
const FALLBACK_STATUSES = new Set([400, 404, 405, 415, 422, 501]);

const say = (json: boolean, line: string) => {
  // eslint-disable-next-line no-console
  if (json) console.error(line); else console.log(line);
};

export async function runUrlListCrawl(ctx: UrlListContext, opts: UrlListOptions): Promise<void> {
  const { json } = ctx;
  const urls = parseUrlList(await readFile(opts.urlsFile, "utf8"));
  const vectors = splitVectorIds(opts.vector);
  const siteUrl = opts.siteUrl ?? `${new URL(urls[0]).origin}/`;

  // Everything the server route cannot do goes to the pool, and says why.
  const workspaceId = ctx.config.workspaceId;
  let reasonForPool: string | undefined;
  if (opts.clientSide) reasonForPool = "--client-side";
  else if (vectors.length !== 1) reasonForPool = "the server list route targets one vector";
  else if (!opts.index) reasonForPool = "--no-index scrapes without indexing";
  else if (!workspaceId) reasonForPool = "no workspace id for the server route";

  if (!reasonForPool) {
    const settings: WebCrawlSettings = {
      mode: "feed", feedUrl: siteUrl, feedFormat: "url-list", feedUrls: urls, targetVectorId: vectors[0],
    };
    const since = Date.now();
    try {
      const started = await withSpinner(`Queuing ${urls.length} URL(s)…`, () =>
        ctx.client.connectors.webCrawlStart(workspaceId as string, settings));
      if (!opts.wait) {
        output(started, { keyValue: true });
        // eslint-disable-next-line no-console
        if (!json) console.log(colors.dim(`\nQueued ${urls.length} URL(s); the server crawls them. Follow with --wait, or: divinci connectors list.`));
        return;
      }
      const outcome = await followWebCrawl({
        client: ctx.client, config: ctx.config, workspaceId: workspaceId as string, json,
        vectorId: vectors[0], siteUrl, since,
        pollIntervalSeconds: opts.pollIntervalSeconds,
        timeoutSeconds: opts.timeoutSeconds ?? "",
        defaultTimeoutSeconds: Math.max(900, urls.length * 10),
      });
      reportWebCrawlOutcome(outcome, vectors[0], json, true);
      return;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === undefined || !FALLBACK_STATUSES.has(status)) throw e;
      reasonForPool = `the server rejected the list (HTTP ${status}: ${(e as Error).message})`;
    }
  }

  say(json, colors.yellow(`Crawling ${urls.length} URL(s) client-side, ${opts.concurrency} at a time — ${reasonForPool}.`));
  await runClientPool(ctx, opts, urls, vectors[0]);
}

interface PageOutcome { url: string; result: "indexed" | "skipped" | "failed" | "timeout"; reason?: string }

async function runClientPool(ctx: UrlListContext, opts: UrlListOptions, urls: string[], vectorId: string): Promise<void> {
  const http = ctx.client.getHttpClient() as unknown as PageHttp;
  const pollMs = Math.max(parseInt(opts.pollIntervalSeconds, 10) || 10, 3) * 1000;
  const timeoutMs = Math.max(opts.pageTimeoutSeconds, 30) * 1000;
  const total = urls.length;
  let finished = 0;

  const crawlOne = async (url: string): Promise<PageOutcome> => {
    if (opts.resume && opts.index && await isPageIndexed(http, ctx.routeBase, url, vectorId)) {
      return { url, result: "skipped" };
    }
    let last: PageOutcome = { url, result: "failed", reason: "not attempted" };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { crawlId } = await startPageScrape(http, ctx.routeBase, {
          url, scraper: opts.scraper, chunker: opts.chunker, vector: opts.vector, index: opts.index, forceRefresh: opts.forceRefresh,
        });
        const result: PageResult = await waitForPage(
          { http, routeBase: ctx.routeBase },
          { url, crawlId, vectorId, index: opts.index, pollMs, timeoutMs },
        );
        if (result.status === "indexed" || result.status === "scraped") return { url, result: "indexed" };
        last = result.status === "timeout"
          ? { url, result: "timeout", reason: `still ${result.phase} after ${timeoutMs / 1000}s` }
          : { url, result: "failed", reason: result.phase === "index" ? (result.reason ?? "embedding failed") : "scrape failed" };
      } catch (e) {
        last = { url, result: "failed", reason: (e as Error).message };
        // A second delivery for the same page answers 423 while the first is in flight, and a
        // transient network error is worth one more try; anything else will fail the same way.
        const status = (e as { status?: number }).status;
        if (status !== 423 && !isTransientRequestError(e)) return last;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return last;
  };

  const outcomes = await runPool(urls, opts.concurrency, async (url) => {
    const out = await crawlOne(url);
    finished++;
    const mark = out.result === "indexed" ? colors.green("✓") : out.result === "skipped" ? colors.dim("•") : colors.red("✖");
    say(ctx.json, `[${finished}/${total}] ${mark} ${url}${out.reason ? colors.dim(`  ${out.reason}`) : ""}`);
    return out;
  });

  const count = (r: PageOutcome["result"]) => outcomes.filter((o) => o.result === r).length;
  const failed = outcomes.filter((o) => o.result === "failed");
  const timedOut = outcomes.filter((o) => o.result === "timeout");
  const summary = `${total} URL(s): ${count("indexed")} indexed, ${count("skipped")} skipped, ${failed.length} failed, ${timedOut.length} timed out`;
  if (ctx.json) {
    output({
      vectorId, total, indexed: count("indexed"), skipped: count("skipped"),
      failed: failed.map((o) => ({ url: o.url, reason: o.reason })), timedOut: timedOut.map((o) => o.url),
    });
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${failed.length + timedOut.length === 0 ? colors.green(summary) : colors.yellow(summary)}`);
  }
  if (failed.length + timedOut.length > 0) {
    // eslint-disable-next-line no-console
    console.error(colors.red(`\nNot indexed (${failed.length + timedOut.length}):`));
    for (const o of [...failed, ...timedOut]) {
      // eslint-disable-next-line no-console
      console.error(colors.dim(`  ${o.url}  ${o.reason ?? ""}`));
    }
    // eslint-disable-next-line no-console
    console.error(colors.dim("Re-run the same command with --resume to retry only these."));
    process.exit(failed.length > 0 ? 1 : 2);
  }
}

/** Run `worker` over `items` with at most `limit` in flight; results keep the input order. */
export async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}
