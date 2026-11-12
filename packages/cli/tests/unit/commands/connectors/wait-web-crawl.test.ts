// Guard for notes/KNOWN-GAPS.yaml `web-crawl-gave-no-way-to-wait-for-completion`.
import { describe, it, expect } from "vitest";
import {
  waitForWebCrawl,
  pickJob,
  type WebCrawlWaitDeps,
  type VectorProgressDoc,
} from "../../../../src/commands/connectors/wait-web-crawl.js";
import type { ConnectorConnection, ConnectorSyncJob } from "@divinci-ai/server";

const VEC = "vec-1";
const T0 = Date.parse("2026-09-25T09:05:39Z");

function job(over: Partial<ConnectorSyncJob>): ConnectorSyncJob {
  return {
    _id: "j", connectionId: "c", provider: "web_crawl", status: "pending",
    createdAt: new Date(T0 + 1000).toISOString(), ...over,
  } as ConnectorSyncJob;
}
const connection = {
  _id: "c", provider: "web_crawl", providerSettings: { mode: "crawl", rootUrl: "https://a.dev", targetVectorId: VEC },
} as unknown as ConnectorConnection;

/** Scripted polls: each step is what the API returns on that tick. */
function harness(steps: Array<{ connections?: ConnectorConnection[]; jobs?: ConnectorSyncJob[]; vector?: VectorProgressDoc }>) {
  let tick = 0;
  let clock = T0;
  const lines: string[] = [];
  const at = () => steps[Math.min(tick, steps.length - 1)];
  const deps: WebCrawlWaitDeps = {
    listConnections: async () => at().connections ?? [],
    listJobs: async () => at().jobs ?? [],
    getVector: async () => at().vector ?? {},
    log: (l) => lines.push(l),
    sleep: async (ms) => { clock += ms; tick += 1; },
    now: () => clock,
  };
  return { deps, lines };
}
const opts = { vectorId: VEC, since: T0, pollMs: 10_000, timeoutMs: 900_000 };

describe("connectors web-crawl --wait", () => {
  it("follows queued → crawling → indexing → ready, one line per change", async () => {
    const { deps, lines } = harness([
      {},                                                                   // connection not created yet
      { connections: [connection], jobs: [] },
      { connections: [connection], jobs: [job({ status: "running", progress: { totalFiles: 57, processedFiles: 12, failedFiles: 0 } })] },
      { connections: [connection], jobs: [job({ status: "completed", progress: { totalFiles: 57, processedFiles: 57, failedFiles: 0 } })],
        vector: { chunkSources: new Array(20), pendingChunkSources: new Array(37) } },
      { connections: [connection], jobs: [], vector: { chunkSources: new Array(57), pendingChunkSources: [] } },
    ]);
    const out = await waitForWebCrawl(deps, opts);

    expect(out).toMatchObject({ outcome: "ready", pages: 57, indexed: 57 });
    expect(lines).toEqual([
      "[0:00] queued — waiting for the crawler to pick it up",
      "[0:20] crawling — 12/57 page(s)",
      "[0:30] crawl complete — 57 page(s) fetched",
      "[0:30] indexing — 20 ready, 37 embedding",
      "[0:40] ready — 57 page(s) indexed",
    ]);
  });

  // 2026-10-07 (production): the client times a request out at 30 s and never
  // retries it, so one slow poll ended the whole wait with exit 1 while the
  // server indexed every page. A timeout now costs one poll.
  it("survives a poll that times out, in either phase", async () => {
    const timeout = () => Object.assign(new Error("Request timed out after 30000ms"), { name: "TimeoutError", code: "TIMEOUT" });
    const script = ["timeout-connections", "ok-running", "timeout-jobs", "ok-completed"] as const;
    let vectorCalls = 0;
    let tick = 0;
    let clock = T0;
    const lines: string[] = [];
    const deps: WebCrawlWaitDeps = {
      listConnections: async () => { if (script[tick] === "timeout-connections") throw timeout(); return [connection]; },
      listJobs: async () => {
        if (script[tick] === "timeout-jobs") throw timeout();
        return [job(script[tick] === "ok-completed"
          ? { status: "completed", progress: { totalFiles: 5, processedFiles: 5, failedFiles: 0 } }
          : { status: "running", progress: { totalFiles: 5, processedFiles: 2, failedFiles: 0 } })];
      },
      getVector: async () => {
        if (vectorCalls++ === 0) throw timeout();   // the first index poll times out too
        return { chunkSources: new Array(5), pendingChunkSources: [] };
      },
      log: (l) => lines.push(l),
      sleep: async (ms) => { clock += ms; tick += 1; },
      now: () => clock,
    };

    const out = await waitForWebCrawl(deps, opts);
    expect(out).toMatchObject({ outcome: "ready", indexed: 5 });
    expect(lines.some((l) => /API slow \(Request timed out after 30000ms\)/.test(l))).toBe(true);
  });

  it("still fails on an error that is not a timeout", async () => {
    const { deps } = harness([{ connections: [connection], jobs: [] }]);
    deps.listConnections = async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); };
    await expect(waitForWebCrawl(deps, opts)).rejects.toThrow("Forbidden");
  });

  it("gives up when every poll times out (a dead API must still end the command)", async () => {
    const { deps } = harness([{}]);
    deps.listConnections = async () => { throw Object.assign(new Error("Request timed out after 30000ms"), { code: "TIMEOUT" }); };
    await expect(waitForWebCrawl(deps, opts)).rejects.toThrow(/timed out/);
  });

  // The take-3 failure: a sibling job dies on the vector's lock while the real
  // crawl runs. That failure is not this crawl's outcome.
  it("ignores a sibling job that failed only on the vector lock", () => {
    const locked = job({ _id: "sib", status: "failed", progress: { totalFiles: 0, processedFiles: 0, failedFiles: 0 }, errorMessages: ["document is locked"] });
    const live = job({ _id: "live", status: "running" });
    expect(pickJob([locked, live], T0)?._id).toBe("live");
    expect(pickJob([locked], T0)).toBeUndefined();
  });

  it("does not mistake an older crawl's finished job for this one", () => {
    const old = job({ _id: "old", status: "completed", createdAt: new Date(T0 - 3_600_000).toISOString() });
    expect(pickJob([old], T0)).toBeUndefined();
  });

  it("reports a real crawl failure with its reason", async () => {
    const { deps } = harness([{ connections: [connection], jobs: [job({ status: "failed", errorMessages: ["robots.txt disallows /"] })] }]);
    await expect(waitForWebCrawl(deps, opts)).resolves.toMatchObject({ outcome: "crawl-failed", errors: ["robots.txt disallows /"] });
  });

  it("gives up at the timeout instead of hanging", async () => {
    const { deps } = harness([{}]);
    await expect(waitForWebCrawl(deps, { ...opts, timeoutMs: 60_000 })).resolves.toMatchObject({ outcome: "timeout", phase: "crawl" });
  });

  it("stops after the crawl when the session cannot read vector detail", async () => {
    const { deps, lines } = harness([{ connections: [connection], jobs: [job({ status: "completed", progress: { totalFiles: 5, processedFiles: 5, failedFiles: 0 } })] }]);
    delete deps.getVector;
    await expect(waitForWebCrawl(deps, opts)).resolves.toMatchObject({ outcome: "crawled", pages: 5 });
    expect(lines.at(-1)).toMatch(/divinci rag files/);
  });
});
