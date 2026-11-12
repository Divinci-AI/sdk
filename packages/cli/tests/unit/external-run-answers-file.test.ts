import { describe, it, expect } from "vitest";
import { parseAnswersFile } from "../../src/commands/qa/external-run.js";

describe("parseAnswersFile", () => {
  it("accepts a bare array", () => {
    expect(parseAnswersFile(JSON.stringify([{ testId: "t1", text: "a", latencyMs: 12 }])))
      .toEqual([{ testId: "t1", text: "a", latencyMs: 12 }]);
  });

  it("accepts { answers: [...] } and drops fields it does not know", () => {
    expect(parseAnswersFile(JSON.stringify({ answers: [{ testId: "t1", text: "a", note: "ignored" }] })))
      .toEqual([{ testId: "t1", text: "a" }]);
  });

  it("keeps an empty text so the server can record it as an error for that test", () => {
    expect(parseAnswersFile(JSON.stringify([{ testId: "t1", text: "" }]))).toEqual([{ testId: "t1", text: "" }]);
  });

  it.each([
    ["not JSON", "{nope"],
    ["empty array", "[]"],
    ["an object with no answers", "{}"],
    ["a missing testId", JSON.stringify([{ text: "a" }])],
    ["a non-string text", JSON.stringify([{ testId: "t1", text: 5 }])],
  ])("rejects %s", (_n, raw) => {
    expect(() => parseAnswersFile(raw)).toThrow();
  });

  it("names which answer is malformed", () => {
    expect(() => parseAnswersFile(JSON.stringify([{ testId: "t1", text: "a" }, { testId: 2 }]))).toThrow(/#2/);
  });
});
