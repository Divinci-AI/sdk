// `divinci rag models`, and the --embedding-auth-id flags that carry a BYOK key id for Voyage.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({ apiKey: "test-key", apiUrl: "https://api.divinci.app", workspaceId: "ws-123", profile: "default", source: "env" }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-123"),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
  getRouteBase: vi.fn().mockReturnValue("/white-label/wl-test"),
}));
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({ getHttpClient: () => ({ get: mockGet, post: mockPost, patch: mockPatch }) }),
}));
const mockOutput = vi.fn();
vi.mock("../../../../src/output/formatter.js", () => ({ output: (...a: unknown[]) => mockOutput(...a), isJsonMode: vi.fn().mockReturnValue(true) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/output/colors.js", () => ({
  colors: { cyanBold: (s: string) => s, dim: (s: string) => s, green: (s: string) => s, greenBold: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s },
}));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));

import { Command } from "commander";
import { registerRagTargetsCommand } from "../../../../src/commands/rag/targets.js";
import { registerRagConfigCommand } from "../../../../src/commands/rag/config.js";
import { registerRagModelsCommand, filterEmbeddingModels, type EmbeddingModelInfo } from "../../../../src/commands/rag/models.js";
import { handleCommandError as mockHandleError } from "../../../../src/utils/errors.js";

const M = (id: string, provider: string, keySource: EmbeddingModelInfo["keySource"], dbs = ["qdrant"]): EmbeddingModelInfo =>
  ({ id, provider, displayName: id, dimensions: 1024, compatibleVectorDbs: dbs, keySource });
const MODELS = [
  M("@cf/baai/bge-m3", "cloudflare", "divinci", ["qdrant", "vectorize"]),
  M("gemini-embedding-001@1536", "google", "divinci", ["qdrant"]),
  M("voyage-4", "voyage", "either", ["qdrant", "vectorize"]),
  M("voyage-4-lite", "voyage", "byok", ["qdrant"]),
];

function cli(): Command {
  const program = new Command();
  const rag = program.command("rag");
  registerRagTargetsCommand(rag);
  registerRagConfigCommand(rag);
  registerRagModelsCommand(rag);
  return program;
}
beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); mockPatch.mockReset(); mockOutput.mockReset(); (mockHandleError as ReturnType<typeof vi.fn>).mockReset(); });

describe("filterEmbeddingModels", () => {
  it("filters by provider, vector database and key source", () => {
    expect(filterEmbeddingModels(MODELS, { provider: "voyage" }).map((m) => m.id)).toEqual(["voyage-4", "voyage-4-lite"]);
    expect(filterEmbeddingModels(MODELS, { vectorDb: "vectorize" }).map((m) => m.id)).toEqual(["@cf/baai/bge-m3", "voyage-4"]);
    expect(filterEmbeddingModels(MODELS, { keySource: "divinci" }).map((m) => m.id)).toEqual(["@cf/baai/bge-m3", "gemini-embedding-001@1536"]);
  });

  it("treats 'byok' as 'a customer key is accepted', so models taking either key are not hidden", () => {
    expect(filterEmbeddingModels(MODELS, { keySource: "byok" }).map((m) => m.id)).toEqual(["voyage-4", "voyage-4-lite"]);
  });

  it("returns everything with no filters", () => {
    expect(filterEmbeddingModels(MODELS, {})).toHaveLength(4);
  });
});

describe("rag models", () => {
  it("reads the v1 catalogue and shows who holds each key", async () => {
    mockGet.mockResolvedValue({ models: MODELS, total: 4 });
    await cli().parseAsync(["node", "cli", "rag", "models", "--provider", "voyage"]);
    expect(mockGet).toHaveBeenCalledWith("/white-label/wl-test/rag/embedding-models");
    const [rows] = mockOutput.mock.calls[0];
    expect(rows.map((r: any) => [r.id, r.key])).toEqual([["voyage-4", "either"], ["voyage-4-lite", "byok"]]);
  });

  it("on an OAuth login reads the workspace router's rag-vector/ path (rag/ 404s there)", async () => {
    const { requireConfig } = await import("../../../../src/config/config-manager.js");
    vi.mocked(requireConfig).mockReturnValueOnce({ authType: "oauth", apiUrl: "https://api.divinci.app", workspaceId: "ws-123", profile: "default", source: "credentials" } as never);
    mockGet.mockResolvedValue({ models: MODELS, total: 4 });
    await cli().parseAsync(["node", "cli", "rag", "models"]);
    expect(mockGet).toHaveBeenCalledWith("/white-label/wl-test/rag-vector/embedding-models");
  });

  it("refuses an unknown --key-source before calling the API", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cli().parseAsync(["node", "cli", "rag", "models", "--key-source", "both"]).catch(() => {});
    expect(mockGet).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});

describe("--embedding-auth-id", () => {
  it("create sends the key reference with the model", async () => {
    mockPost.mockResolvedValue({ collection: { id: "x", title: "t", vectorIndexTool: "qdrant" } });
    await cli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "t", "--embedding-model", "voyage-4", "--embedding-auth-id", "a".repeat(24)]);
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ embeddingModel: "voyage-4", embeddingAuthId: "a".repeat(24) });
  });

  it("create omits it entirely when not given", async () => {
    mockPost.mockResolvedValue({ collection: { id: "x", title: "t", vectorIndexTool: "qdrant" } });
    await cli().parseAsync(["node", "cli", "rag", "targets", "create", "--title", "t"]);
    expect("embeddingAuthId" in mockPost.mock.calls[0][1]).toBe(false);
  });

  it("config sets a key, and 'none' sends null to go back to Divinci's key", async () => {
    mockPatch.mockResolvedValue({ success: true, collection: { id: "c1", minimumSimilarity: 0.6, contextPerMessage: 5 } });
    await cli().parseAsync(["node", "cli", "rag", "config", "c1", "--embedding-auth-id", "b".repeat(24)]);
    expect(mockPatch.mock.calls[0][1]).toEqual({ embeddingAuthId: "b".repeat(24) });
    await cli().parseAsync(["node", "cli", "rag", "config", "c1", "--embedding-auth-id", "none"]);
    expect(mockPatch.mock.calls[1][1]).toEqual({ embeddingAuthId: null });
  });
});
