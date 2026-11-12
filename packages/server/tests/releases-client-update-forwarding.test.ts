import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UNFORWARDED_UPDATE_FIELDS } from "../src/releases/index.js";

/**
 * The structural guard for a defect this file's siblings have now documented
 * twice: `skillConfig` (`releases-client-skill-config.test.ts`) and the three
 * voice fields (`releases-client-voice.test.ts`).
 *
 * Both had the same shape. `UpdateReleaseOptions` grew a field, the CLI
 * assigned it through `(updates as Record<string, unknown>)`, and
 * `updateInWorkspace` — whose body is an explicit ALLOWLIST — never read it
 * from `options`. Nothing failed. The call returned 200 and the release did
 * not change.
 *
 * The per-field behavioural tests are the right way to prove a field WORKS.
 * They cannot prove the NEXT field will, because a test for a field nobody has
 * written yet cannot exist. This one can: it enumerates the interface and
 * fails on any member that is neither forwarded nor explicitly declared
 * unsupported. Adding a field to the type without wiring it is now a red test
 * rather than a silent no-op discovered months later on a phone call.
 *
 * It reads source text rather than exercising the client because the property
 * being asserted IS textual — "this key is read from `options` somewhere in
 * the builder". A behavioural version would need a fixture per field, which is
 * the very thing that does not exist for a field not yet added.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const typesSrc = readFileSync(`${here}../../types/src/release.ts`, "utf8");
const clientSrc = readFileSync(`${here}../src/releases/index.ts`, "utf8");

/** Field names declared on `UpdateReleaseOptions`. */
function updateOptionFields(): string[] {
  const m = /export interface UpdateReleaseOptions\s*\{([\s\S]*?)\n\}/.exec(typesSrc);
  if (!m) throw new Error("UpdateReleaseOptions not found in @divinci-ai/types release.ts");
  // Two-space indent = a member of this interface; deeper nesting belongs to an
  // inline object type and is not a field of its own.
  return [...new Set([...m[1].matchAll(/^ {2}(\w+)\??:/gm)].map((x) => x[1]))];
}

describe("UpdateReleaseOptions ↔ updateInWorkspace", () => {
  it("declares at least the fields we know shipped inert once", () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuously pass.
    const fields = updateOptionFields();
    expect(fields.length).toBeGreaterThan(20);
    expect(fields).toEqual(expect.arrayContaining([
      "skillConfig", "voiceTransport", "ttsToolOverride", "ttsVoiceOverride",
    ]));
  });

  it("forwards every field, or names it unsupported — nothing in between", () => {
    const unforwarded = new Set<string>(UNFORWARDED_UPDATE_FIELDS);
    const dropped = updateOptionFields().filter((f) => {
      if (unforwarded.has(f)) return false;
      return !new RegExp(`options\\.${f}\\b`).test(clientSrc);
    });
    expect(dropped, [
      "These UpdateReleaseOptions fields are never read from `options` in",
      "updateInWorkspace, so a caller who sets one gets a 200 and no change —",
      "the --catalog-skills / --voice-transport bug again.",
      "Either forward the field in the body (after the `current.*`",
      "carry-forward spread, so an explicit value BEATS the stored one), or",
      "add it to UNFORWARDED_UPDATE_FIELDS so the client throws instead.",
    ].join(" ")).toEqual([]);
  });

  it("keeps UNFORWARDED_UPDATE_FIELDS honest — every entry is a real field", () => {
    // The escape hatch must not become a place where a field that IS wired
    // sits and gets skipped by the check above.
    const fields = new Set(updateOptionFields());
    for (const f of UNFORWARDED_UPDATE_FIELDS) {
      expect(fields.has(f), `${f} is listed unsupported but is not a field of UpdateReleaseOptions`).toBe(true);
      expect(
        new RegExp(`options\\.${f}\\b`).test(clientSrc),
        `${f} is listed unsupported but the builder does read options.${f} — remove it from the list`,
      ).toBe(false);
    }
  });
});
