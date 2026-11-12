import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockValidateApiKey } = vi.hoisted(() => ({
  mockValidateApiKey: vi.fn(),
}));

vi.mock("../../../../src/config/credentials.js", () => ({
  setProfile: vi.fn(),
  getProfile: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn().mockResolvedValue("https://api.divinci.app"),
  password: vi.fn().mockResolvedValue("prompted-key"),
}));

vi.mock("@divinci-ai/server", () => ({
  DivinciServer: vi.fn().mockImplementation(() => ({
    validateApiKey: mockValidateApiKey,
  })),
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    yellow: (s: string) => s,
    green: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

vi.mock("../../../../src/auth/oauth.js", () => ({
  getAuth0Config: vi.fn(),
  generatePKCE: vi.fn(),
  startCallbackServer: vi.fn(),
  buildAuthorizeUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  fetchUserInfo: vi.fn(),
  openBrowser: vi.fn(),
}));

import { Command } from "commander";
import { registerLoginCommand } from "../../../../src/commands/auth/login.js";
import { setProfile } from "../../../../src/config/credentials.js";
import { password } from "@inquirer/prompts";

describe("auth login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiKey.mockResolvedValue(true);
  });

  // Mirrors the real CLI's command tree: root program declares the
  // value-taking global `--api-key <key>` override; `auth login` is a
  // nested subcommand. This used to also declare a local boolean
  // `--api-key`, which collided with the root's value-taking definition
  // (commander resolves the root's first) and made the subcommand's
  // intent-flag permanently unreachable.
  function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option("--api-key <key>", "Override API key");
    program.option("--profile <name>", "Named profile", "default");
    program.option("--api-url <url>", "Override API base URL");
    const auth = program.command("auth");
    registerLoginCommand(auth);
    return program;
  }

  it("triggers API-key auth when the root --api-key <value> override is supplied, without --use-api-key", async () => {
    const program = createProgram();

    await program.parseAsync(["auth", "login", "--api-key", "root-level-key"], { from: "user" });

    // The provided key is used directly — no interactive password prompt.
    expect(password).not.toHaveBeenCalled();
    expect(setProfile).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ apiKey: "root-level-key", authType: "api-key" })
    );
  });

  it("triggers API-key auth via the renamed --use-api-key boolean flag (prompts for the key)", async () => {
    const program = createProgram();

    await program.parseAsync(["auth", "login", "--use-api-key"], { from: "user" });

    expect(password).toHaveBeenCalled();
    expect(setProfile).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ apiKey: "prompted-key", authType: "api-key" })
    );
  });

  it("parses --api-key and --use-api-key together with no collision or exception", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["auth", "login", "--api-key", "combo-key", "--use-api-key"], { from: "user" })
    ).resolves.not.toThrow();

    expect(setProfile).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ apiKey: "combo-key", authType: "api-key" })
    );
  });
});
