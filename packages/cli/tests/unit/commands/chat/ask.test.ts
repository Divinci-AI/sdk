import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key", apiUrl: "https://api.divinci.app", workspaceId: "ws-123", profile: "default", source: "env",
  }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-123"),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({ get: mockGet, post: mockPost }),
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
  isJsonMode: vi.fn().mockReturnValue(false),
}));
vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));
vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => s, dim: (s: string) => s, green: (s: string) => s,
    greenBold: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s,
  },
}));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));
vi.mock("../../../../src/commands/chat/model-label.js", () => ({ formatServedModelLabel: (s: string) => s }));

const mockGetTranscriptMessageCount = vi.fn().mockResolvedValue(0);
const mockWaitForAssistantReply = vi.fn();
vi.mock("../../../../src/commands/chat/wait-for-reply.js", () => ({
  getTranscriptMessageCount: (...args: unknown[]) => mockGetTranscriptMessageCount(...args),
  waitForAssistantReply: (...args: unknown[]) => mockWaitForAssistantReply(...args),
}));

import { Command } from "commander";
import { registerChatAskCommand } from "../../../../src/commands/chat/ask.js";
import { output, isJsonMode } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function parent(): Command {
  const p = new Command("chat");
  registerChatAskCommand(p);
  return p;
}

const REPLY = {
  content: "PINEAPPLE Io is volcanic [1].",
  name: "@cf/meta/llama-4-scout-17b-16e-instruct",
  citedSources: ["io.md"],
  context: [{ content: "Io", metadata: { originalName: "io.md", sourceUrl: "https://example.org/io", similarity: 0.63 } }],
};

function lastError(): Error {
  const calls = vi.mocked(handleCommandError).mock.calls;
  return calls[calls.length - 1][0] as Error;
}

describe("chat ask", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isJsonMode).mockReturnValue(false);
    mockGet.mockResolvedValue({ _id: "rel-1", status: "draft" });
    mockPost.mockImplementation(async (path: string) => (
      path.endsWith("/transcript") ? { _id: "tx-new" } : { status: "ok" }
    ));
    mockGetTranscriptMessageCount.mockResolvedValue(0);
    mockWaitForAssistantReply.mockResolvedValue(REPLY);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("creates a release-tied conversation, then asks with the release pinned", async () => {
    await parent().parseAsync(["ask", "Why is Io volcanic?", "--release", "rel-1"], { from: "user" });

    expect(mockPost).toHaveBeenNthCalledWith(1, "/white-label/ws-123/transcript", {
      title: "CLI question", releaseId: "rel-1",
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/white-label/ws-123/transcript/tx-new/message", {
      content: "Why is Io volcanic?", type: "release", releaseId: "rel-1",
    });
    expect(handleCommandError).not.toHaveBeenCalled();
  });

  it("prints the answer and the cited source with its URL", async () => {
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1"], { from: "user" });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("PINEAPPLE Io is volcanic [1].");
    expect(printed).toContain("[1] io.md  https://example.org/io");
    expect(printed).toContain("Conversation: tx-new");
  });

  it("says so when a draft release is answering as its owner", async () => {
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1"], { from: "user" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"draft"'));
  });

  it("stays quiet about status for a published release", async () => {
    mockGet.mockResolvedValue({ _id: "rel-1", status: "available" });
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1", "--published-only"], { from: "user" });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(handleCommandError).not.toHaveBeenCalled();
  });

  it("--published-only refuses a draft and sends nothing", async () => {
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1", "--published-only"], { from: "user" });
    expect(lastError().message).toMatch(/not published.*divinci release publish rel-1/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a release that does not exist is a clear error, not a raw HTTP failure", async () => {
    mockGet.mockRejectedValue(new Error("HTTP 404: not found"));
    await parent().parseAsync(["ask", "Why?", "--release", "nope"], { from: "user" });
    expect(lastError().message).toMatch(/Release nope not found in this workspace/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("an unrelated lookup failure (auth, network) is passed through untouched", async () => {
    mockGet.mockRejectedValue(new Error("HTTP 500: boom"));
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1"], { from: "user" });
    expect(lastError().message).toBe("HTTP 500: boom");
  });

  it("a client-side timeout on the send keeps waiting for the reply that is still being generated", async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path.endsWith("/transcript")) return { _id: "tx-new" };
      throw new Error("Request timed out after 30000ms");
    });
    await parent().parseAsync(["ask", "Slow?", "--release", "rel-1"], { from: "user" });
    expect(handleCommandError).not.toHaveBeenCalled();
    expect(mockWaitForAssistantReply).toHaveBeenCalled();
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("PINEAPPLE");
  });

  it("Cloudflare's edge cutting the send (524) keeps waiting for the reply too", async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path.endsWith("/transcript")) return { _id: "tx-new" };
      throw Object.assign(new Error("Unknown error"), { status: 524 });
    });
    await parent().parseAsync(["ask", "Slow?", "--release", "rel-1"], { from: "user" });
    expect(handleCommandError).not.toHaveBeenCalled();
    expect(mockWaitForAssistantReply).toHaveBeenCalled();
  });

  it("a real server error (500) on the send is reported, not waited out", async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path.endsWith("/transcript")) return { _id: "tx-new" };
      throw Object.assign(new Error("Internal"), { status: 500 });
    });
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1"], { from: "user" });
    expect(handleCommandError).toHaveBeenCalled();
    expect(mockWaitForAssistantReply).not.toHaveBeenCalled();
  });

  it("no reply in time is an error that names how to find it later", async () => {
    mockWaitForAssistantReply.mockResolvedValue(null);
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1", "--wait", "5"], { from: "user" });
    expect(lastError().message).toMatch(/No assistant reply within 5s.*divinci chat history tx-new/);
  });

  it("--transcript continues an existing conversation instead of creating one", async () => {
    await parent().parseAsync(["ask", "And Europa?", "--release", "rel-1", "--transcript", "tx-old"], { from: "user" });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/white-label/ws-123/transcript/tx-old/message", expect.objectContaining({
      type: "release", releaseId: "rel-1",
    }));
  });

  it("--assistant-name overrides the model but the release stays pinned", async () => {
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1", "--assistant-name", "model-x"], { from: "user" });
    expect(mockPost).toHaveBeenLastCalledWith(expect.any(String), {
      content: "Why?", assistantName: "model-x", type: "release", releaseId: "rel-1",
    });
  });

  it("--json emits one object: answer, model, citations, release status", async () => {
    vi.mocked(isJsonMode).mockReturnValue(true);
    await parent().parseAsync(["ask", "Why?", "--release", "rel-1"], { from: "user" });
    expect(output).toHaveBeenCalledWith({
      transcriptId: "tx-new",
      releaseId: "rel-1",
      releaseStatus: "draft",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      answer: "PINEAPPLE Io is volcanic [1].",
      citations: [{ source: "io.md", url: "https://example.org/io", similarity: 0.63 }],
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("requires --release", async () => {
    const p = parent();
    p.exitOverride();
    p.commands.forEach((c) => c.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} }));
    await expect(p.parseAsync(["ask", "Why?"], { from: "user" })).rejects.toThrow(/--release/);
  });
});
