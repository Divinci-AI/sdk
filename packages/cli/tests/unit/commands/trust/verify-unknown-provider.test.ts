/**
 * `divinci trust verify` against a run whose provider id this CLI's bundled
 * verifier does not know. Uses the REAL verifier (only HTTP is faked), so it
 * pins the whole chain: schema shape check -> signature -> warning -> output
 * and exit code. A stale CLI must show such a row as VERIFIED with a warning,
 * and FAILED only under --strict.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, sign as edSign, createHash } from "node:crypto";

const h = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn(() => ({ apiUrl: "https://api.example/", accessToken: "tok" })),
  ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn(), isJsonMode: vi.fn().mockReturnValue(false) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));

import { Command } from "commander";
import { canonicalJSON, utf8Bytes } from "@divinci-ai/trustbench-verifier";
import { registerTrustVerifyCommand } from "../../../../src/commands/trust/verify.js";
import { setColorsEnabled } from "../../../../src/output/colors.js";

const RUN = "tr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const KEY_ID = "tbp-test-001";
// node:crypto Ed25519 (the CLI does not depend on @noble/ed25519).
let priv: ReturnType<typeof generateKeyPairSync>["privateKey"];
let pub: Buffer;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const sha256 = (d: Uint8Array) => createHash("sha256").update(d).digest();

async function manifest(providerId: string) {
  const body = {
    $schema: "https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json",
    version: "1.0.0", runId: RUN,
    createdAt: "2026-09-24T23:28:35.000Z", completedAt: "2026-09-24T23:40:19.000Z",
    benchmark: { id: "bm_01HZZZZZZZZZZZZZZZZZZZZZZZ", slug: "dfo", version: "1.0.0", contentHash: "sha256:" + "0".repeat(64), authorId: "ba_01HZZZZZZZZZZZZZZZZZZZZZZZ", authorSignature: "x" },
    model: { assistantId: "a", providerId, modelId: "m", configHash: "sha256:" + "1".repeat(64) },
    harness: { name: "divinci-arena-shim", version: "v1", configHash: "sha256:" + "3".repeat(64) },
    execution: { tier: "v1-signed-logs", platform: "trustbench-divinci", region: "us-central1", durationMs: 1, signedAt: "2026-09-25T00:42:08.000Z" },
    results: {
      score: 0.5, metric: "m", range: { min: 0, max: 1 },
      outputsR2Key: `trustbench/runs/${RUN}/outputs.json`, outputsHash: "sha256:" + "2".repeat(64), sampleCount: 1,
      provenance: { sourceKind: "measured", modelInvoked: true, evaluator: { name: "e", version: "1", invocationId: "i" }, outputsR2Key: `trustbench/runs/${RUN}/outputs.json` },
    },
  };
  const sig = edSign(null, sha256(utf8Bytes(canonicalJSON(body))), priv);
  return { ...body, signatures: [{ signer: "trustbench-platform", keyId: KEY_ID, algorithm: "ed25519", publicKey: b64(pub), signature: b64(sig) }] };
}

const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function runVerify(providerId: string, extra: string[] = []) {
  const m = await manifest(providerId);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/.well-known/trustbench-keys.json")) {
      return res({ version: "1", platform: "t", keys: [{ keyId: KEY_ID, algorithm: "ed25519", publicKey: b64(pub), validFrom: "2026-01-01T00:00:00Z", validUntil: null, deprecated: false }] });
    }
    if (url.endsWith("/manifest")) return res(m);
    return new Response("", { status: 404 }); // outputs: best-effort, absent
  }));
  const program = new Command();
  program.option("--json");
  registerTrustVerifyCommand(program.command("trust"));
  await program.parseAsync(["node", "cli", "trust", "verify", RUN, ...extra]);
}

beforeAll(() => {
  const kp = generateKeyPairSync("ed25519");
  priv = kp.privateKey;
  pub = Buffer.from(kp.publicKey.export({ format: "jwk" }).x as string, "base64url");
  setColorsEnabled(false);
});
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.lines = [];
  process.exitCode = undefined;
  logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { h.lines.push(a.join(" ")); });
});
afterEach(() => { vi.unstubAllGlobals(); logSpy.mockRestore(); process.exitCode = undefined; });

const WARNING = "unknown provider id 'brand-new-provider'; verifier may be older than the run";

describe("divinci trust verify with a provider id the verifier does not know", () => {
  it("prints VERIFIED plus the unknown-provider warning, exit code 0", async () => {
    await runVerify("brand-new-provider");
    const out = h.lines.join("\n");
    expect(out).toContain("VERIFIED");
    expect(out).not.toContain("FAILED");
    expect(out).toContain(`⚠ ${WARNING}`);
    expect(process.exitCode).toBeUndefined();
  });

  it("--strict fails it (exit code 1) and still prints the warning", async () => {
    await runVerify("brand-new-provider", ["--strict"]);
    const out = h.lines.join("\n");
    expect(out).toContain("FAILED");
    expect(out).toContain(WARNING);
    expect(process.exitCode).toBe(1);
  });

  it("a VERIFIED run prints the signing key id", async () => {
    await runVerify("voyage");
    const out = h.lines.join("\n");
    expect(out).toContain("VERIFIED");
    expect(out).toContain(`signer: ${KEY_ID}`);
  });

  it("a known provider prints no provider warning", async () => {
    await runVerify("voyage");
    expect(h.lines.join("\n")).not.toContain("unknown provider id");
  });
});
