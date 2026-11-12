/**
 * Guard for `divinci-api-key-create-grants-everything-by-default`
 * (notes/KNOWN-GAPS.yaml).
 *
 * The server and MCP treat a missing or empty API-key permission list as
 * "grant everything". `divinci api-key create` used to send no `permissions`
 * unless --permissions was passed, so the command whose purpose is issuing
 * credentials to other systems minted full-access keys by default. It now
 * refuses unless the caller either scopes the key or opts in with --full-access.
 */
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

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    apiKeys: { create: mockCreate },
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
  isJsonMode: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
  requireOAuthAuth: vi.fn(),
}));

import { Command } from "commander";
import { registerApiKeyCreateCommand } from "../../../../src/commands/api-key/create.js";
import { requireConfig } from "../../../../src/config/config-manager.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

const WS = "6a312a5b8ad8bd2a0833344a";

function createParent(): Command {
  const parent = new Command("api-key");
  registerApiKeyCreateCommand(parent);
  return parent;
}

async function run(args: string[]): Promise<void> {
  await createParent().parseAsync(["create", "--name", "ci", "--workspace", WS, ...args], { from: "user" });
}

function reportedError(): Error {
  expect(handleCommandError).toHaveBeenCalledTimes(1);
  return vi.mocked(handleCommandError).mock.calls[0][0] as Error;
}

describe("api-key create — divinci-api-key-create-grants-everything-by-default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireConfig).mockReturnValue({
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "config",
      accessToken: "tok",
    } as any);
    mockCreate.mockResolvedValue({ id: "key-1", name: "ci", secret: "s" });
  });

  it("refuses to create a key when neither --permissions nor --full-access is given", async () => {
    await run([]);

    expect(mockCreate).not.toHaveBeenCalled();
    const err = reportedError();
    expect(err.message).toMatch(/Refusing to create an API key without --permissions/);
    // The message must say how to scope a key, and how to opt in deliberately.
    expect(err.message).toMatch(/--permissions rag:read,chat:read/);
    expect(err.message).toMatch(/--full-access/);
  });

  it("refuses an empty --permissions list, which would also grant everything", async () => {
    for (const empty of ["", ",", " , "]) {
      vi.clearAllMocks();
      await run(["--permissions", empty]);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(reportedError().message).toMatch(/names no permissions/);
    }
  });

  it("refuses --permissions together with --full-access", async () => {
    await run(["--permissions", "rag:read", "--full-access"]);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(reportedError().message).toMatch(/mutually exclusive/);
  });

  it("sends the scoped permission list when --permissions is given", async () => {
    await run(["--permissions", "rag:read, chat:read"]);

    expect(handleCommandError).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: WS,
      name: "ci",
      permissions: ["rag:read", "chat:read"],
    });
  });

  it("creates an unscoped key only with an explicit --full-access", async () => {
    await run(["--full-access"]);

    expect(handleCommandError).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(body).toEqual({ workspaceId: WS, name: "ci" });
    expect(body).not.toHaveProperty("permissions");
  });
});
