// Guard for notes/KNOWN-GAPS.yaml `rag-crawl-status-crashed-on-a-host-never-crawled`.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key",
    apiUrl: "https://api.divinci.app",
    workspaceId: "ws-123",
    profile: "default",
    source: "env",
  }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-123"),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
  getRouteBase: vi.fn().mockReturnValue("/white-label/wl-test"),
}));

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({
      post: mockPost,
      get: mockGet,
      patch: mockPatch,
      delete: mockDelete,
    }),
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
  isJsonMode: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    greenBold: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
}));

import { Command } from "commander";
import { registerRagCrawlStatusCommand } from "../../../../src/commands/rag/crawl-status.js";
import { handleCommandError as mockHandleError } from "../../../../src/utils/errors.js";
import { output as mockOutput } from "../../../../src/output/formatter.js";

function createCli(): Command {
  const program = new Command();
  const rag = program.command("rag");
  registerRagCrawlStatusCommand(rag);
  return program;
}

describe("rag crawl-status — a host with no crawl history", () => {
  beforeEach(() => {
    mockGet.mockReset();
    (mockHandleError as ReturnType<typeof vi.fn>).mockReset();
    (mockOutput as ReturnType<typeof vi.fn>).mockReset();
  });

  // A brand-new workspace's first crawl: the API returns a null body, and the
  // CLI crashed with "Cannot read properties of null (reading 'crawls')".
  it("reports an empty history instead of crashing on a null response", async () => {
    mockGet.mockResolvedValue(null);
    await createCli().parseAsync(["node", "cli", "rag", "crawl-status", "alpinejs.dev"]);

    expect(mockHandleError).not.toHaveBeenCalled();
    expect(mockOutput).toHaveBeenCalledWith({ host: "alpinejs.dev", crawls: [] });
  });
});
