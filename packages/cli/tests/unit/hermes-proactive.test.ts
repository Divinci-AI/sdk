/**
 * `divinci hermes proactive` — time parsing.
 *
 * Deliberately NOT a cron expression: a customer-facing cron field is a support
 * burden and lets someone type `* * * * *`. The server decides who is due, at
 * most once per local day, so the CLI only needs a wall-clock time.
 */
import { describe, it, expect } from "vitest";
import { parseAtTime, parseEvery, parsePartner, parseTranscriptId, resolveList } from "../../src/commands/hermes/proactive.js";

describe("parseAtTime", () => {
  it.each([
    ["09:00", 9, 0],
    ["9:05", 9, 5],
    ["00:00", 0, 0],
    ["23:59", 23, 59],
    ["  14:30  ", 14, 30],
  ])("parses %s", (raw, hour, minute) => {
    expect(parseAtTime(raw)).toEqual({ hour, minute });
  });

  it.each([
    ["24:00", /hour must be 0-23/],
    ["12:60", /minute must be 0-59/],
    ["9", /HH:MM/],
    ["9:5", /HH:MM/], // single-digit minute is ambiguous — reject rather than guess
    ["nine", /HH:MM/],
    ["", /HH:MM/],
  ])("rejects %j", (raw, message) => {
    expect(() => parseAtTime(raw)).toThrow(message);
  });

  it("rejects a cron expression outright", () => {
    // The mistake this format exists to prevent: someone pasting a cron string
    // and getting an agent that wakes every minute on a billed turn.
    expect(() => parseAtTime("* * * * *")).toThrow(/HH:MM/);
  });
});

/**
 * `--goal` / `--memory` append semantics.
 *
 * These exist because the opposite behaviour shipped: the flags are documented
 * as "Add … (repeatable)" and `--clear-*` exists so clearing is explicit, but
 * the handler ASSIGNED the array. On 2026-08-10 that silently destroyed six
 * goals and five memories on the production agent, hours after they were
 * written — caught only because the write was read back afterwards.
 *
 * The logic used to live inline in the command action, where nothing could
 * reach it. That is the real reason it shipped, so it is a pure function now.
 */
describe("resolveList — goals/memories merge", () => {
  it("APPENDS rather than replacing", () => {
    // The regression. Assignment semantics would return only ["c"].
    expect(resolveList(["a", "b"], ["c"], false)).toEqual(["a", "b", "c"]);
  });

  it("omits the field entirely when nothing was passed", () => {
    // undefined (omit) and [] (clear) are NOT the same to the server. Conflating
    // them is how `--at 09:00` alone would wipe an agent's goals.
    expect(resolveList(["a"], [], false)).toBeUndefined();
  });

  it("clears only on an explicit --clear", () => {
    expect(resolveList(["a", "b"], [], true)).toEqual([]);
  });

  it("clear + added means REPLACE in a single call", () => {
    // Two calls would leave a window with no goals at all, made permanent by a
    // failure on the second.
    expect(resolveList(["a", "b"], ["c"], true)).toEqual(["c"]);
  });

  it("is idempotent — re-running the same command does not duplicate", () => {
    expect(resolveList(["a"], ["a"], false)).toEqual(["a"]);
    expect(resolveList(["a"], ["  a  "], false)).toEqual(["a"]);
  });

  it("preserves existing order and appends new entries at the end", () => {
    expect(resolveList(["a", "b"], ["b", "c", "a", "d"], false)).toEqual(["a", "b", "c", "d"]);
  });

  it("handles an agent that has no goals yet", () => {
    expect(resolveList([], ["a"], false)).toEqual(["a"]);
  });
});

describe("parseEvery", () => {
  it.each([
    ["3", 3],
    ["1", 1],
    ["24", 24],
    [" 6 ", 6],
  ])("accepts %s", (raw, want) => {
    expect(parseEvery(raw as string)).toBe(want);
  });

  it.each(["daily", "off", "none", "DAILY", " Daily "])(
    "%s means back to once a day (null, not 0)",
    (raw) => {
      // null and undefined are different on the wire: null restores daily,
      // undefined leaves the cadence alone.
      expect(parseEvery(raw)).toBeNull();
    },
  );

  it.each(["0", "25", "-1", "100"])("rejects out-of-range %s", (raw) => {
    expect(() => parseEvery(raw)).toThrow(/1-24/);
  });

  it.each(["1.5", "0.5", "three", "", "3h", "*/3"])("rejects non-integer %s", (raw) => {
    // Rounding 1.5 either way would silently bill a different amount than the
    // operator typed — the server rejects it too, so failing here is honest.
    expect(() => parseEvery(raw)).toThrow();
  });
});

/**
 * `--partner` — pair two agents so each wake sees the other's recent thinking.
 *
 * The flag's whole risk is the empty string: `--partner "$KEY"` with an unset
 * shell variable must not quietly unpair a working pair.
 */
describe("parsePartner", () => {
  const KEY = "agent-0123456789abcdef01234567";

  it("accepts a well-formed agentKey", () => {
    expect(parsePartner(KEY)).toBe(KEY);
    expect(parsePartner(`  ${KEY}  `)).toBe(KEY);
  });

  it("refuses the empty string and points at --unpair", () => {
    // The failure this exists for: an unset variable expands to "", which is
    // indistinguishable from a deliberate unpair unless it is rejected.
    for (const raw of ["", "   "]) {
      expect(() => parsePartner(raw)).toThrow(/--unpair/);
    }
  });

  it("refuses anything that is not an agentKey, and says where to find one", () => {
    for (const bad of ["agent-123", "AGENT-0123456789ABCDEF01234567", "Team Hermes", "agent-zzzz"]) {
      expect(() => parsePartner(bad), `should have rejected ${bad}`).toThrow(/--partner must be/);
    }
    expect(() => parsePartner("nope")).toThrow(/divinci hermes list/);
  });
});

/**
 * `--transcript` — the shared fleet transcript.
 *
 * Same empty-string hazard as `--partner`: `--transcript "$TID"` with an unset
 * shell variable must not silently detach an agent from its fleet.
 */
describe("parseTranscriptId", () => {
  const TID = "6a78626d61cf7fc659c40d1c";

  it("accepts a transcript id", () => {
    expect(parseTranscriptId(TID)).toBe(TID);
    expect(parseTranscriptId(`  ${TID}  `)).toBe(TID);
  });

  it("refuses the empty string and points at --detach-transcript", () => {
    for (const raw of ["", "   "]) {
      expect(() => parseTranscriptId(raw)).toThrow(/--detach-transcript/);
    }
  });

  it("refuses anything that is not a 24-hex id", () => {
    for (const bad of ["nope", "6a78626d61cf7fc659c40d1", "agent-0123456789abcdef01234567"]) {
      expect(() => parseTranscriptId(bad), `should reject ${bad}`).toThrow(/24-character hex/);
    }
  });
});
