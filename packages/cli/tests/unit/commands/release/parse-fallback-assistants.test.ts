import { describe, it, expect } from "vitest";
import { parseFallbackAssistants } from "../../../../src/commands/release/update.js";

/**
 * Unit tests for the CLI --fallback-assistants parser. This is the user-input
 * boundary for the model fallback chain: it must accept well-formed JSON, reject
 * everything malformed with a friendly message, and enforce the 5-entry cap that
 * mirrors the server-side guard.
 */
describe("parseFallbackAssistants", () => {
  it("parses a well-formed array of {id, finetune}", () => {
    const out = parseFallbackAssistants(
      '[{"id":"@cf/moonshotai/kimi-k2.6","finetune":false},{"id":"ft-123","finetune":true}]',
    );
    expect(out).toEqual([
      { id: "@cf/moonshotai/kimi-k2.6", finetune: false },
      { id: "ft-123", finetune: true },
    ]);
  });

  it("returns an empty array for '[]' (the clear-the-chain case)", () => {
    expect(parseFallbackAssistants("[]")).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseFallbackAssistants("not json")).toThrow(/valid JSON/);
  });

  it("throws when the JSON is not an array", () => {
    expect(() => parseFallbackAssistants('{"id":"x","finetune":false}')).toThrow(/must be a JSON array/);
  });

  it("throws when more than 5 entries are given", () => {
    const six = JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, finetune: false })),
    );
    expect(() => parseFallbackAssistants(six)).toThrow(/at most 5/);
  });

  it("throws when an entry is missing id", () => {
    expect(() => parseFallbackAssistants('[{"finetune":false}]')).toThrow(/\[0\]/);
  });

  it("throws when an entry has a non-boolean finetune", () => {
    expect(() => parseFallbackAssistants('[{"id":"m0","finetune":"yes"}]')).toThrow(/\[0\]/);
  });

  it("throws when an entry has an empty id", () => {
    expect(() => parseFallbackAssistants('[{"id":"","finetune":false}]')).toThrow(/\[0\]/);
  });
});
