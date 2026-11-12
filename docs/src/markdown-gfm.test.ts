import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GitHub-flavoured markdown (tables, strikethrough, autolinks) must be switched
 * on EXPLICITLY. On Astro 6.4 + Starlight 0.38 the default did not reach the MDX
 * pipeline, and every table on sdk.divinci.ai shipped as raw pipe text — which a
 * content check cannot see, because the text is all still there.
 */
describe("astro.config.mjs", () => {
  it("turns GitHub-flavoured markdown on explicitly", () => {
    const src = readFileSync(resolve(__dirname, "../astro.config.mjs"), "utf8");
    expect(src).toMatch(/markdown:\s*\{[^}]*\bgfm:\s*true\b/);
  });
});
