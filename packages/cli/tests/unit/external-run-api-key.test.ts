import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApiKey } from "../../src/commands/qa/external-run.js";

describe("readApiKey", () => {
  const dirs: string[] = [];
  afterEach(() => { delete process.env.QA_TEST_KEY; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const file = (content: string) => {
    const d = mkdtempSync(join(tmpdir(), "qa-key-"));
    dirs.push(d);
    const p = join(d, "key");
    writeFileSync(p, content, { mode: 0o600 });
    return p;
  };

  it("returns undefined when no source is given (a public endpoint)", () => {
    expect(readApiKey({})).toBeUndefined();
  });

  it("reads and trims an environment variable", () => {
    process.env.QA_TEST_KEY = "  sk-abc \n";
    expect(readApiKey({ apiKeyEnv: "QA_TEST_KEY" })).toBe("sk-abc");
  });

  it("reads and trims a file", () => {
    expect(readApiKey({ apiKeyFile: file("sk-from-file\n") })).toBe("sk-from-file");
  });

  it("refuses both sources at once", () => {
    process.env.QA_TEST_KEY = "x";
    expect(() => readApiKey({ apiKeyEnv: "QA_TEST_KEY", apiKeyFile: file("y") })).toThrow(/not both/);
  });

  it("fails clearly, without echoing a value, when the variable is unset or the file empty", () => {
    expect(() => readApiKey({ apiKeyEnv: "QA_TEST_KEY" })).toThrow(/QA_TEST_KEY is not set/);
    expect(() => readApiKey({ apiKeyFile: file("  \n") })).toThrow(/is empty/);
  });

  it("is never read from an argument that could appear in a process listing: there is no flag for the key itself", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../../src/commands/qa/external-run.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.option\("--api-key[ <"]/);          // --api-key-env and --api-key-file only
    expect(src).not.toMatch(/\.option\("-k[, ]/);
  });
});
