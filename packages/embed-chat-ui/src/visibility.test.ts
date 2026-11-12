/**
 * The `hidden` attribute must actually hide things.
 *
 * `hidden` is not magic: it works only through the user-agent stylesheet's
 * `[hidden] { display: none }`, which ANY explicit `display` rule outranks.
 * `.da-icon-btn { display: inline-flex }` therefore made every conditionally
 * hidden header button permanently visible — the on-device bolt shipped
 * showing for every visitor while `localToggleState()` correctly returned
 * `show: false`. The attribute was set faithfully and simply had no effect.
 *
 * That bug is invisible to unit tests of the logic: `pure.test.ts` covers
 * `localToggleState()` and passed 40/40 the whole time. It is only observable
 * where CSS and the DOM meet, which is what this file tests.
 *
 * The hideable set is DERIVED from widget.ts rather than hardcoded, so a new
 * conditionally-hidden element is covered the moment it is added — a list
 * would go stale exactly when someone adds the next one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

import { STYLES } from "./styles";

const widgetSrc = readFileSync(new URL("./widget.ts", import.meta.url), "utf8");

/** `const foo = document.getElementById("da-foo")` → foo → "da-foo". */
function elementIdsByVar(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*document\.getElementById\(\s*"([\w-]+)"\s*\)/g;
  for (const m of src.matchAll(re)) map.set(m[1], m[2]);
  return map;
}

/** Every variable the widget ever assigns `.hidden` on. */
function varsAssignedHidden(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(\w+)\.hidden\s*=/g)) out.add(m[1]);
  return out;
}

/** The tag name and class list the markup gives an element id. */
function markupFor(src: string, id: string): { tag: string; classes: string[] } | null {
  const tagRe = new RegExp(`<(\\w+)([^>]*\\bid="${id}"[^>]*)>`);
  const m = src.match(tagRe);
  if (!m) return null;
  const classAttr = m[2].match(/\bclass="([^"]*)"/);
  return { tag: m[1], classes: classAttr ? classAttr[1].split(/\s+/).filter(Boolean) : [] };
}

const idsByVar = elementIdsByVar(widgetSrc);
const hiddenVars = varsAssignedHidden(widgetSrc);
const hideableIds = [...hiddenVars]
  .map((v) => idsByVar.get(v))
  .filter((id): id is string => Boolean(id))
  .sort();

describe("derivation", () => {
  it("finds the elements the widget hides", () => {
    // Without this, a broken regex would make every case below vacuously
    // pass — a green suite proving nothing at all.
    expect(hideableIds.length).toBeGreaterThanOrEqual(5);
    // The two that shipped broken, pinned by name.
    expect(hideableIds).toContain("da-local-toggle");
    expect(hideableIds).toContain("da-launcher");
  });

  it("resolves each one to real markup", () => {
    for (const id of hideableIds) expect(markupFor(widgetSrc, id), id).not.toBeNull();
  });
});

describe("hidden actually hides", () => {
  // One document, reused: building a JSDOM per case is slow and buys nothing.
  const dom = new JSDOM(`<!doctype html><html><head><style>${STYLES}</style></head><body></body></html>`);
  const { document } = dom.window;

  it.each(hideableIds)("%s computes to display:none when hidden", (id) => {
    const info = markupFor(widgetSrc, id)!;
    const el = document.createElement(info.tag);
    el.id = id;
    for (const c of info.classes) el.classList.add(c);
    document.body.appendChild(el);

    // Sanity: it must be visible first, or "hidden works" would be trivially
    // true for an element that was never displayed to begin with.
    expect(dom.window.getComputedStyle(el).display, `${id} before hiding`).not.toBe("none");

    el.hidden = true;
    expect(dom.window.getComputedStyle(el).display, `${id} while hidden`).toBe("none");

    el.remove();
  });
});

describe("the stylesheet guards every class that sets display", () => {
  // The rule an author must remember: give a class an explicit `display` and
  // you have silently opted it out of `hidden`. This asserts the guard exists
  // for the classes the widget actually hides, which is where it matters.
  const hideableClasses = new Set<string>();
  for (const id of hideableIds) {
    for (const c of markupFor(widgetSrc, id)?.classes ?? []) hideableClasses.add(c);
  }

  it.each([...hideableClasses])(".%s honors [hidden] if it sets display", (cls) => {
    const setsDisplay = new RegExp(`\\.${cls}\\s*(?:,[^{]*)?\\{[^}]*display\\s*:`).test(STYLES);
    if (!setsDisplay) return; // nothing to override the UA rule — fine as is
    const guarded = new RegExp(`\\.${cls}\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none`).test(STYLES);
    expect(guarded, `.${cls} sets display but has no [hidden] guard`).toBe(true);
  });
});
