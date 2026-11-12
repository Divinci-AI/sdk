/**
 * `divinci qa runs get` prints each release row's timing. The run report's
 * medianLatencyMs includes every scorer's judge call, which made a ~4s answer
 * read as ~10s (a customer asked where 12-chunk retrieval spent its time, and it
 * was 0.3s). The answer and retrieval medians are printed first for that reason.
 */
import { describe, it, expect } from "vitest";
import { formatDurationMs, formatRowTiming } from "../../../../src/commands/qa/runs.js";

describe("qa runs get timing line", () => {
  it("formats sub-second as ms and the rest as seconds", () => {
    expect(formatDurationMs(281)).toBe("281ms");
    expect(formatDurationMs(4113)).toBe("4.1s");
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(Number.NaN)).toBeNull();
  });

  it("puts answer and retrieval before the scoring-inclusive time", () => {
    expect(formatRowTiming({ medianAnswerMs: 4113, medianRetrievalMs: 281, medianLatencyMs: 10031 }))
      .toBe("answer=4.1s  retrieval=281ms  with-scoring=10.0s  (medians)");
  });

  it("prints what an older run recorded, and nothing when it recorded none", () => {
    expect(formatRowTiming({ medianLatencyMs: 10031 })).toBe("with-scoring=10.0s  (medians)");
    expect(formatRowTiming({})).toBeNull();
  });
});
