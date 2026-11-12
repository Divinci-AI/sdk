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

const { mockDelete } = vi.hoisted(() => ({ mockDelete: vi.fn() }));
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    apiKeys: { delete: mockDelete },
  }),
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: { green: (s: string) => s },
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
  requireOAuthAuth: vi.fn(),
}));

// Skip the interactive confirmation prompt entirely via -y in tests.
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

import { Command } from "commander";
import { registerApiKeyDeleteCommand } from "../../../../src/commands/api-key/delete.js";
import { requireConfig } from "../../../../src/config/config-manager.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function createParent(): Command {
  const parent = new Command("api-key");
  registerApiKeyDeleteCommand(parent);
  return parent;
}

describe("api-key delete command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails fast with a clear message when no workspace is resolvable", async () => {
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "env",
    } as any);

    const parent = createParent();
    await parent.parseAsync(["delete", "key-123", "-y"], { from: "user" });

    expect(mockDelete).not.toHaveBeenCalled();
    expect(handleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No workspace selected. Run `divinci workspace use <id>` or pass --workspace <id>.",
      })
    );
  });

  it("deletes the key when a workspace is resolvable from config", async () => {
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      workspaceId: "ws-123",
      profile: "default",
      source: "env",
      accessToken: "tok",
    } as any);
    mockDelete.mockResolvedValue(undefined);

    const parent = createParent();
    await parent.parseAsync(["delete", "key-123", "-y"], { from: "user" });

    expect(mockDelete).toHaveBeenCalledWith("ws-123", "key-123");
    expect(handleCommandError).not.toHaveBeenCalled();
  });
});
