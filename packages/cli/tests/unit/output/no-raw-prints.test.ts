/**
 * No new raw prints of server-supplied text.
 *
 * The renderers (renderTable / formatKeyValueCell) escape everything that goes
 * through `output()`. Direct `console.log` bypasses them entirely -- which is
 * exactly how 13 sites were missed: fixing the choke point felt like it covered
 * the whole surface, and it covered none of these. This test is the part that
 * would have noticed.
 *
 * It matches on the FIELD NAMES that carry externally-authored text. A RAG
 * document's `title` is the <title> of a crawled page, so these are not merely
 * "another user's string".
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMMANDS = join(__dirname, "../../../src/commands");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** `${...something.title}` and friends, NOT already wrapped in an escaper. */
const RISKY = /\$\{(?![^}]*(?:safeLabel|stripControlChars))[^}]*\.(?:title|name|description)\b[^}]*\}/;

describe("no raw console.log of server-supplied text", () => {
  const offenders: string[] = [];

  for (const file of walk(COMMANDS)) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (!line.includes("console.log(`")) return;
      if (!RISKY.test(line)) return;
      offenders.push(`${file.replace(COMMANDS, "src/commands")}:${i + 1}`);
    });
  }

  it("finds none", () => {
    // If this fails, wrap the value in safeLabel() (single-line labels) or
    // stripControlChars() (longer free text) from src/output/safe-text.ts.
    // Wrap the DATA, inside any colours.* call -- never the assembled line, or
    // you strip our own colour codes too.
    expect(offenders).toEqual([]);
  });

  it("actually inspects files, so an empty result means something", () => {
    // A walker that silently found nothing would make the test above pass
    // forever. Guard the guard.
    const files = walk(COMMANDS);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("rag/targets.ts"))).toBe(true);
  });

  it("its pattern would catch an unwrapped print", () => {
    // Proves the regex bites, without needing a real offender in the tree.
    expect(RISKY.test("console.log(`${colors.cyan(t.title)}`)")).toBe(true);
    expect(RISKY.test("console.log(`${safeLabel(t.title)}`)")).toBe(false);
    expect(RISKY.test("console.log(`${stripControlChars(g.description)}`)")).toBe(false);
  });
});
