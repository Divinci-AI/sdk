import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiUrl: "https://api.divinci.app/",
    accessToken: "tok",
    workspaceId: "ws-1",
  }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-1"),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  isJsonMode: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn((e: unknown) => { throw e; }),
}));

import { Command } from "commander";
import { registerQAAutoFixCommands } from "../../../../src/commands/qa/auto-fix.js";

type Call = { url: string, method: string, body?: any };
let calls: Call[];
let logSpy: ReturnType<typeof vi.spyOn>;

function respond(map: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.replace("https://api.divinci.app/white-label/ws-1", "")}`;
    const hit = Object.entries(map).find(([k]) => key.startsWith(k));
    return new Response(JSON.stringify(hit ? hit[1] : {}), { status: hit ? 200 : 404 });
  }));
}

async function run(...args: string[]) {
  const program = new Command("divinci").exitOverride();
  const qa = program.command("qa");
  registerQAAutoFixCommands(qa);
  await program.parseAsync(["node", "divinci", "qa", "auto-fix", ...args]);
}

describe("qa auto-fix", () => {
  beforeEach(() => {
    calls = [];
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
  });

  it("start: uses each vector's own embedding model and requires human review by default", async () => {
    respond({
      "GET /rag-vector/vec-1": { embeddingModel: "gemini-embedding-001@1536" },
      "POST /scored-qa/auto-fix": { _id: "loop-1" },
    });
    await run("start", "suite-1", "--release", "rel-1", "--vector", "vec-1");

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://api.divinci.app/white-label/ws-1/scored-qa/auto-fix");
    expect(post.body).toEqual({
      suiteId: "suite-1",
      releaseId: "rel-1",
      additionIndexes: [
        { ragIndexId: "vec-1", embeddingTool: { id: "gemini-embedding-001@1536", authId: "", config: {} } },
      ],
      config: {
        lowScoreConfig: { overall: 0.8, individual: {} },
        autoApplyMinConfidence: 0.75,
        maxIterations: 3,
        humanReviewRequired: true,
      },
    });
  });

  it("start: --no-human-review and explicit thresholds reach the body; --embedding-tool skips the lookup", async () => {
    respond({ "POST /scored-qa/auto-fix": { _id: "loop-2" } });
    await run(
      "start", "suite-1", "-r", "rel-1", "-v", "vec-1",
      "--embedding-tool", "tool-x", "--low-score", "0.6", "--max-iterations", "5",
      "--max-attempts-per-chunk", "2", "--no-human-review",
    );

    expect(calls.some((c) => c.url.includes("/rag-vector/"))).toBe(false);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.additionIndexes[0].embeddingTool.id).toBe("tool-x");
    expect(post.body.config).toEqual({
      lowScoreConfig: { overall: 0.6, individual: {} },
      autoApplyMinConfidence: 0.75,
      maxIterations: 5,
      humanReviewRequired: false,
      maxAttemptsPerChunk: 2,
    });
  });

  it("start: refuses a vector with no embedding model rather than guessing one", async () => {
    respond({ "GET /rag-vector/vec-1": {} });
    await expect(run("start", "suite-1", "-r", "rel-1", "-v", "vec-1")).rejects.toThrow(/no embeddingModel/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("approve: posts to the loop's human-review route", async () => {
    respond({ "POST /scored-qa/auto-fix/loop-1/human": { status: "ok", loopStatus: "running", approvals: 1 } });
    await run("approve", "loop-1");
    expect(calls).toEqual([
      { url: "https://api.divinci.app/white-label/ws-1/scored-qa/auto-fix/loop-1/human", method: "POST", body: undefined },
    ]);
  });

  it("an HTTP error surfaces its status instead of being swallowed", async () => {
    respond({});
    await expect(run("status", "missing")).rejects.toThrow(/HTTP 404/);
  });
});
