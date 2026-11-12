/**
 * Follow a queued web_crawl to "ready to query" and report the outcome.
 *
 * Shared by `connectors web-crawl --wait` and `rag crawl --urls-file`, so a URL
 * list ingested through either command is followed, timed out and exited the
 * same way. Under --json, stdout carries only the final JSON document and
 * progress goes to stderr (an agent, on 2026-09-25, was left with a command
 * that printed nothing for minutes when progress was silenced instead).
 */

import { getRouteBase, type ResolvedConfig } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { colors } from "../../output/colors.js";
import { POLL_REQUEST_TIMEOUT_MS } from "../../utils/transient.js";
import type { createClient } from "../../client/create-client.js";
import { waitForWebCrawl, type VectorProgressDoc, type WebCrawlWaitResult } from "./wait-web-crawl.js";

export interface FollowWebCrawlArgs {
  client: ReturnType<typeof createClient>;
  config: ResolvedConfig;
  workspaceId: string;
  vectorId: string;
  /** What the user pointed the crawl at; only used in the "queued" line. */
  siteUrl: string;
  /** Epoch ms the crawl was requested. */
  since: number;
  pollIntervalSeconds: string | number;
  timeoutSeconds: string | number;
  json: boolean;
  /** Exit 1 when the crawl finished but some pages failed to embed. */
  failOnPageFailures?: boolean;
  defaultTimeoutSeconds?: number;
}

export async function followWebCrawl(args: FollowWebCrawlArgs): Promise<WebCrawlWaitResult> {
  const { client, config, workspaceId, vectorId, json } = args;
  const queued = `Crawl queued for ${args.siteUrl}. Following it until the vector is ready…`;
  // eslint-disable-next-line no-console
  if (json) console.error(queued); else console.log(colors.dim(queued));
  const httpClient = client.getHttpClient();
  const outcome = await waitForWebCrawl(
    {
      listConnections: async () => (await client.connectors.list(workspaceId)).connections ?? [],
      listJobs: async (id) => (await client.connectors.syncJobs(workspaceId, id)).jobs ?? [],
      // Vector detail is a whitelabel route; /api/v1 (API-key auth) has no equivalent.
      getVector: config.authType === "oauth"
        ? () => httpClient.get<VectorProgressDoc>(
          `${getRouteBase({ ...config, workspaceId })}/rag-vector/${vectorId}`,
          undefined,
          { timeout: POLL_REQUEST_TIMEOUT_MS },
        )
        : undefined,
      // eslint-disable-next-line no-console
      log: (line) => { if (json) console.error(line); else console.log(line); },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
    {
      vectorId,
      since: args.since,
      pollMs: Math.max(parseInt(String(args.pollIntervalSeconds), 10) || 10, 3) * 1000,
      timeoutMs: Math.max(parseInt(String(args.timeoutSeconds), 10) || (args.defaultTimeoutSeconds ?? 900), 30) * 1000,
    },
  );
  return outcome;
}

/** Print the outcome and exit the way `connectors web-crawl --wait` always has: 0 ready, 2 timed out, 1 otherwise. */
export function reportWebCrawlOutcome(
  outcome: WebCrawlWaitResult,
  vectorId: string,
  json: boolean,
  failOnPageFailures = false,
): void {
  if (json) output({ vectorId, ...outcome });
  if (outcome.outcome === "ready" || outcome.outcome === "crawled") {
    if (outcome.outcome === "ready" && outcome.failed > 0 && failOnPageFailures) {
      // eslint-disable-next-line no-console
      if (!json) console.error(colors.red(`\n✖ ${outcome.failed} page(s) failed to embed; ${outcome.indexed} indexed.`) + colors.dim(`  List them: divinci rag files --status failed`));
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    if (!json) console.log(colors.green(`\n✓ ${vectorId} is ready to query.`) + colors.dim(`  Try: divinci rag test-retrieval ${vectorId} "<question>"`));
    return;
  }
  if (outcome.outcome === "timeout") {
    // eslint-disable-next-line no-console
    if (!json) console.error(colors.yellow(`\nStopped waiting after ${outcome.seconds}s (still ${outcome.phase === "crawl" ? "crawling" : "indexing"}); the crawl continues server-side.`));
    process.exit(2);
  }
  process.exit(1);
}
