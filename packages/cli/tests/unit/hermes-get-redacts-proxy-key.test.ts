/**
 * `divinci hermes get` must not print a live `hsk-` proxy key.
 *
 * gap: hermes-get-leaks-proxy-api-key-unredacted
 *
 * A Hermes proxy key is a SPEND primitive — every completion it buys is a
 * billed unattended agent turn with a terminal. `hermes get` is the ROUTINE
 * read (fleet verification scripts, CI checks, agents), so every capture of its
 * stdout used to be a credential leak; five live keys reached agent transcripts
 * that way. `hermes key <id>` remains the deliberate way to print one.
 */
import { describe, it, expect } from "vitest";
import { redactProxyKey } from "../../src/commands/hermes/get.js";

const KEY = `hsk-${"a1b2c3d4".repeat(5)}`; // 40 hex chars, assembled — never a literal

describe("redactProxyKey", () => {
  it("never emits the spendable remainder of the key", () => {
    const out = redactProxyKey(KEY);
    expect(out).not.toContain(KEY);
    // The tail is what makes it spendable; only the first 8 chars may survive.
    expect(out).not.toContain(KEY.slice(8));
  });

  it("keeps enough to identify and compare two keys", () => {
    expect(redactProxyKey(KEY)).toContain("hsk-a1b2");
    expect(redactProxyKey(KEY)).toBe(redactProxyKey(KEY));
    expect(redactProxyKey(KEY)).not.toBe(redactProxyKey(`hsk-${"9f8e7d6c".repeat(5)}`));
  });

  it("points at the command that does print the key", () => {
    expect(redactProxyKey(KEY)).toContain("divinci hermes key");
  });
});
