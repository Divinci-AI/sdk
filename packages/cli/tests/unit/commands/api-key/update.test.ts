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

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    apiKeys: { update: mockUpdate },
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
import { registerApiKeyUpdateCommand } from "../../../../src/commands/api-key/update.js";
import { requireConfig } from "../../../../src/config/config-manager.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

function createParent(): Command {
  const parent = new Command("api-key");
  registerApiKeyUpdateCommand(parent);
  return parent;
}

describe("api-key update command", () => {
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
    await parent.parseAsync(["update", "key-123", "--name", "new-name"], { from: "user" });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(handleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No workspace selected. Run `divinci workspace use <id>` or pass --workspace <id>.",
      })
    );
  });

  it("updates the key when a workspace is resolvable from config", async () => {
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      workspaceId: "ws-123",
      profile: "default",
      source: "env",
      accessToken: "tok",
    } as any);
    mockUpdate.mockResolvedValue({ id: "key-123", name: "new-name" });

    const parent = createParent();
    await parent.parseAsync(["update", "key-123", "--name", "new-name"], { from: "user" });

    expect(mockUpdate).toHaveBeenCalledWith("ws-123", "key-123", { name: "new-name" });
    expect(handleCommandError).not.toHaveBeenCalled();
  });
});
