// `divinci byok create|rotate --auth-file` keeps the credential out of argv,
// and a bad payload is never echoed; `divinci byok test` prints only the
// probe outcome and exits 1 when the endpoint did not answer correctly.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({ apiKey: "test-key", apiUrl: "https://api.divinci.app", workspaceId: "ws-123", profile: "default", source: "env" }),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));
const mockCreate = vi.fn();
const mockRotate = vi.fn();
const mockTest = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({ byok: {
    create: (...a: unknown[]) => mockCreate(...a),
    rotate: (...a: unknown[]) => mockRotate(...a),
    test: (...a: unknown[]) => mockTest(...a),
  } }),
}));
const mockOutput = vi.fn();
vi.mock("../../../../src/output/formatter.js", () => ({ output: (...a: unknown[]) => mockOutput(...a) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn((e: unknown) => { throw e; }), requireOAuthAuth: vi.fn() }));

import { Command } from "commander";
import { registerByokCreateCommand, readAuthPayload } from "../../../../src/commands/byok/create.js";
import { registerByokRotateCommand } from "../../../../src/commands/byok/rotate.js";
import { registerByokTestCommand } from "../../../../src/commands/byok/test.js";

function cli(): Command {
  const program = new Command();
  const byok = program.command("byok");
  registerByokCreateCommand(byok);
  registerByokRotateCommand(byok);
  registerByokTestCommand(byok);
  return program;
}

const TOKEN = ["tok", "secret", "98765"].join("-");
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "byok-cli-"));
  mockCreate.mockReset().mockResolvedValue({ _id: "k1" });
  mockRotate.mockReset().mockResolvedValue({ _id: "k1" });
  mockTest.mockReset();
  mockOutput.mockReset();
  process.exitCode = undefined;
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); process.exitCode = undefined; });

describe("readAuthPayload", () => {
  it("reads a file", () => {
    const f = join(dir, "auth.json");
    writeFileSync(f, JSON.stringify({ apiKey: TOKEN }));
    expect(readAuthPayload({ authFile: f })).toEqual({ apiKey: TOKEN });
  });

  it("reads stdin for '-'", () => {
    expect(readAuthPayload({ authFile: "-" }, () => JSON.stringify({ apiKey: TOKEN }))).toEqual({ apiKey: TOKEN });
  });

  it("never echoes a payload that is not JSON", () => {
    expect(() => readAuthPayload({ auth: `{"apiKey":"${TOKEN}"` })).toThrow(/contents not shown/);
    try { readAuthPayload({ auth: `{"apiKey":"${TOKEN}"` }); } catch (e) { expect(String(e)).not.toContain(TOKEN); }
  });

  it.each([["an array", "[1]"], ["null", "null"], ["a string", '"x"']])("refuses %s", (_l, raw) => {
    expect(() => readAuthPayload({ auth: raw })).toThrow(/JSON object/);
  });

  it("needs exactly one source", () => {
    expect(() => readAuthPayload({})).toThrow(/required/);
    expect(() => readAuthPayload({ auth: "{}", authFile: "-" })).toThrow(/not both/);
  });
});

describe("byok create / rotate --auth-file", () => {
  it("create sends the file's payload", async () => {
    const f = join(dir, "auth.json");
    writeFileSync(f, JSON.stringify({ apiKey: TOKEN }));
    await cli().parseAsync(["node", "divinci", "byok", "create", "--name", "nli", "--provider", "openai-compatible",
      "--auth-file", f, "--endpoint", "https://gpu3.example.com/v1/chat/completions", "--model", "m1"]);
    expect(mockCreate.mock.calls[0][1].auth).toEqual({ apiKey: TOKEN });
  });

  it("rotate sends the file's payload", async () => {
    const f = join(dir, "auth.json");
    writeFileSync(f, JSON.stringify({ apiKey: TOKEN }));
    await cli().parseAsync(["node", "divinci", "byok", "rotate", "k1", "--auth-file", f]);
    expect(mockRotate).toHaveBeenCalledWith("ws-123", "k1", { auth: { apiKey: TOKEN } });
  });
});

describe("byok test", () => {
  it("prints the outcome and leaves the exit code alone on success", async () => {
    mockTest.mockResolvedValue({ ok: true, latencyMs: 120 });
    await cli().parseAsync(["node", "divinci", "byok", "test", "k1"]);
    expect(mockTest).toHaveBeenCalledWith("ws-123", "k1");
    expect(mockOutput.mock.calls[0][0]).toEqual({ ok: true, latencyMs: 120 });
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 when the endpoint did not answer correctly", async () => {
    mockTest.mockResolvedValue({ ok: false, kind: "auth", status: 401, latencyMs: 80 });
    await cli().parseAsync(["node", "divinci", "byok", "test", "k1"]);
    expect(process.exitCode).toBe(1);
  });
});
