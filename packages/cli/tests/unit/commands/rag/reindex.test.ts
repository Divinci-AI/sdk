import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key",
    apiUrl: "https://api.divinci.app",
    workspaceId: "ws-123",
    profile: "default",
    source: "env",
  }),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
  getRouteBase: vi.fn().mockReturnValue("/white-label/wl-test"),
}));

const mockPost = vi.fn();
const mockGet = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({
      post: mockPost,
      get: mockGet,
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
import { registerRagReindexCommand } from "../../../../src/commands/rag/reindex.js";
import { isJsonMode } from "../../../../src/output/formatter.js";

function createCli(): Command {
  const program = new Command();
  const rag = program.command("rag");
  registerRagReindexCommand(rag);
  return program;
}

describe("rag reindex — request body shape", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    mockPost.mockResolvedValue({
      success: true,
      file: { _id: "file-123", status: "CHUNKING" },
      queue: { status: "queued" },
    });
  });

  it("sends chunkerTool when --chunking-tool is provided", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "reindex", "file-123",
      // liteparse-langextract, NOT bare "liteparse" — bare "liteparse" is not
      // a registered server-side chunker and is now rejected client-side
      // (see the rejection test below).
      "--chunking-tool", "liteparse-langextract",
    ]);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe("/white-label/wl-test/rag/files/file-123/reindex");
    expect(body).toMatchObject({ chunkerTool: "liteparse-langextract" });
    expect(body).not.toHaveProperty("chunkerConfig");
  });

  it("rejects bare --chunking-tool liteparse client-side instead of sending a value the server 400s on", async () => {
    const cli = createCli();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await cli.parseAsync([
        "node", "cli",
        "rag", "reindex", "file-123",
        "--chunking-tool", "liteparse",
      ]);
    } catch {
      // process.exit threw — expected
    }

    expect(mockPost).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("defaults to forcing langextract when only --chapter-aware is given", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "reindex", "file-123",
      "--chapter-aware",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      chunkerConfig: { langextract: { chapterAware: true } },
      chunkerTool: "@divinci-ai/langextract",
    });
  });

  it("merges --chapter-aware config with --chunking-tool liteparse-langextract without overriding the tool", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "reindex", "file-123",
      "--chapter-aware",
      "--chunking-tool", "liteparse-langextract",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      chunkerConfig: { langextract: { chapterAware: true } },
      chunkerTool: "liteparse-langextract",
    });
  });

  it("rejects --chapter-aware combined with an incompatible --chunking-tool", async () => {
    const cli = createCli();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await cli.parseAsync([
        "node", "cli",
        "rag", "reindex", "file-123",
        "--chapter-aware",
        "--chunking-tool", "openparse",
      ]);
    } catch {
      // process.exit threw — expected
    }

    expect(mockPost).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("omits chunkerTool and chunkerConfig entirely when neither flag is given", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "reindex", "file-123",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("chunkerTool");
    expect(body).not.toHaveProperty("chunkerConfig");
  });

  it("includes ragVectorIds when --targets is provided", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "reindex", "file-123",
      "--targets", "vec-1, vec-2",
    ]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({ ragVectorIds: ["vec-1", "vec-2"] });
  });
});

describe("rag reindex — --wait polling", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    mockPost.mockResolvedValue({
      success: true,
      file: { _id: "file-123", status: "CHUNKING" },
      queue: { status: "queued" },
    });
  });

  it("polls status until a terminal completed state is reached", async () => {
    // The polling/console-output branch only runs when isJsonMode() is
    // false — the request-body-shape suite above relies on it being true
    // to short-circuit into output(result); flip it for this test.
    (isJsonMode as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Stub setTimeout to fire immediately so the polling loop's real 5s
    // interval doesn't slow the test down or require fake-timer bookkeeping.
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

    mockGet
      .mockResolvedValueOnce({ _id: "file-123", status: "CHUNKING" })
      .mockResolvedValueOnce({ _id: "file-123", status: "CHUNKED_AND_EMBEDDED" });

    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "reindex", "file-123",
      "--wait",
      "--poll-interval", "5",
    ]);

    expect(mockGet).toHaveBeenCalledTimes(2);
    setTimeoutSpy.mockRestore();
    (isJsonMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });
});
