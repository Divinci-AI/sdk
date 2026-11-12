/**
 * `divinci workspace create --hipaa` wiring: assent is gathered BEFORE create is
 * called, so every refusal leaves no workspace behind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/config/config-manager.js")>(
    "../../../../src/config/config-manager.js",
  );
  return {
    ...actual,
    requireConfig: vi.fn().mockReturnValue({ apiUrl: "https://api.divinci.app", profile: "default", source: "config", accessToken: "t" }),
    ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
  };
});

const { mockCreate, mockAgreement } = vi.hoisted(() => ({ mockCreate: vi.fn(), mockAgreement: vi.fn() }));
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({ workspaces: { create: mockCreate, getBaaAgreement: mockAgreement } }),
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn(), isJsonMode: vi.fn().mockReturnValue(true) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn(), requireOAuthAuth: vi.fn() }));
vi.mock("@inquirer/prompts", () => ({ input: vi.fn() }));

import { Command } from "commander";
import { registerWorkspaceCreateCommand } from "../../../../src/commands/workspace/create.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

const AGREEMENT = { available: true, version: "1.0", versionHash: "hash-current", title: "BAA", content: "c" };
const BASE = ["create", "--title", "Clinic", "--description", "d"];
const BAA_FLAGS = ["--hipaa", "--baa-signer-title", "Owner", "--baa-org-legal-name", "Clinic LLC", "--baa-version-hash", "hash-current"];

async function run(args: string[]) {
  const parent = new Command("workspace");
  registerWorkspaceCreateCommand(parent);
  await parent.parseAsync([...BASE, ...args], { from: "user" });
}
const reported = () => String((vi.mocked(handleCommandError).mock.calls[0]?.[0] as Error)?.message);

beforeEach(() => {
  vi.clearAllMocks();
  mockAgreement.mockResolvedValue(AGREEMENT);
  mockCreate.mockResolvedValue({ id: "w1", hipaaScoped: true, hipaa: { chatBlockedUntilVendorBaa: true } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("workspace create --hipaa", () => {
  it("passes the hipaa object with the echoed hash to create", async () => {
    await run(BAA_FLAGS);

    expect(mockCreate).toHaveBeenCalledWith({
      name: "Clinic",
      description: "d",
      hipaa: { versionHash: "hash-current", signerTitle: "Owner", organizationLegalName: "Clinic LLC" },
    });
    expect(handleCommandError).not.toHaveBeenCalled();
  });

  it("warns that chat is paused when the server says so", async () => {
    await run(BAA_FLAGS);
    expect(vi.mocked(console.warn).mock.calls.join("\n")).toMatch(/Chat is paused/);
  });

  it("calls create ZERO times while the agreement is a draft", async () => {
    mockAgreement.mockResolvedValue({ ...AGREEMENT, available: false });
    await run(BAA_FLAGS);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(reported()).toMatch(/not yet available/);
  });

  it("calls create ZERO times when run non-interactively with flags missing", async () => {
    await run(["--hipaa", "--baa-signer-title", "Owner"]);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(reported()).toMatch(/--baa-org-legal-name/);
  });

  it("refuses --hipaa with --host before touching the network", async () => {
    await run([...BAA_FLAGS, "--host", "example.com"]);

    expect(mockAgreement).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(reported()).toMatch(/--host/);
  });

  it("refuses a stale hash and creates nothing", async () => {
    await run(BAA_FLAGS.map((a) => (a === "hash-current" ? "old-hash" : a)));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(reported()).toMatch(/does not match/);
  });
});

describe("workspace create without --hipaa", () => {
  it("is unchanged: no agreement fetch, no hipaa field", async () => {
    mockCreate.mockResolvedValue({ id: "w1" });
    await run([]);

    expect(mockAgreement).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({ name: "Clinic", description: "d" });
  });
});
