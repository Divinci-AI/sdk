import { describe, it, expect } from "vitest";
import { validateThemePreset, parseThemeOverride } from "../../../../src/commands/release/update.js";

/**
 * Unit tests for the CLI per-release theme-override input boundary
 * (--theme-preset / --theme-override). These shape-validate before the request
 * is sent; the server's castThemeOverride does the strict CSS-safety checks.
 */
describe("validateThemePreset", () => {
  it("accepts every allowed preset", () => {
    for (const p of ["default", "dark", "light", "high-contrast", "ocean", "forest", "sunset", "midnight", "custom"]) {
      expect(validateThemePreset(p)).toBe(p);
    }
  });

  it("rejects an unknown preset with a friendly message", () => {
    expect(() => validateThemePreset("neon")).toThrow(/--theme-preset must be one of/);
  });
});

describe("parseThemeOverride", () => {
  it("parses a valid preset-only override", () => {
    expect(parseThemeOverride('{"preset":"light"}')).toEqual({ preset: "light" });
  });

  it("passes through custom colors (server validates CSS safety)", () => {
    const out = parseThemeOverride('{"preset":"custom","colors":{"primary":"#2e7d32","primaryDark":"#1b5e20"}}');
    expect(out).toEqual({ preset: "custom", colors: { primary: "#2e7d32", primaryDark: "#1b5e20" } });
  });

  it("rejects invalid JSON with a friendly message", () => {
    expect(() => parseThemeOverride("{preset:light}")).toThrow(/--theme-override must be valid JSON/);
  });

  it("rejects a non-object (array / scalar)", () => {
    expect(() => parseThemeOverride('["light"]')).toThrow(/--theme-override must be a JSON object/);
    expect(() => parseThemeOverride('"light"')).toThrow(/--theme-override must be a JSON object/);
  });

  it("rejects a missing/invalid preset", () => {
    expect(() => parseThemeOverride('{"colors":{"primary":"#fff"}}')).toThrow(/--theme-override.preset must be one of/);
    expect(() => parseThemeOverride('{"preset":"neon"}')).toThrow(/--theme-override.preset must be one of/);
  });
});
