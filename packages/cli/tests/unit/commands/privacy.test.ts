/**
 * `divinci privacy` — analytics consent from the terminal.
 *
 * The properties worth pinning are about intent survival, not plumbing: each
 * subcommand must send the value it claims to, `reset` must CLEAR the choice
 * rather than reverse it, and none of it may require a workspace — consent
 * belongs to the person, and needing `workspace use` first would make opting
 * out harder than opting in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/config/config-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/config/config-manager.js")>(
    "../../../src/config/config-manager.js",
  );
  return {
    ...actual,
    requireConfig: vi.fn(),
    ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
    // Present so a call would succeed — the point is that nothing calls it.
    requireWorkspaceId: vi.fn(() => "wl-should-not-be-needed"),
  };
});

const { mockGet, mockPut } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPut: vi.fn() }));
vi.mock("../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({ get: mockGet, put: mockPut }),
  }),
}));

vi.mock("../../../src/output/colors.js", () => ({
  colors: {
    yellow: (s: string) => s, green: (s: string) => s, dim: (s: string) => s,
    cyanBold: (s: string) => s, bold: (s: string) => s,
  },
}));

vi.mock("../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
  requireOAuthAuth: vi.fn(),
}));

import { Command } from "commander";
import { registerPrivacyCommand } from "../../../src/commands/privacy/index.js";
import { requireConfig, requireWorkspaceId } from "../../../src/config/config-manager.js";
import { handleCommandError } from "../../../src/utils/errors.js";

const ROUTE = "/user/preferences/analytics";

function run(args: string[]): Promise<Command> {
  const program = new Command();
  program.exitOverride();
  registerPrivacyCommand(program);
  return program.parseAsync(["node", "divinci", "privacy", ...args]);
}

describe("divinci privacy", () => {
  let logged: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.join(" ")); });
    vi.mocked(requireConfig).mockReturnValue({
      apiKey: "test-key",
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "env",
    } as never);
    mockGet.mockResolvedValue({ optOut: null, chosen: false });
    mockPut.mockResolvedValue({ optOut: true, chosen: true });
  });

  describe("status", () => {
    it("reads the preference without writing anything", async () => {
      await run(["status"]);
      expect(mockGet).toHaveBeenCalledWith(ROUTE);
      expect(mockPut).not.toHaveBeenCalled();
    });

    it("distinguishes 'never chosen' from 'opted in' in what it prints", async () => {
      // Reporting "on" for an unset preference would tell the user a decision
      // was made on their behalf.
      mockGet.mockResolvedValue({ optOut: null, chosen: false });
      await run(["status"]);
      expect(logged.join("\n")).toMatch(/not set/i);

      logged = [];
      mockGet.mockResolvedValue({ optOut: false, chosen: true });
      await run(["status"]);
      expect(logged.join("\n")).toMatch(/\bon\b/i);
    });

    it("reports an opt-out as off", async () => {
      mockGet.mockResolvedValue({ optOut: true, chosen: true });
      await run(["status"]);
      expect(logged.join("\n")).toMatch(/\boff\b/i);
    });
  });

  describe("opt-out / opt-in / reset send the value they claim", () => {
    it("opt-out sends true", async () => {
      await run(["opt-out"]);
      expect(mockPut).toHaveBeenCalledWith(ROUTE, { optOut: true });
    });

    it("opt-in sends false", async () => {
      mockPut.mockResolvedValue({ optOut: false, chosen: true });
      await run(["opt-in"]);
      expect(mockPut).toHaveBeenCalledWith(ROUTE, { optOut: false });
    });

    it("reset sends null — clearing the choice, not opting in", async () => {
      // `null` restores "never asked" so browser signals govern again;
      // sending `false` here would silently convert a withdrawal into consent.
      mockPut.mockResolvedValue({ optOut: null, chosen: false });
      await run(["reset"]);
      expect(mockPut).toHaveBeenCalledWith(ROUTE, { optOut: null });
    });
  });

  it("never requires a workspace — consent is not workspace-scoped", async () => {
    await run(["opt-out"]);
    await run(["status"]);
    expect(vi.mocked(requireWorkspaceId)).not.toHaveBeenCalled();
  });

  it("routes a failure through the shared error handler rather than throwing", async () => {
    mockPut.mockRejectedValue(new Error("network down"));
    await run(["opt-out"]);
    expect(vi.mocked(handleCommandError)).toHaveBeenCalledWith(
      expect.objectContaining({ message: "network down" }),
    );
  });

  it("does not claim success when the write fails", async () => {
    mockPut.mockRejectedValue(new Error("network down"));
    await run(["opt-out"]);
    expect(logged.join("\n")).not.toMatch(/analytics is (off|disabled)/i);
  });
});
