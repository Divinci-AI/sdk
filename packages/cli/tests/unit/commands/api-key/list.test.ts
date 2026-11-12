import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/config/config-manager.js")>(
    "../../../../src/config/config-manager.js"
  );
  return {
    ...actual,
    requireConfig: vi.fn(),
    ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
  };
});

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    apiKeys: { list: mockList },
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
  requireOAuthAuth: vi.fn(),
}));

import { Command } from "commander";
import { registerApiKeyListCommand } from "../../../../src/commands/api-key/list.js";
import { requireConfig } from "../../../../src/config/config-manager.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function createParent(): Command {
  const parent = new Command("api-key");
  registerApiKeyListCommand(parent);
  return parent;
}

describe("api-key list command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails fast with a clear message when no workspace is resolvable", async () => {
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "env",
      // workspaceId intentionally omitted
    } as any);

    const parent = createParent();
    await parent.parseAsync(["list"], { from: "user" });

    expect(mockList).not.toHaveBeenCalled();
    expect(handleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No workspace selected. Run `divinci workspace use <id>` or pass --workspace <id>.",
      })
    );
  });

  it("lists keys when a workspace is resolvable from config", async () => {
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      workspaceId: "ws-123",
      profile: "default",
      source: "env",
      accessToken: "tok",
    } as any);
    mockList.mockResolvedValue([]);

    const parent = createParent();
    await parent.parseAsync(["list"], { from: "user" });

    expect(mockList).toHaveBeenCalledWith("ws-123");
    expect(handleCommandError).not.toHaveBeenCalled();
  });

  it("uses --workspace override when config has no default workspace", async () => {
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "env",
      accessToken: "tok",
    } as any);
    mockList.mockResolvedValue([]);

    const parent = createParent();
    await parent.parseAsync(["list", "--workspace", "ws-override"], { from: "user" });

    expect(mockList).toHaveBeenCalledWith("ws-override");
    expect(handleCommandError).not.toHaveBeenCalled();
  });
});
