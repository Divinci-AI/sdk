import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { POLL_REQUEST_TIMEOUT_MS } from "../../utils/transient.js";
import { printPostIngestHealth } from "./post-ingest-health.js";
import {
  DEFAULT_SCRAPER, DEFAULT_CHUNKER, buildChunkConfig, splitVectorIds,
  startPageScrape, waitForPage, type PageHttp, type PageEvent, type VectorDoc,
} from "./crawl-page.js";
import { runUrlListCrawl } from "./crawl-url-list.js";

interface CrawlResponse {
  crawlId: string;
}

export function registerRagCrawlCommand(parent: Command): void {
  parent
    .command("crawl [url]")
    .description(
      "Scrape (or crawl) a web page and index it into a RAG vector. " +
      "To index an exact list of URLs, pass --urls-file <file> (one URL per line, or a JSON array): " +
      "the server crawls the whole list in parallel, with --wait following it to the end."
    )
    .requiredOption("--vector <ids>", "RAG vector index id(s) to add the scraped content into — comma-separated for multiple (e.g. --vector idA,idB,idC)")
    .option("--urls-file <path>", "Index exactly the URLs in a local file (one per line, or a JSON array) — a list of pages, not a site crawl. [url] is then optional (it names the site)")
    .option("--concurrency <n>", "With --urls-file, pages crawled at once when the server's list route can't be used (default 4, max 8)", "4")
    .option("--client-side", "With --urls-file, skip the server's list route and crawl page by page from this machine")
    .option("--resume", "With --urls-file on the client-side route, skip pages already indexed in the vector (use after an interrupted run)")
    .option("--scraper <id>", "Scraper tool id", DEFAULT_SCRAPER)
    .option("--chunker <id>", "Chunker tool id", DEFAULT_CHUNKER)
    .option("--multi", "Multi-page crawl mode: follow links from the URL instead of scraping a single page")
    .option("--limit <n>", "Max pages to fetch in --multi mode", "25")
    .option("--sitemap", "Use the site's sitemap to discover pages (--multi mode)")
    .option("--include-paths <paths>", "Comma-separated path prefixes to allow (--multi mode)")
    .option("--exclude-paths <paths>", "Comma-separated path prefixes to skip (--multi mode)")
    .option("--ignore-saved", "Skip pages already saved for this host — incremental crawl, only fetches NEW paths (--multi mode). NOTE: does NOT refresh stale pages; use --force-refresh for that.")
    .option("--force-refresh", "Re-scrape every page from its URL, ignoring the cached copy (sets minCacheDate=now). Use when the source content OR the scraper changed and you need fresh content.")
    .option("--no-index", "Scrape only — create the HTML page doc but do NOT add it to a vector")
    .option("--wait", "Poll until the page is actually indexed (or failed)")
    .option("--poll-interval <seconds>", "Polling interval when --wait is used (the first polls come sooner)", "10")
    .option("--timeout <seconds>", "Max time to wait under --wait before giving up (the work may still finish server-side). Default 300 per page; with --urls-file, 15 minutes or 10 s per URL, whichever is longer", "300")
    .action(async (urlArg: string | undefined, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (opts.urlsFile) {
          if (opts.multi) {
            console.error(colors.red("--urls-file cannot be combined with --multi (a list is not a link-following crawl)."));
            process.exit(1);
          }
          await runUrlListCrawl(
            { client, config, routeBase, json: isJsonMode() },
            {
              urlsFile: opts.urlsFile,
              siteUrl: urlArg,
              vector: String(opts.vector),
              scraper: opts.scraper,
              chunker: opts.chunker,
              index: opts.index !== false,
              forceRefresh: Boolean(opts.forceRefresh),
              wait: Boolean(opts.wait),
              clientSide: Boolean(opts.clientSide),
              resume: Boolean(opts.resume),
              concurrency: Math.min(Math.max(parseInt(opts.concurrency, 10) || 4, 1), 8),
              pollIntervalSeconds: String(opts.pollInterval),
              timeoutSeconds: cmd.getOptionValueSource("timeout") === "cli" ? String(opts.timeout) : undefined,
              pageTimeoutSeconds: parseInt(opts.timeout, 10) || 300,
            },
          );
          return;
        }
        if (!urlArg) {
          console.error(colors.red("Give a URL to crawl, or --urls-file <file> to index a list of pages."));
          process.exit(1);
        }

        // Validate the URL up front so we fail before a round-trip.
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(urlArg);
        } catch {
          console.error(colors.red(`Invalid URL: ${urlArg}`));
          process.exit(1);
        }

        const chunkConfig = buildChunkConfig({ index: opts.index !== false, chunker: opts.chunker, vector: String(opts.vector) });
        const scraperTool = { id: opts.scraper, authId: "", config: {} };

        const isMulti = !!opts.multi;
        let result: CrawlResponse;
        if (isMulti) {
          const body: Record<string, unknown> = { url: urlArg, scraperTool };
          if (chunkConfig) body.chunkConfig = chunkConfig;
          if (opts.forceRefresh) body.minCacheDate = Date.now();
          body.limit = parseInt(opts.limit, 10) || 25;
          body.runSitemap = !!opts.sitemap;
          body.ignoreSavedPaths = !!opts.ignoreSaved;
          body.validGetParameters = [];
          body.allowedPaths = opts.includePaths
            ? opts.includePaths.split(",").map((p: string) => p.trim()).filter(Boolean)
            : [];
          body.excludePaths = opts.excludePaths
            ? opts.excludePaths.split(",").map((p: string) => p.trim()).filter(Boolean)
            : [];
          result = await withSpinner(`Starting crawl of ${parsedUrl.host}...`, () =>
            httpClient.post<CrawlResponse>(`${routeBase}/rag-vector/html-page/crawl`, body));
        } else {
          result = await withSpinner(`Scraping ${urlArg}...`, () =>
            startPageScrape(httpClient as unknown as PageHttp, routeBase, {
              url: urlArg, scraper: opts.scraper, chunker: opts.chunker, vector: String(opts.vector),
              index: opts.index !== false, forceRefresh: Boolean(opts.forceRefresh),
            }));
        }

        if (isJsonMode()) {
          output(result);
          if (!opts.wait) return;
        } else {
          console.log(colors.green(isMulti ? "Crawl started!" : "Scrape started!"));
          console.log(`  URL:      ${colors.cyan(urlArg)}`);
          console.log(`  Crawl ID: ${colors.cyan(result.crawlId)}`);
          if (chunkConfig) {
            console.log(`  Vector(s): ${colors.cyan(String(opts.vector))}`);
            console.log(`  Scraper:  ${colors.dim(opts.scraper)}`);
            console.log(`  Chunker:  ${colors.dim(opts.chunker)}`);
          } else {
            console.log(`  Mode:     ${colors.dim("scrape-only (not added to a vector)")}`);
          }
        }

        const primaryVector = splitVectorIds(String(opts.vector))[0];
        if (!opts.wait) {
          if (!isJsonMode()) {
            console.log(
              colors.dim(
                `\nTrack progress: divinci rag files --status processing  (per-page), or ` +
                `divinci rag targets get ${primaryVector}  ` +
                `(fileCount appears only after embedding completes — 0 during ingest is normal), ` +
                  `or poll the crawl history for ${parsedUrl.host}.`,
              ),
            );
          }
          return;
        }

        // --wait happens in two phases (see crawl-page.ts):
        //   Phase 1 — scrape: the crawl history resolves the crawlId
        //             ("completed" = the page was fetched + chunked).
        //   Phase 2 — index: "completed" does NOT mean the page is in the
        //             vector — embedding into the index is a separate async
        //             step, so the page's file is watched until it is actually
        //             indexed (or failed): a truthful one-shot.
        const pollMs = Math.max(parseInt(opts.pollInterval, 10) || 10, 3) * 1000;
        const timeoutMs = Math.max(parseInt(opts.timeout, 10) || 300, 30) * 1000;
        if (!isJsonMode()) {
          console.log(colors.dim(`\nWaiting up to ${timeoutMs / 1000}s (polling every ${pollMs / 1000}s, sooner at first)...`));
        }

        let lastLine = "";
        const onEvent = (e: PageEvent) => {
          if (isJsonMode()) return;
          const line = e.type === "scrape" ? `  Scrape: ${colors.yellow(e.status)}`
            : e.type === "index" ? `  Index:  ${colors.yellow(e.state === "embedding" ? "embedding…" : "waiting for file…")}`
            : colors.dim(`  (API slow: ${e.message} — still waiting)`);
          if (line !== lastLine) { console.log(line); lastLine = line; }
        };

        const waited = await waitForPage(
          { http: httpClient as unknown as PageHttp, routeBase, onEvent },
          { url: urlArg, crawlId: result.crawlId, vectorId: primaryVector, index: Boolean(chunkConfig), pollMs, timeoutMs },
        );

        if (waited.status === "timeout") {
          // The server keeps working after we stop watching — make that explicit
          // rather than implying failure.
          if (isJsonMode()) output({ crawlId: result.crawlId, phase: waited.phase, status: "timeout" });
          else {
            console.error(colors.yellow(`\n⏱  Gave up waiting after ${timeoutMs / 1000}s (still ${waited.phase}).`));
            console.error(colors.dim("The work may still finish server-side. Check:"));
            console.error(colors.dim(`  divinci rag targets get ${primaryVector}   (watch fileCount)`));
            console.error(colors.dim(`  divinci rag test-retrieval ${primaryVector} "<query from the page>"`));
          }
          process.exit(2);
        }

        if (waited.status === "failed" && waited.phase === "scrape") {
          if (isJsonMode()) output({ crawlId: result.crawlId, phase: "scrape", status: "failed", crawl: waited.crawl });
          else {
            console.error(colors.red("\nScrape failed."));
            if (waited.crawl?.failedPaths?.length) console.error(colors.dim(`Failed paths: ${waited.crawl.failedPaths.join(", ")}`));
          }
          process.exit(1);
        }

        // Scrape-only run: nothing more to confirm.
        if (waited.status === "scraped") {
          if (isJsonMode()) output({ crawlId: result.crawlId, phase: "scrape", status: "completed" });
          else console.log(colors.green("\nScrape complete (scrape-only, not indexed)."));
          return;
        }

        if (waited.status === "failed") {
          if (isJsonMode()) output({ crawlId: result.crawlId, phase: "index", status: "failed", fileId: waited.fileId, reason: waited.reason });
          else {
            console.error(colors.red("\n✖ Embedding into the vector failed."));
            console.error(colors.dim(`  File:   ${waited.fileId}`));
            if (waited.reason) console.error(colors.dim(`  Reason: ${waited.reason}`));
          }
          process.exit(1);
        }

        // Indexed. One look at the vector for the source count — once, not per poll.
        const vector = await httpClient
          .get<VectorDoc>(`${routeBase}/rag-vector/${primaryVector}`, undefined, { timeout: POLL_REQUEST_TIMEOUT_MS })
          .catch(() => undefined);
        const count = vector?.chunkSources?.length;
        if (isJsonMode()) output({ crawlId: result.crawlId, phase: "index", status: "indexed", fileId: waited.fileId, vectorChunkSources: count });
        else {
          console.log(colors.green("\n✓ Indexed into the vector."));
          console.log(`  File:    ${colors.cyan(waited.fileId)}`);
          console.log(`  Vector:  ${colors.cyan(opts.vector)}${count === undefined ? "" : ` (${count} sources)`}`);
          // #2 auto post-ingest health: self-consistency probe so "ingested
          // but not retrievable" (embedding mismatch / empty index) surfaces
          // here, not at customer query time.
          await printPostIngestHealth(httpClient, routeBase, primaryVector);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
