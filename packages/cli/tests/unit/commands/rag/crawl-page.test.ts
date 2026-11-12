// Guard for notes/KNOWN-GAPS.yaml `rag-crawl-wait-dies-on-one-slow-poll-and-hides-the-list-route`.
import { describe, it, expect } from "vitest";
import { waitForPage, isPageIndexed, type PageHttp } from "../../../../src/commands/rag/crawl-page.js";

const RB = "/white-label/wl";
const URL1 = "https://science.nasa.gov/jupiter/io";
const VEC = "vec-1";
const HOST = `${RB}/rag-vector/html-page/hosts/science.nasa.gov`;
const BY_URL = `${RB}/rag-vector/html-page/url?url=${encodeURIComponent(URL1)}`;
const PAGE = `${RB}/rag-vector/html-page/page-1`;
const FILE = `${RB}/rag/files/file-1`;
const VECTOR_DOC = `${RB}/rag-vector/${VEC}`;

const timeout = () => Object.assign(new Error("Request timed out after 60000ms"), { name: "TimeoutError", code: "TIMEOUT" });

/** A scripted API: each path answers from its queue (last answer repeats); an Error is thrown. */
function api(script: Record<string, unknown[]>) {
  const calls: string[] = [];
  const timeouts: Array<number | undefined> = [];
  const http: PageHttp = {
    post: async () => { throw new Error("unexpected POST"); },
    get: (async (path: string, _p?: unknown, options?: { timeout?: number }) => {
      calls.push(path);
      timeouts.push(options?.timeout);
      const q = script[path];
      if (!q) throw new Error(`unscripted GET ${path}`);
      const next = q.length > 1 ? q.shift() : q[0];
      if (next instanceof Error) throw next;
      return next;
    }) as PageHttp["get"],
  };
  return { http, calls, timeouts };
}
const crawlDone = (status: string) => ({ crawls: [{ _id: "c1", status }] });
const indexedFile = { status: "completed", ragVectors: [{ _id: VEC, fileStatus: "indexed" }] };
const embeddingFile = { status: "completed", ragVectors: [{ _id: VEC, fileStatus: "processing" }] };
const idle = { sleep: async () => {} };

const base = { url: URL1, crawlId: "c1", vectorId: VEC, index: true, pollMs: 10_000, timeoutMs: 600_000 };

describe("waitForPage", () => {
  // Old: `await sleep()` BEFORE the first look, so every page cost >= one 10 s interval of nothing.
  it("looks before it sleeps", async () => {
    const order: string[] = [];
    const { http } = api({
      [HOST]: [crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }], [FILE]: [indexedFile],
    });
    const spy: PageHttp = { ...http, get: (async (...a: Parameters<PageHttp["get"]>) => { order.push("get"); return http.get(...a); }) as PageHttp["get"] };
    const out = await waitForPage({ http: spy, routeBase: RB, sleep: async () => { order.push("sleep"); } }, base);
    expect(out).toMatchObject({ status: "indexed", fileId: "file-1" });
    expect(order[0]).toBe("get");
    expect(order).not.toContain("sleep");
  });

  // Old: each index poll GET the whole vector document (every chunk source it holds).
  it("never downloads the vector document while polling the page's own status", async () => {
    const { http, calls } = api({
      [HOST]: [crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }],
      [FILE]: [embeddingFile, embeddingFile, indexedFile],
    });
    const out = await waitForPage({ http, routeBase: RB, ...idle }, base);
    expect(out.status).toBe("indexed");
    expect(calls).not.toContain(VECTOR_DOC);
    expect(calls.filter((c) => c === FILE)).toHaveLength(3);
    // the page's file is resolved once, not on every poll
    expect(calls.filter((c) => c === BY_URL)).toHaveLength(1);
  });

  // Old: one request past the client's 30 s timeout threw straight out of the command (exit 1).
  it("survives a timed-out poll in the scrape phase and in the index phase", async () => {
    const events: string[] = [];
    const { http } = api({
      [HOST]: [timeout(), crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }],
      [FILE]: [timeout(), indexedFile],
    });
    const out = await waitForPage({ http, routeBase: RB, ...idle, onEvent: (e) => events.push(e.type) }, base);
    expect(out).toMatchObject({ status: "indexed" });
    expect(events.filter((e) => e === "slow")).toHaveLength(2);
  });

  it("asks for status with a 60 s timeout, not the client's 30 s default", async () => {
    const { http, timeouts } = api({
      [HOST]: [crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }], [FILE]: [indexedFile],
    });
    await waitForPage({ http, routeBase: RB, ...idle }, base);
    expect(timeouts.length).toBeGreaterThan(0);
    expect(timeouts.every((t) => t === 60_000)).toBe(true);
  });

  it("starts with quick polls and settles to the caller's interval", async () => {
    const sleeps: number[] = [];
    const { http } = api({
      [HOST]: [crawlDone("pending"), crawlDone("pending"), crawlDone("pending"), crawlDone("pending"), crawlDone("completed")],
      [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }], [FILE]: [indexedFile],
    });
    await waitForPage({ http, routeBase: RB, sleep: async (ms) => { sleeps.push(ms); } }, base);
    expect(sleeps).toEqual([2_000, 3_000, 5_000, 10_000]);
  });

  it("reports a failed scrape with its crawl, and a failed embed with its reason", async () => {
    const failedCrawl = { crawls: [{ _id: "c1", status: "failed", failedPaths: [URL1] }] };
    const a = api({ [HOST]: [failedCrawl] });
    expect(await waitForPage({ http: a.http, routeBase: RB, ...idle }, base))
      .toMatchObject({ status: "failed", phase: "scrape", crawl: { failedPaths: [URL1] } });

    const b = api({
      [HOST]: [crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }],
      [FILE]: [{ ragVectors: [{ _id: VEC, fileStatus: "failed", failedReason: "Workers AI 429" }] }],
    });
    expect(await waitForPage({ http: b.http, routeBase: RB, ...idle }, base))
      .toMatchObject({ status: "failed", phase: "index", reason: "Workers AI 429" });
  });

  it("times out instead of hanging", async () => {
    let clock = 0;
    const { http } = api({ [HOST]: [crawlDone("pending")] });
    const out = await waitForPage(
      { http, routeBase: RB, sleep: async (ms) => { clock += ms; }, now: () => clock },
      { ...base, timeoutMs: 30_000 },
    );
    expect(out).toMatchObject({ status: "timeout", phase: "scraping" });
  });

  it("stops after the scrape for --no-index", async () => {
    const { http, calls } = api({ [HOST]: [crawlDone("completed")] });
    expect(await waitForPage({ http, routeBase: RB, ...idle }, { ...base, index: false })).toMatchObject({ status: "scraped" });
    expect(calls).toEqual([HOST]);
  });

  it("tolerates a never-crawled host (null history) like crawl-status does", async () => {
    const { http } = api({ [HOST]: [null, crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }], [FILE]: [indexedFile] });
    expect((await waitForPage({ http, routeBase: RB, ...idle }, base)).status).toBe("indexed");
  });

  it("falls back to the whole-vector check on a server that does not report ragVectors", async () => {
    const { http, calls } = api({
      [HOST]: [crawlDone("completed")], [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }],
      [FILE]: [{ status: "completed" }], [VECTOR_DOC]: [{ chunkSources: [{ docId: "file-1" }] }],
    });
    expect((await waitForPage({ http, routeBase: RB, ...idle }, base)).status).toBe("indexed");
    expect(calls).toContain(VECTOR_DOC);
  });
});

describe("isPageIndexed (resume)", () => {
  it("is true only for a page whose file is attached to the vector", async () => {
    const yes = api({ [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }], [FILE]: [indexedFile] });
    expect(await isPageIndexed(yes.http, RB, URL1, VEC)).toBe(true);
    const still = api({ [BY_URL]: [{ _id: "page-1" }], [PAGE]: [{ files2: [{ _id: "file-1" }] }], [FILE]: [embeddingFile] });
    expect(await isPageIndexed(still.http, RB, URL1, VEC)).toBe(false);
    const never = api({ [BY_URL]: [null] });
    expect(await isPageIndexed(never.http, RB, URL1, VEC)).toBe(false);
  });
});
