import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies before imports
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
}));

const mockPost = vi.fn();
const mockStream = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({
      post: mockPost,
      stream: mockStream,
    }),
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
  isJsonMode: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/output/stream.js", () => ({
  printAssistantLabel: vi.fn(),
  printStreamChunk: vi.fn(),
  printStreamDone: vi.fn(),
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

// send.ts now polls the transcript for the async assistant reply (--wait
// defaults to 30s). Mock those helpers so the deterministic command-shape
// assertions below don't depend on real polling / extra httpClient calls.
const mockGetTranscriptMessageCount = vi.fn().mockResolvedValue(0);
const mockWaitForAssistantReply = vi.fn().mockResolvedValue(null);
vi.mock("../../../../src/commands/chat/wait-for-reply.js", () => ({
  getTranscriptMessageCount: (...args: unknown[]) => mockGetTranscriptMessageCount(...args),
  waitForAssistantReply: (...args: unknown[]) => mockWaitForAssistantReply(...args),
}));

vi.mock("../../../../src/commands/chat/model-label.js", () => ({
  formatServedModelLabel: (s: string) => s,
}));

import { Command } from "commander";
import { registerChatSendCommand } from "../../../../src/commands/chat/send.js";
import { output, isJsonMode } from "../../../../src/output/formatter.js";
import { printStreamChunk, printStreamDone, printAssistantLabel } from "../../../../src/output/stream.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function createParentCommand(): Command {
  const parent = new Command("chat");
  registerChatSendCommand(parent);
  return parent;
}

/**
 * Create a mock StreamResponse (AsyncGenerator + metadata promise)
 */
function createMockStreamResponse(chunks: string[], metadata: Record<string, unknown> = {}) {
  async function* generate() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
  const gen = generate();
  return Object.assign(gen, { metadata: Promise.resolve(metadata) });
}

describe("chat send command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send non-streaming message by default", async () => {
    mockPost.mockResolvedValue({
      response: "Hello back!",
      messageId: "msg-1",
      transcriptId: "tx-1",
    });

    const parent = createParentCommand();
    await parent.parseAsync(["send", "tx-abc", "Hello"], { from: "user" });

    // The handler expects `content` (not `message`) per add-message.ts.
    expect(mockPost).toHaveBeenCalledWith(
      "/white-label/ws-123/transcript/tx-abc/message",
      { content: "Hello" }
    );
  });

  it("should output response text in non-streaming mode", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost.mockResolvedValue({
      response: "ok",
      messageId: "msg-1",
      transcriptId: "tx-1",
    });
    // Non-streaming replies are async: the handler accepts the message then
    // polls the transcript, so the visible text comes from the assistant reply,
    // not the POST response body.
    mockWaitForAssistantReply.mockResolvedValueOnce({ content: "The answer is 42." });

    const parent = createParentCommand();
    await parent.parseAsync(["send", "tx-abc", "Question"], { from: "user" });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("The answer is 42."));
    consoleSpy.mockRestore();
  });

  it("should output JSON in non-streaming --json mode", async () => {
    vi.mocked(isJsonMode).mockReturnValue(true);
    mockPost.mockResolvedValue({
      response: "answer",
      messageId: "msg-1",
      transcriptId: "tx-1",
    });

    const parent = createParentCommand();
    await parent.parseAsync(["send", "tx-abc", "Question"], { from: "user" });

    expect(output).toHaveBeenCalledWith({
      response: "answer",
      messageId: "msg-1",
      transcriptId: "tx-1",
    });
  });

  it("should use streaming when --stream flag is set", async () => {
    const mockStreamResp = createMockStreamResponse(["Hello", " world"], { transcriptId: "tx-1" });
    mockStream.mockReturnValue(mockStreamResp);

    const parent = createParentCommand();
    await parent.parseAsync(["send", "tx-abc", "Hi", "--stream"], { from: "user" });

    expect(mockStream).toHaveBeenCalledWith(
      "/white-label/ws-123/transcript/tx-abc/message",
      { method: "POST", body: { content: "Hi", stream: true } }
    );
    expect(printAssistantLabel).toHaveBeenCalled();
    expect(printStreamChunk).toHaveBeenCalledWith("Hello");
    expect(printStreamChunk).toHaveBeenCalledWith(" world");
    expect(printStreamDone).toHaveBeenCalled();
  });

  it("should output JSON with metadata in --stream --json mode", async () => {
    vi.mocked(isJsonMode).mockReturnValue(true);
    const mockStreamResp = createMockStreamResponse(
      ["response text"],
      { transcriptId: "tx-meta" }
    );
    mockStream.mockReturnValue(mockStreamResp);

    const parent = createParentCommand();
    await parent.parseAsync(["send", "tx-abc", "Hi", "--stream"], { from: "user" });

    expect(output).toHaveBeenCalledWith({
      response: "response text",
      transcriptId: "tx-abc",
      ...{ transcriptId: "tx-meta" },
    });
  });

  it("should call handleCommandError on failure", async () => {
    const err = new Error("API fail");
    mockPost.mockRejectedValue(err);

    const parent = createParentCommand();
    await parent.parseAsync(["send", "tx-abc", "Hi"], { from: "user" });

    expect(handleCommandError).toHaveBeenCalledWith(err);
  });
});
