import { describe, it, expect } from "vitest";
import { blendHex } from "../src/blend.js";

describe("blendHex", () => {
  it("returns the first color at t=0 and the second at t=1", () => {
    expect(blendHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(blendHex("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("mixes channels linearly", () => {
    expect(blendHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("tolerates missing # prefixes and falls back on short input", () => {
    expect(blendHex("000000", "ffffff", 1)).toBe("#ffffff");
    expect(blendHex("#abc", "#ffffff", 0.5)).toBe("#abc");
  });
});
