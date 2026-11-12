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

describe("rag targets migrate — request body shape", () => {
  beforeEach(() => {
    mockPost.mockReset();
    (mockHandleError as ReturnType<typeof vi.fn>).mockReset();
    mockPost.mockResolvedValue({
      newCollectionId: "new-id",
      newCollection: { id: "new-id", title: "x", vectorIndexTool: "qdrant" },
      sourceCollectionId: "src-id",
      queued: 0,
      total: 0,
      message: "ok",
    });
  });

  it("includes compressionStrategy when --compression flag provided", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "targets", "migrate", "src-id",
      "--compression", "exit",
    ]);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ compressionStrategy: "exit" });
  });

  it("includes compressionTargetRatio as integer when --compression-ratio provided", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "targets", "migrate", "src-id",
      "--compression", "exit",
      "--compression-ratio", "8",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ compressionStrategy: "exit", compressionTargetRatio: 8 });
    expect(typeof body.compressionTargetRatio).toBe("number");
  });

  it("omits compression fields entirely when not provided (carries source values)", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "targets", "migrate", "src-id",
      "--embedding-model", "gemini-embedding-001@1536",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("compressionStrategy");
    expect(body).not.toHaveProperty("compressionTargetRatio");
    expect(body).toMatchObject({ embeddingModel: "gemini-embedding-001@1536" });
  });

  it("rejects invalid compression strategy", async () => {
    const cli = createCli();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await cli.parseAsync([
        "node", "cli",
        "rag", "targets", "migrate", "src-id",
        "--compression", "not-a-strategy",
      ]);
    } catch {
      // process.exit threw — expected
    }

    expect(mockPost).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("posts to the correct migrate URL", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "targets", "migrate", "src-collection-123",
      "--compression", "exit",
    ]);

    const [url] = mockPost.mock.calls[0];
    expect(url).toBe("/white-label/wl-test/rag/targets/src-collection-123/migrate");
  });
});

describe("rag targets create — compression body shape", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      collection: { id: "new-id", title: "x", vectorIndexTool: "qdrant" },
    });
  });

  it("includes compression fields when both flags provided", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "targets", "create",
      "--title", "Test Index",
      "--tool", "qdrant",
      "--compression", "exit",
      "--compression-ratio", "4",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      title: "Test Index",
      vectorIndexTool: "qdrant",
      compressionStrategy: "exit",
      compressionTargetRatio: 4,
    });
  });
});
