import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface CrawlHistoryItem {
  _id: string;
  status?: string;
  scrapedPaths?: string[];
  unscrapedPaths?: string[];
  failedPaths?: string[];
  createTimestamp?: number;
  updateTimestamp?: number;
}

interface CrawlHistoryResponse {
  crawls?: CrawlHistoryItem[];
}

// Standalone read of the same crawl-history endpoint `rag crawl --wait`
// polls internally, so a crawl kicked off without --wait (or one you're
// checking on from a different terminal) can be inspected without starting
// a new crawl or blocking. Also useful mid-crawl to confirm it's actually
// progressing rather than wedged.
export function registerRagCrawlStatusCommand(parent: Command): void {
  parent
    .command("crawl-status <host>")
    .description("Show recent crawl history for a host (no polling, no new crawl started)")
    .option("--crawl-id <id>", "Show full path detail for a single crawl by id")
    .action(async (hostArg, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        // Accept either a bare host or a full URL for convenience.
        let host = hostArg;
        try {
          host = new URL(hostArg).host;
        } catch {
          // not a URL — treat the arg as a bare host
        }

        const history = await withSpinner(`Fetching crawl history for ${host}...`, () =>
          httpClient.get<CrawlHistoryResponse | null>(
            `${routeBase}/rag-vector/html-page/hosts/${encodeURIComponent(host)}`,
          ),
        );

        // The API answers a host it has never crawled with a null body, which is
        // exactly what a brand-new workspace sees on its first crawl.
        const crawls = history?.crawls ?? [];

        if (opts.crawlId) {
          const crawl = crawls.find((c) => c._id === opts.crawlId);
          if (!crawl) {
            console.error(colors.red(`Crawl not found: ${opts.crawlId}`));
            process.exit(1);
          }
          if (isJsonMode()) { output(crawl); return; }
          console.log(`${colors.cyanBold(crawl._id)} ${colors.dim(`(${crawl.status ?? "unknown"})`)}`);
          console.log(`  ${colors.dim("Scraped:")}   ${crawl.scrapedPaths?.length ?? 0}`);
          console.log(`  ${colors.dim("Unscraped:")} ${crawl.unscrapedPaths?.length ?? 0}`);
          console.log(`  ${colors.dim("Failed:")}    ${crawl.failedPaths?.length ?? 0}`);
          if (crawl.failedPaths?.length) {
            console.log(colors.dim("\n  Failed paths:"));
            for (const p of crawl.failedPaths) console.log(`    ${p}`);
          }
          return;
        }

        if (crawls.length === 0) {
          if (isJsonMode()) { output({ host, crawls: [] }); return; }
          console.log(colors.dim(`No crawl history for ${host}.`));
          return;
        }

        if (isJsonMode()) { output({ host, crawls }); return; }

        output(
          crawls.map((c) => ({
            id: c._id,
            status: c.status ?? "unknown",
            scraped: c.scrapedPaths?.length ?? 0,
            unscraped: c.unscrapedPaths?.length ?? 0,
            failed: c.failedPaths?.length ?? 0,
          })),
          {
            table: {
              columns: [
                { key: "id", header: "Crawl ID" },
                { key: "status", header: "Status" },
                { key: "scraped", header: "Scraped" },
                { key: "unscraped", header: "Unscraped" },
                { key: "failed", header: "Failed" },
              ],
            },
          },
        );
        console.log(colors.dim(`\nFor path-level detail: divinci rag crawl-status ${host} --crawl-id <id>`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
