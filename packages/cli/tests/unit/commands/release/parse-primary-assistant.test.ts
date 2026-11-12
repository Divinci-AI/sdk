import { describe, it, expect } from "vitest";
import { parsePrimaryAssistant } from "../../../../src/commands/release/update.js";

/**
 * `--assistant` sets a release's PRIMARY model. Before it existed the only way
 * to change a primary was a hand-rolled GET-merge-POST against the release
 * `/update` route — which assigns `assistant` unconditionally, so a forgotten
 * field in the echo silently wiped it. These tests pin the parse boundary.
 */
describe("parsePrimaryAssistant", () => {
  it("accepts a bare model id and defaults finetune:false", () => {
    expect(parsePrimaryAssistant("@cf/google/gemma-4-26b-a4b-it")).toEqual({
      id: "@cf/google/gemma-4-26b-a4b-it",
      finetune: false,
    });
  });

  it("trims surrounding whitespace on a bare id", () => {
    expect(parsePrimaryAssistant("  gemini-2.5-flash  ")).toEqual({
      id: "gemini-2.5-flash",
      finetune: false,
    });
  });

  it("accepts the full JSON object form", () => {
    expect(parsePrimaryAssistant('{"id":"my-tuned-model","finetune":true}')).toEqual({
      id: "my-tuned-model",
      finetune: true,
    });
  });

  it("defaults finetune to false when the JSON omits it", () => {
    expect(parsePrimaryAssistant('{"id":"gemini-2.5-flash"}')).toEqual({
      id: "gemini-2.5-flash",
      finetune: false,
    });
  });

  it("never returns finetune as undefined — the wire shape requires a boolean", () => {
    // The release-save validator branches on `value.finetune`; an undefined
    // there resolves a base assistant as if it were a fine-tune request.
    for (const raw of ["x", '{"id":"x"}', '{"id":"x","finetune":false}']) {
      expect(typeof parsePrimaryAssistant(raw).finetune).toBe("boolean");
    }
  });

  it("rejects an empty value", () => {
    expect(() => parsePrimaryAssistant("   ")).toThrow(/model id or a JSON object/);
  });

  it("rejects malformed JSON with a message naming both accepted forms", () => {
    expect(() => parsePrimaryAssistant('{"id":')).toThrow(/model id.*or JSON/s);
  });

  it("rejects JSON with no id", () => {
    expect(() => parsePrimaryAssistant('{"finetune":true}')).toThrow(/non-empty string "id"/);
  });

  it("rejects JSON with an empty id", () => {
    expect(() => parsePrimaryAssistant('{"id":""}')).toThrow(/non-empty string "id"/);
  });

  it("rejects a non-boolean finetune rather than coercing it", () => {
    // "true" (a string) coerces truthy in JS — silently turning a base model
    // into a fine-tune lookup that fails at generation time, not at parse time.
    expect(() => parsePrimaryAssistant('{"id":"x","finetune":"true"}')).toThrow(/must be a boolean/);
  });
});
