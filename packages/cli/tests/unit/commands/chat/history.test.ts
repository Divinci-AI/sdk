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
}));

const mockGet = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({ get: mockGet }),
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
    cyanBold: (s: string) => s,
    greenBold: (s: string) => s,
    dim: (s: string) => s,
  },
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
}));

import { Command } from "commander";
import { registerChatHistoryCommand } from "../../../../src/commands/chat/history.js";
import { output, isJsonMode } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function createParent(): Command {
  const parent = new Command("chat");
  registerChatHistoryCommand(parent);
  return parent;
}

describe("chat history command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch conversation history", async () => {
    mockGet.mockResolvedValue({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ],
      title: "Test Chat",
    });

    const parent = createParent();
    await parent.parseAsync(["history", "tx-123"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith(
      "/white-label/ws-123/transcript/tx-123",
      { limit: 50 }
    );
  });

  it("should pass custom limit", async () => {
    mockGet.mockResolvedValue({ messages: [], title: null });

    const parent = createParent();
    await parent.parseAsync(["history", "tx-123", "--limit", "10"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith(
      "/white-label/ws-123/transcript/tx-123",
      { limit: 10 }
    );
  });

  it("should print messages to console in text mode", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGet.mockResolvedValue({
      messages: [
        { role: "user", content: "Question?" },
        { role: "assistant", content: "Answer!" },
      ],
      title: "My Chat",
    });

    const parent = createParent();
    await parent.parseAsync(["history", "tx-123"], { from: "user" });

    // Should print title
    expect(consoleSpy).toHaveBeenCalledWith("My Chat");
    // Should print messages with role labels
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Question?"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Answer!"));
    consoleSpy.mockRestore();
  });

  it("should output JSON in json mode", async () => {
    vi.mocked(isJsonMode).mockReturnValue(true);
    const data = { messages: [{ role: "user", content: "Hi" }], title: "Chat" };
    mockGet.mockResolvedValue(data);

    const parent = createParent();
    await parent.parseAsync(["history", "tx-123"], { from: "user" });

    expect(output).toHaveBeenCalledWith(data);
  });

  it("should handle errors", async () => {
    const err = new Error("Not found");
    mockGet.mockRejectedValue(err);

    const parent = createParent();
    await parent.parseAsync(["history", "tx-123"], { from: "user" });

    expect(handleCommandError).toHaveBeenCalledWith(err);
  });
});
