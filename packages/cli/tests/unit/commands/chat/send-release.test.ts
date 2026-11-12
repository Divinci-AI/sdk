import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key", apiUrl: "https://api.divinci.app", workspaceId: "ws-123", profile: "default", source: "env",
  }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-123"),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));

const mockPost = vi.fn();
const mockStream = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({ post: mockPost, stream: mockStream }),
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
  printAssistantLabel: vi.fn(), printStreamChunk: vi.fn(), printStreamDone: vi.fn(),
}));
vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => s, dim: (s: string) => s, green: (s: string) => s,
    greenBold: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s,
  },
}));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));

const mockGetTranscriptMessageCount = vi.fn().mockResolvedValue(0);
const mockWaitForAssistantReply = vi.fn().mockResolvedValue(null);
vi.mock("../../../../src/commands/chat/wait-for-reply.js", () => ({
  getTranscriptMessageCount: (...args: unknown[]) => mockGetTranscriptMessageCount(...args),
  waitForAssistantReply: (...args: unknown[]) => mockWaitForAssistantReply(...args),
}));
vi.mock("../../../../src/commands/chat/model-label.js", () => ({ formatServedModelLabel: (s: string) => s }));

import { Command } from "commander";
import { registerChatSendCommand } from "../../../../src/commands/chat/send.js";
import { createClient } from "../../../../src/client/create-client.js";
import { output, isJsonMode } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function parent(): Command {
  const p = new Command("chat");
  registerChatSendCommand(p);
  return p;
}

const ENDPOINT = "/white-label/ws-123/transcript/tx-abc/message";

// Guard for KNOWN-GAPS `cli-chat-cannot-talk-as-a-release`: `chat send` must be able
// to pin a release, outlast a slow answer (client timeout OR Cloudflare's 502/504/524
// edge cut-off), and show the sources. Reverting any of that fails this file.
describe("chat send — release-aware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isJsonMode).mockReturnValue(false);
    mockGetTranscriptMessageCount.mockResolvedValue(0);
    mockWaitForAssistantReply.mockResolvedValue(null);
  });

  it("--release pins the message to the release with the explicit env selector", async () => {
    mockPost.mockResolvedValue({ response: "ok", messageId: "m", transcriptId: "tx-abc" });
    await parent().parseAsync(["send", "tx-abc", "Hello", "--release", "rel-1"], { from: "user" });
    // Old behaviour posted { content } only, so the release's own prompts never
    // had to apply: the bug the take-11 left agent lost ~17 minutes to.
    expect(mockPost).toHaveBeenCalledWith(ENDPOINT, { content: "Hello", type: "release", releaseId: "rel-1" });
  });

  it("without --release the body is exactly what it always was", async () => {
    mockPost.mockResolvedValue({ response: "ok", messageId: "m", transcriptId: "tx-abc" });
    await parent().parseAsync(["send", "tx-abc", "Hello"], { from: "user" });
    expect(mockPost).toHaveBeenCalledWith(ENDPOINT, { content: "Hello" });
  });

  it("gives the request more than the SDK's 30s default, and more than the wait", async () => {
    mockPost.mockResolvedValue({});
    await parent().parseAsync(["send", "tx-abc", "Hello", "--wait", "300"], { from: "user" });
    const opts = vi.mocked(createClient).mock.calls[0][1] as { timeoutMs: number };
    expect(opts.timeoutMs).toBeGreaterThan(300_000);
    vi.mocked(createClient).mockClear();
    await parent().parseAsync(["send", "tx-abc", "Hello"], { from: "user" });
    expect((vi.mocked(createClient).mock.calls[0][1] as { timeoutMs: number }).timeoutMs).toBeGreaterThanOrEqual(120_000);
  });

  it("a client-side timeout while a reply is awaited keeps polling instead of failing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPost.mockRejectedValue(new Error("Request timed out after 30000ms"));
    mockWaitForAssistantReply.mockResolvedValueOnce({ content: "Late but here." });

    await parent().parseAsync(["send", "tx-abc", "Slow one"], { from: "user" });

    expect(handleCommandError).not.toHaveBeenCalled();
    expect(mockWaitForAssistantReply).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Late but here."));
    logSpy.mockRestore(); warnSpy.mockRestore();
  });

  it("Cloudflare's edge cutting the request (524) while a reply is awaited keeps polling", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPost.mockRejectedValue(Object.assign(new Error("Unknown error"), { status: 524 }));
    mockWaitForAssistantReply.mockResolvedValueOnce({ content: "Landed after the edge gave up." });

    await parent().parseAsync(["send", "tx-abc", "Slow one", "--release", "rel-1"], { from: "user" });

    expect(handleCommandError).not.toHaveBeenCalled();
    expect(mockWaitForAssistantReply).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Landed after the edge gave up."));
    logSpy.mockRestore(); warnSpy.mockRestore();
  });

  it("a real server error (500) is reported, not waited out", async () => {
    mockPost.mockRejectedValue(Object.assign(new Error("Internal"), { status: 500 }));
    await parent().parseAsync(["send", "tx-abc", "Hello"], { from: "user" });
    expect(handleCommandError).toHaveBeenCalled();
    expect(mockWaitForAssistantReply).not.toHaveBeenCalled();
  });

  it("a timeout with --wait 0 is still reported: there is nothing to poll for", async () => {
    mockPost.mockRejectedValue(new Error("Request timed out after 30000ms"));
    await parent().parseAsync(["send", "tx-abc", "Hello", "--wait", "0"], { from: "user" });
    expect(handleCommandError).toHaveBeenCalled();
    expect(mockWaitForAssistantReply).not.toHaveBeenCalled();
  });

  it("other errors are never mistaken for a timeout", async () => {
    mockPost.mockRejectedValue(new Error("HTTP 403: forbidden"));
    await parent().parseAsync(["send", "tx-abc", "Hello"], { from: "user" });
    expect(handleCommandError).toHaveBeenCalled();
    expect(mockWaitForAssistantReply).not.toHaveBeenCalled();
  });

  it("prints the cited sources under the answer when a release is pinned", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost.mockResolvedValue({});
    mockWaitForAssistantReply.mockResolvedValueOnce({
      content: "PINEAPPLE Io is volcanic [1].",
      name: "@cf/meta/llama-4-scout-17b-16e-instruct",
      citedSources: ["io.md"],
      context: [{ content: "Io", metadata: { originalName: "io.md", sourceUrl: "https://example.org/io" } }],
    });
    await parent().parseAsync(["send", "tx-abc", "Why?", "--release", "rel-1"], { from: "user" });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("PINEAPPLE Io is volcanic [1].");
    expect(printed).toContain("[1] io.md  https://example.org/io");
    logSpy.mockRestore();
  });

  it("does not add a sources block to an ordinary (non-release) reply", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost.mockResolvedValue({});
    mockWaitForAssistantReply.mockResolvedValueOnce({
      content: "Plain.", citedSources: ["io.md"],
      context: [{ metadata: { originalName: "io.md" } }],
    });
    await parent().parseAsync(["send", "tx-abc", "Why?"], { from: "user" });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("Sources:");
    logSpy.mockRestore();
  });

  it("--release --json emits the answer and its citations, not just the accepted-ack", async () => {
    vi.mocked(isJsonMode).mockReturnValue(true);
    mockPost.mockResolvedValue({ response: "ok", messageId: "m", transcriptId: "tx-abc" });
    mockWaitForAssistantReply.mockResolvedValueOnce({
      content: "Answer.", name: "model-x", citedSources: ["io.md"],
      context: [{ metadata: { originalName: "io.md", sourceUrl: "https://example.org/io" } }],
    });
    await parent().parseAsync(["send", "tx-abc", "Why?", "--release", "rel-1"], { from: "user" });
    expect(output).toHaveBeenCalledWith(expect.objectContaining({
      transcriptId: "tx-abc", releaseId: "rel-1", answer: "Answer.", model: "model-x",
      citations: [{ source: "io.md", url: "https://example.org/io" }],
    }));
  });
});
