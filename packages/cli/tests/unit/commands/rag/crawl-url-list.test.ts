// Guard for notes/KNOWN-GAPS.yaml `rag-crawl-wait-dies-on-one-slow-poll-and-hides-the-list-route`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    accessToken: "t", apiUrl: "https://api.divinci.app", authType: "oauth", workspaceId: "ws-1", profile: "prod", source: "env",
  }),
  ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
  getRouteBase: vi.fn().mockReturnValue("/white-label/ws-1"),
}));

const webCrawlStart = vi.fn();
const post = vi.fn();
const get = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockImplementation(() => ({
    getHttpClient: () => ({ post, get }),
    connectors: {
      webCrawlStart: (...a: unknown[]) => webCrawlStart(...a),
      list: vi.fn().mockResolvedValue({ connections: [{ _id: "c1", provider: "web_crawl", providerSettings: { targetVectorId: "vec-1" } }] }),
      syncJobs: vi.fn().mockImplementation(async () => ({
        jobs: [{ _id: "j1", connectionId: "c1", provider: "web_crawl", status: "completed", createdAt: new Date().toISOString(),
          progress: { totalFiles: 3, processedFiles: 3, failedFiles: 0 } }],
      })),
    },
  })),
}));

const output = vi.fn();
vi.mock("../../../../src/output/formatter.js", () => ({ output: (...a: unknown[]) => output(...a), isJsonMode: () => true }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn((e: unknown) => { throw e; }) }));
vi.mock("../../../../src/commands/rag/post-ingest-health.js", () => ({ printPostIngestHealth: vi.fn() }));

import { Command } from "commander";
import { registerRagCrawlCommand } from "../../../../src/commands/rag/crawl.js";

const RB = "/white-label/ws-1";
const urls = ["https://science.nasa.gov/a", "https://science.nasa.gov/b", "https://science.nasa.gov/a", "https://science.nasa.gov/c"];
let listFile: string;

function program() {
  const p = new Command();
  registerRagCrawlCommand(p.command("rag"));
  return p;
}
const run = (...args: string[]) => program().parseAsync(["node", "cli", "rag", "crawl", ...args]);

/** A fake API where every page scrapes and indexes at once, tracking how many scrapes overlap. */
function healthyPages(inflight: { now: number; max: number }) {
  const issued: string[] = [];
  post.mockImplementation(async (path: string, body: { url: string }) => {
    expect(path).toBe(`${RB}/rag-vector/html-page/scrape`);
    const crawlId = `crawl-${issued.length + 1}-${encodeURIComponent(body.url)}`;
    issued.push(crawlId);
    inflight.now += 1; inflight.max = Math.max(inflight.max, inflight.now);
    await new Promise((r) => setTimeout(r, 15));   // let the others start
    inflight.now -= 1;
    return { crawlId };
  });
  get.mockImplementation(async (path: string) => {
    if (path.includes("/html-page/hosts/")) return { crawls: issued.map((_id) => ({ _id, status: "completed" })) };
    if (path.includes("/html-page/url?")) return { _id: `page-${path.split("url=")[1]}` };
    if (path.includes("/html-page/page-")) return { files2: [{ _id: `file-${path.split("page-")[1]}` }] };
    if (path.includes("/rag/files/")) return { ragVectors: [{ _id: "vec-1", fileStatus: "indexed" }] };
    throw new Error(`unscripted GET ${path}`);
  });
}

describe("rag crawl --urls-file", () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "crawl-list-"));
    listFile = join(dir, "urls.txt");
    writeFileSync(listFile, urls.join("\n") + "\n");
    webCrawlStart.mockReset(); post.mockReset(); get.mockReset(); output.mockReset();
    webCrawlStart.mockResolvedValue({ status: "queued", mode: "feed", targetVectorId: "vec-1" });
    exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { exit.mockRestore(); log.mockRestore(); err.mockRestore(); });

  it("is discoverable from `rag crawl --help`", () => {
    const help = program().commands[0].commands.find((c) => c.name() === "crawl")!.helpInformation().replace(/\s+/g, " ");
    expect(help).toContain("--urls-file");
    expect(help).toMatch(/To index an exact list of URLs, pass --urls-file/);
  });

  // Old: `crawl <url>` required a URL and had no list option at all.
  it("sends the de-duplicated list to the server's list route in one request, and scrapes nothing itself", async () => {
    await run("--urls-file", listFile, "--vector", "vec-1");
    expect(webCrawlStart).toHaveBeenCalledTimes(1);
    const [workspaceId, settings] = webCrawlStart.mock.calls[0];
    expect(workspaceId).toBe("ws-1");
    expect(settings).toMatchObject({
      mode: "feed", feedFormat: "url-list", targetVectorId: "vec-1", feedUrl: "https://science.nasa.gov/",
      feedUrls: ["https://science.nasa.gov/a", "https://science.nasa.gov/b", "https://science.nasa.gov/c"],
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("follows the server crawl to the end under --wait and exits 0 when it is ready", async () => {
    get.mockResolvedValue({ chunkSources: [1, 2, 3], pendingChunkSources: [] });
    await run("--urls-file", listFile, "--vector", "vec-1", "--wait");
    expect(output).toHaveBeenCalledWith(expect.objectContaining({ vectorId: "vec-1", outcome: "ready", indexed: 3 }));
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits non-zero and names the problem when some pages failed to embed", async () => {
    get.mockResolvedValue({ chunkSources: [1, 2], pendingChunkSources: [], failedChunkSources: [{ reason: "429" }] });
    await expect(run("--urls-file", listFile, "--vector", "vec-1", "--wait")).rejects.toThrow("exit:1");
  });

  it("falls back to a bounded client-side pool when the server rejects the list", async () => {
    webCrawlStart.mockRejectedValue(Object.assign(new Error("bad form"), { status: 400 }));
    const inflight = { now: 0, max: 0 };
    healthyPages(inflight);
    await run("--urls-file", listFile, "--vector", "vec-1", "--wait", "--concurrency", "2");
    expect(post).toHaveBeenCalledTimes(3);                      // de-duplicated: a, b, c
    expect(inflight.max).toBeLessThanOrEqual(2);                // bounded
    expect(inflight.max).toBeGreaterThan(1);                    // and actually parallel
    expect(output).toHaveBeenCalledWith(expect.objectContaining({ vectorId: "vec-1", total: 3, indexed: 3 }));
  });

  it("does not fall back on an auth failure — that would fail every page the same way", async () => {
    webCrawlStart.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(run("--urls-file", listFile, "--vector", "vec-1")).rejects.toThrow("Forbidden");
    expect(post).not.toHaveBeenCalled();
  });

  it("uses the pool, without asking the server route, for several target vectors", async () => {
    const inflight = { now: 0, max: 0 };
    healthyPages(inflight);
    await run("--urls-file", listFile, "--vector", "vec-1,vec-2", "--wait");
    expect(webCrawlStart).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("rejects a list combined with --multi", async () => {
    await expect(run("--urls-file", listFile, "--vector", "vec-1", "--multi")).rejects.toThrow("exit:1");
    expect(webCrawlStart).not.toHaveBeenCalled();
  });

  it("still insists on a URL when there is no list", async () => {
    await expect(run("--vector", "vec-1")).rejects.toThrow("exit:1");
  });

  it("rejects a malformed list before any request", async () => {
    writeFileSync(listFile, "https://science.nasa.gov/a\nnot a url\n");
    await expect(run("--urls-file", listFile, "--vector", "vec-1")).rejects.toThrow(/Not an http\(s\) URL at line 2/);
    expect(webCrawlStart).not.toHaveBeenCalled();
  });
});
