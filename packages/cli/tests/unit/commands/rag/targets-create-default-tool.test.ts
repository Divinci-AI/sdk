// Guard for notes/KNOWN-GAPS.yaml `rag-targets-create-required-a-backend-guess`.
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
import { registerRagTargetsCommand } from "../../../../src/commands/rag/targets.js";
import { handleCommandError as mockHandleError } from "../../../../src/utils/errors.js";

function createCli(): Command {
  const program = new Command();
  const rag = program.command("rag");
  registerRagTargetsCommand(rag);
  return program;
}

describe("rag targets create — --tool default", () => {
  beforeEach(() => {
    mockPost.mockReset();
    (mockHandleError as ReturnType<typeof vi.fn>).mockReset();
    mockPost.mockResolvedValue({ collection: { id: "new-id", title: "Docs", vectorIndexTool: "qdrant" } });
  });

  // Requiring a backend made every first-time caller guess, and on 2026-09-25 the
  // first guess (vectorize) failed on an exhausted account index quota.
  it("creates a qdrant vector when --tool is omitted", async () => {
    await createCli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "Docs"]);

    expect(mockHandleError).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ title: "Docs", vectorIndexTool: "qdrant" });
  });

  it("still honours an explicit --tool", async () => {
    await createCli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "Docs", "--tool", "vertex-ai"]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ vectorIndexTool: "vertex-ai" });
  });

  it("--rerank jev sends the Jev re-rank model", async () => {
    await createCli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "Docs", "--rerank", "jev"]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ rerankModel: "typesafe/jev" });
  });

  it("refuses an unknown --rerank value instead of creating a vector", async () => {
    await createCli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "Docs", "--rerank", "cohere"]);

    expect(mockPost).not.toHaveBeenCalled();
    expect(mockHandleError).toHaveBeenCalledTimes(1);
  });
});

// Guard for notes/KNOWN-GAPS.yaml `default-min-similarity-starves-embeddinggemma-vectors`.
// The CLI used to send minimumSimilarity: 0.62 on every create, which overrode
// the server's model-aware default (0.4 for embeddinggemma).
describe("rag targets create — --min-similarity", () => {
  beforeEach(() => {
    mockPost.mockReset();
    (mockHandleError as ReturnType<typeof vi.fn>).mockReset();
    mockPost.mockResolvedValue({ collection: { id: "new-id", title: "Docs", vectorIndexTool: "qdrant" } });
  });

  it("sends no minimumSimilarity when the flag is omitted, so the server picks per model", async () => {
    await createCli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "Docs"]);
    expect(mockHandleError).not.toHaveBeenCalled();
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("minimumSimilarity");
  });

  it("sends the value when the flag is given", async () => {
    await createCli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "Docs", "--min-similarity", "0.5"]);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.minimumSimilarity).toBe(0.5);
  });
});
