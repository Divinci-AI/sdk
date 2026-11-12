/**
 * `divinci connectors web-crawl --wait`: follow a crawl from "queued" to
 * "ready to query", printing progress only when it changes.
 *
 * Without this the command returns "queued" and nothing else. The connection
 * record does not exist yet at that point (the sync service creates it when it
 * picks up the Cloud Task, ~45s from a cold start), so `connectors status`
 * reports "No web_crawl connection" — and a caller, human or agent, reasonably
 * concludes the crawl did not start and starts a second one. On 2026-09-25 that
 * is exactly what happened, and the first crawl then failed "document is
 * locked" behind the second.
 *
 * Two phases, because a finished crawl is not a searchable vector:
 *   1. crawl — find the connection, then follow its sync job to a terminal state
 *   2. index — follow the vector until no chunk source is still pending
 */

import type { ConnectorConnection, ConnectorSyncJob, WebCrawlSettings } from "@divinci-ai/server";
import { createTolerantPoller } from "../../utils/transient.js";

export interface WebCrawlWaitDeps {
  listConnections: () => Promise<ConnectorConnection[]>;
  listJobs: (connectionId: string) => Promise<ConnectorSyncJob[]>;
  /** Absent when the session cannot read vector detail (API-key auth: /api/v1 has no such route). */
  getVector?: () => Promise<VectorProgressDoc>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface VectorProgressDoc {
  chunkSources?: unknown[];
  pendingChunkSources?: unknown[];
  failedChunkSources?: Array<{ reason?: string }>;
}

export interface WebCrawlWaitOptions {
  vectorId: string;
  /** Epoch ms the crawl was requested; jobs created before it belong to older crawls. */
  since: number;
  pollMs: number;
  timeoutMs: number;
}

export type WebCrawlWaitResult =
  | { outcome: "ready"; pages: number; indexed: number; failed: number; seconds: number }
  | { outcome: "crawl-failed"; errors: string[]; seconds: number }
  | { outcome: "nothing-indexed"; pages: number; seconds: number }
  | { outcome: "crawled"; pages: number; seconds: number }
  | { outcome: "timeout"; phase: "crawl" | "index"; seconds: number };

/** Clock skew allowance between this machine and the API when matching jobs to this crawl. */
const SKEW_MS = 60_000;
/** After the crawl completes, how long an empty vector may stay empty before we stop waiting. */
const EMPTY_GRACE_MS = 90_000;

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * A job that failed only because a sibling crawl held the vector's lock is not
 * this crawl's outcome — the crawl holding the lock is.
 */
function isLockCollision(job: ConnectorSyncJob): boolean {
  return job.status === "failed"
    && (job.progress?.processedFiles ?? 0) === 0
    && (job.errorMessages ?? []).some((m) => /document is locked/i.test(m));
}

function jobTime(job: ConnectorSyncJob): number {
  return Date.parse(job.createdAt ?? job.startedAt ?? "") || 0;
}

/** The job that represents this crawl: live jobs first, then the newest finished one. */
export function pickJob(jobs: ConnectorSyncJob[], since: number): ConnectorSyncJob | undefined {
  const mine = jobs
    .filter((j) => jobTime(j) >= since - SKEW_MS && !isLockCollision(j))
    .sort((a, b) => jobTime(b) - jobTime(a));
  return mine.find((j) => !TERMINAL.has(j.status)) ?? mine[0];
}

export function findConnection(
  connections: ConnectorConnection[],
  vectorId: string,
): ConnectorConnection | undefined {
  return connections.find((c) =>
    c.provider === "web_crawl"
    && (c.providerSettings as WebCrawlSettings | undefined)?.targetVectorId === vectorId);
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function waitForWebCrawl(
  deps: WebCrawlWaitDeps,
  opts: WebCrawlWaitOptions,
): Promise<WebCrawlWaitResult> {
  const start = deps.now();
  const deadline = start + opts.timeoutMs;
  const elapsed = () => deps.now() - start;
  let last = "";
  const report = (line: string) => {
    if (line === last) return;
    last = line;
    deps.log(`[${clock(elapsed())}] ${line}`);
  };

  // One poll's request. A transient failure (a timeout, a network blip) costs
  // this poll, not the command: it returns undefined and the loop tries again
  // after the usual sleep. Anything else, or too many in a row, still throws.
  const poll = createTolerantPoller((e) => report(`API slow (${e.message}) — still waiting`));

  // ── phase 1: crawl ────────────────────────────────────────────────────────
  let pages = 0;
  for (;;) {
    const connections = await poll(() => deps.listConnections());
    const connection = connections ? findConnection(connections, opts.vectorId) : undefined;
    const jobs = connection ? await poll(() => deps.listJobs(connection._id)) : undefined;
    const slow = connections === undefined || (connection !== undefined && jobs === undefined);
    const job = jobs ? pickJob(jobs, opts.since) : undefined;

    if (slow) {
      // already reported; fall through to the deadline check and the sleep
    } else if (!job) {
      report("queued — waiting for the crawler to pick it up");
    } else {
      const done = job.progress?.processedFiles ?? 0;
      const total = job.progress?.totalFiles ?? 0;
      pages = done;
      if (job.status === "completed") {
        report(`crawl complete — ${done} page(s) fetched${job.progress?.failedFiles ? `, ${job.progress.failedFiles} failed` : ""}`);
        break;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        const errors = job.errorMessages ?? [];
        report(`crawl ${job.status}${errors.length ? `: ${errors[0]}` : ""}`);
        return { outcome: "crawl-failed", errors, seconds: Math.round(elapsed() / 1000) };
      }
      report(total > 0 ? `crawling — ${done}/${total} page(s)` : "crawling — discovering pages");
    }

    if (deps.now() >= deadline) return { outcome: "timeout", phase: "crawl", seconds: Math.round(elapsed() / 1000) };
    await deps.sleep(opts.pollMs);
  }

  // ── phase 2: index ────────────────────────────────────────────────────────
  const getVector = deps.getVector;
  if (!getVector) {
    report("embedding continues server-side — `divinci rag files` shows each page's status");
    return { outcome: "crawled", pages, seconds: Math.round(elapsed() / 1000) };
  }
  const crawlDoneAt = deps.now();
  for (;;) {
    const vector = await poll(getVector);
    if (vector) {
      const indexed = vector.chunkSources?.length ?? 0;
      const pending = vector.pendingChunkSources?.length ?? 0;
      const failed = vector.failedChunkSources?.length ?? 0;

      if (pending === 0 && indexed > 0) {
        report(`ready — ${indexed} page(s) indexed${failed ? `, ${failed} failed` : ""}`);
        return { outcome: "ready", pages, indexed, failed, seconds: Math.round(elapsed() / 1000) };
      }
      if (pending === 0 && indexed === 0 && deps.now() - crawlDoneAt >= EMPTY_GRACE_MS) {
        report("crawl finished but nothing was indexed");
        return { outcome: "nothing-indexed", pages, seconds: Math.round(elapsed() / 1000) };
      }
      report(`indexing — ${indexed} ready, ${pending} embedding${failed ? `, ${failed} failed` : ""}`);
    }

    if (deps.now() >= deadline) return { outcome: "timeout", phase: "index", seconds: Math.round(elapsed() / 1000) };
    await deps.sleep(opts.pollMs);
  }
}
