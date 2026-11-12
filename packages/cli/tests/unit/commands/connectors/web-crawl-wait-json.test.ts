import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({ accessToken: "t", apiUrl: "https://api.divinci.app", authType: "oauth", workspaceId: "ws-1", profile: "prod", source: "credentials" }),
  ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
  getRouteBase: vi.fn().mockReturnValue("/white-label/ws-1"),
}));

const VEC = "vec-1";
const httpGet = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({ get: httpGet }),
    connectors: {
      webCrawlStart: vi.fn().mockResolvedValue({ status: "queued", mode: "crawl", rootUrl: "https://a.dev", targetVectorId: "vec-1" }),
      list: vi.fn().mockResolvedValue({ connections: [{ _id: "c1", provider: "web_crawl", providerSettings: { targetVectorId: "vec-1" } }] }),
      syncJobs: vi.fn().mockImplementation(async () => ({
        jobs: [{ _id: "j1", connectionId: "c1", provider: "web_crawl", status: "completed", createdAt: new Date().toISOString(), progress: { totalFiles: 3, processedFiles: 3, failedFiles: 0 } }],
      })),
    },
  }),
}));

const output = vi.fn();
vi.mock("../../../../src/output/formatter.js", () => ({ output: (...a: unknown[]) => output(...a), isJsonMode: () => true }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn((e: unknown) => { throw e; }) }));

import { Command } from "commander";
import { registerConnectorsCommands } from "../../../../src/commands/connectors/index.js";

describe("connectors web-crawl --wait --json", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    httpGet.mockResolvedValue({ chunkSources: [1, 2, 3], pendingChunkSources: [] });
    output.mockReset();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { log.mockRestore(); err.mockRestore(); });

  // On 2026-09-25 an agent ran this with --json and saw nothing for minutes:
  // progress was suppressed entirely under --json. It belongs on stderr.
  it("keeps stdout to one JSON result and puts progress on stderr", async () => {
    const program = new Command();
    registerConnectorsCommands(program.command("connectors"));
    await program.parseAsync(["node", "cli", "connectors", "web-crawl", "https://a.dev", "--vector", VEC, "--wait"]);

    expect(output).toHaveBeenCalledTimes(1);
    expect(output.mock.calls[0][0]).toMatchObject({ vectorId: VEC, outcome: "ready", indexed: 3 });
    expect(log).not.toHaveBeenCalled();
    const progress = err.mock.calls.map((c) => String(c[0]));
    expect(progress.some((l) => l.startsWith("Crawl queued for https://a.dev"))).toBe(true);
    expect(progress.some((l) => /ready — 3 page\(s\) indexed/.test(l))).toBe(true);
  });
});
