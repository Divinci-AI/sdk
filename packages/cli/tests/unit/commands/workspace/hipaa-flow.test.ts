/**
 * The consent step of `divinci workspace create --hipaa`.
 *
 * Creating a workspace HIPAA-scoped records acceptance of the Business
 * Associate Agreement, so the property that matters is NEGATIVE: assent is
 * never inferred. Every path ends in a typed confirmation or in all three
 * explicit --baa-* values, and a refusal happens before anything is created.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInput } = vi.hoisted(() => ({ mockInput: vi.fn() }));
vi.mock("@inquirer/prompts", () => ({ input: mockInput }));
vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
  isJsonMode: vi.fn().mockReturnValue(false),
}));

import {
  ACCEPT_PHRASE,
  assertHipaaFlagsCoherent,
  hipaaConsequences,
  resolveHipaaAssent,
} from "../../../../src/commands/workspace/hipaa-flow.js";

const AGREEMENT = {
  available: true,
  version: "1.0",
  versionHash: "hash-current",
  title: "Business Associate Agreement",
  content: "the exact text",
};
const FLAGS = { hipaa: true, baaSignerTitle: "Owner", baaOrgLegalName: "Clinic LLC", baaVersionHash: "hash-current" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("assertHipaaFlagsCoherent", () => {
  it("refuses --hipaa with --host (find-or-create may return an unscoped workspace)", () => {
    expect(() => assertHipaaFlagsCoherent({ hipaa: true, host: "example.com" })).toThrow(/--host/);
  });

  it("refuses --baa-* without --hipaa rather than quietly creating an unscoped workspace", () => {
    expect(() => assertHipaaFlagsCoherent({ baaSignerTitle: "Owner" })).toThrow(/only apply with --hipaa/);
  });

  it("allows a plain create and a coherent HIPAA create", () => {
    expect(() => assertHipaaFlagsCoherent({})).not.toThrow();
    expect(() => assertHipaaFlagsCoherent(FLAGS)).not.toThrow();
  });
});

describe("resolveHipaaAssent — before any prompt", () => {
  it("refuses while the agreement is unavailable, in both modes, without prompting", async () => {
    const draft = { ...AGREEMENT, available: false };
    await expect(resolveHipaaAssent(draft, FLAGS, false)).rejects.toThrow(/not yet available/);
    await expect(resolveHipaaAssent(draft, FLAGS, true)).rejects.toThrow(/not yet available/);
    expect(mockInput).not.toHaveBeenCalled();
  });

  it("refuses a stale --baa-version-hash", async () => {
    await expect(resolveHipaaAssent(AGREEMENT, { ...FLAGS, baaVersionHash: "old" }, false))
      .rejects.toThrow(/does not match the current agreement/);
  });
});

describe("resolveHipaaAssent — non-interactive", () => {
  it("returns assent when all three values are given, echoing the CURRENT hash", async () => {
    expect(await resolveHipaaAssent(AGREEMENT, FLAGS, false)).toEqual({
      versionHash: "hash-current",
      signerTitle: "Owner",
      organizationLegalName: "Clinic LLC",
    });
    expect(mockInput).not.toHaveBeenCalled();
  });

  it.each([
    ["baaSignerTitle", "--baa-signer-title"],
    ["baaOrgLegalName", "--baa-org-legal-name"],
    ["baaVersionHash", "--baa-version-hash"],
  ])("fails loudly, naming %s, when it is missing", async (key, flag) => {
    await expect(resolveHipaaAssent(AGREEMENT, { ...FLAGS, [key]: undefined }, false))
      .rejects.toThrow(new RegExp(flag));
  });

  it("treats a blank value as missing", async () => {
    await expect(resolveHipaaAssent(AGREEMENT, { ...FLAGS, baaOrgLegalName: "   " }, false))
      .rejects.toThrow(/--baa-org-legal-name/);
  });
});

describe("resolveHipaaAssent — at a terminal", () => {
  it("prompts for what was not given, then needs the typed phrase", async () => {
    mockInput.mockResolvedValueOnce("Clinic LLC").mockResolvedValueOnce("Owner").mockResolvedValueOnce(ACCEPT_PHRASE);

    expect(await resolveHipaaAssent(AGREEMENT, { hipaa: true }, true)).toEqual({
      versionHash: "hash-current",
      signerTitle: "Owner",
      organizationLegalName: "Clinic LLC",
    });
    expect(mockInput).toHaveBeenCalledTimes(3);
  });

  it("states the consequences before asking", async () => {
    mockInput.mockResolvedValue(ACCEPT_PHRASE);
    await resolveHipaaAssent(AGREEMENT, { ...FLAGS }, true);
    const printed = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/the exact text/);
    expect(printed).toMatch(/De-identification is forced on/);
    expect(printed).toMatch(/chat is paused/);
  });

  it.each(["y", "yes", "i accept", "", ACCEPT_PHRASE + "!"])("does not treat %j as acceptance", async (typed) => {
    mockInput.mockResolvedValueOnce(typed);
    await expect(resolveHipaaAssent(AGREEMENT, FLAGS, true)).rejects.toThrow(/not accepted/);
  });

  it("refuses when a prompted field comes back empty", async () => {
    mockInput.mockResolvedValueOnce("  ").mockResolvedValueOnce("Owner");
    await expect(resolveHipaaAssent(AGREEMENT, { hipaa: true }, true)).rejects.toThrow(/both required/);
  });
});

describe("hipaaConsequences — the chat-pause line follows the server", () => {
  const pauseLine = (a: { chatBlockedUntilVendorBaa?: boolean }) =>
    hipaaConsequences(a).filter((l) => /no provider is covered/i.test(l));

  it("warns while the server says chat is blocked until a vendor BAA", () => {
    expect(pauseLine({ chatBlockedUntilVendorBaa: true })).toHaveLength(1);
  });

  it("still warns when the server does not say (an older server could only mean blocked)", () => {
    expect(pauseLine({})).toHaveLength(1);
  });

  it("drops the claim once a provider is covered, keeping the coverage rule", () => {
    expect(pauseLine({ chatBlockedUntilVendorBaa: false })).toHaveLength(0);
    expect(hipaaConsequences({ chatBlockedUntilVendorBaa: false }).join(" ")).toMatch(/covered by a Business Associate Agreement may be used/);
  });

  it("is printed from the agreement at a terminal", async () => {
    mockInput.mockResolvedValueOnce("Clinic LLC").mockResolvedValueOnce("Owner").mockResolvedValueOnce(ACCEPT_PHRASE);
    await resolveHipaaAssent({ ...AGREEMENT, chatBlockedUntilVendorBaa: false }, { hipaa: true }, true);
    const printed = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).not.toMatch(/no provider is covered/i);
  });
});
