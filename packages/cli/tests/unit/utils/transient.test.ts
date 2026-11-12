// Guard for notes/KNOWN-GAPS.yaml `rag-crawl-wait-dies-on-one-slow-poll-and-hides-the-list-route`.
import { describe, it, expect, vi } from "vitest";
import {
  isTransientRequestError, retryTransient, createTolerantPoller, MAX_CONSECUTIVE_SLOW_POLLS,
} from "../../../src/utils/transient.js";

const timeout = () => Object.assign(new Error("Request timed out after 30000ms"), { name: "TimeoutError", code: "TIMEOUT" });
const bad = () => Object.assign(new Error("Bad request"), { name: "ValidationError", status: 400 });

describe("isTransientRequestError", () => {
  it("recognises the client's timeout and network errors, and nothing else", () => {
    expect(isTransientRequestError(timeout())).toBe(true);
    expect(isTransientRequestError(new Error("Request timed out after 60000ms"))).toBe(true);
    expect(isTransientRequestError(new Error("Network error: fetch failed"))).toBe(true);
    expect(isTransientRequestError(bad())).toBe(false);
    expect(isTransientRequestError(new Error("boom"))).toBe(false);
    expect(isTransientRequestError(undefined)).toBe(false);
  });
});

describe("retryTransient", () => {
  it("retries a timeout and returns the later success", async () => {
    const fn = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryTransient(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry an error that would fail the same way again", async () => {
    const fn = vi.fn().mockRejectedValue(bad());
    await expect(retryTransient(fn, { sleep: async () => {} })).rejects.toThrow("Bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after its retries and rethrows the timeout", async () => {
    const fn = vi.fn().mockRejectedValue(timeout());
    await expect(retryTransient(fn, { retries: 2, sleep: async () => {} })).rejects.toThrow(/timed out/);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("createTolerantPoller", () => {
  it("turns a timeout into a missed poll instead of a thrown error", async () => {
    const seen: string[] = [];
    const poll = createTolerantPoller((e) => seen.push(e.message));
    expect(await poll(async () => { throw timeout(); })).toBeUndefined();
    expect(seen).toEqual(["Request timed out after 30000ms"]);
    expect(await poll(async () => 42)).toBe(42);
  });

  it("still throws a non-transient error at once", async () => {
    const poll = createTolerantPoller(() => {});
    await expect(poll(async () => { throw bad(); })).rejects.toThrow("Bad request");
  });

  it("ends the loop when the API stays dead, and a success resets the count", async () => {
    const poll = createTolerantPoller(() => {});
    for (let i = 0; i < MAX_CONSECUTIVE_SLOW_POLLS; i++) await poll(async () => { throw timeout(); });
    await poll(async () => "alive");
    for (let i = 0; i < MAX_CONSECUTIVE_SLOW_POLLS; i++) await poll(async () => { throw timeout(); });
    await expect(poll(async () => { throw timeout(); })).rejects.toThrow(/timed out/);
  });
});
