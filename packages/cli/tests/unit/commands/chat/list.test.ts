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
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/output/colors.js", () => ({ colors: {} }));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
}));

import { Command } from "commander";
import { registerChatListCommand } from "../../../../src/commands/chat/list.js";
import { output } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function createParent(): Command {
  const parent = new Command("chat");
  registerChatListCommand(parent);
  return parent;
}

describe("chat list command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch conversations with default pagination", async () => {
    mockGet.mockResolvedValue({ transcripts: [], total: 0 });

    const parent = createParent();
    await parent.parseAsync(["list"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith(
      "/white-label/ws-123/transcript",
      { limit: 20, offset: 0 }
    );
  });

  it("should pass custom limit and offset", async () => {
    mockGet.mockResolvedValue({ transcripts: [], total: 0 });

    const parent = createParent();
    await parent.parseAsync(["list", "--limit", "5", "--offset", "10"], { from: "user" });

    expect(mockGet).toHaveBeenCalledWith(
      "/white-label/ws-123/transcript",
      { limit: 5, offset: 10 }
    );
  });

  it("should output transcripts as table", async () => {
    const transcripts = [
      { id: "t1", title: "Chat 1", messageCount: 3, createdAt: "2026-01-01" },
    ];
    mockGet.mockResolvedValue({ transcripts, total: 1 });

    const parent = createParent();
    await parent.parseAsync(["list"], { from: "user" });

    expect(output).toHaveBeenCalledWith(transcripts, {
      table: {
        columns: expect.arrayContaining([
          expect.objectContaining({ key: "id" }),
          expect.objectContaining({ key: "title" }),
        ]),
      },
    });
  });

  it("should handle errors", async () => {
    const err = new Error("fail");
    mockGet.mockRejectedValue(err);

    const parent = createParent();
    await parent.parseAsync(["list"], { from: "user" });

    expect(handleCommandError).toHaveBeenCalledWith(err);
  });
});
