import { describe, it, expect, vi, beforeEach } from "vitest";

// ora is mocked because the property under test is invisible without a TTY:
// under vitest ora writes nothing at all, so spying on process.stdout passes
// whether or not the fix is present. Asserting the option ora is CONSTRUCTED
// with is the only form of this test that can actually fail.
const oraMock = vi.fn(() => ({
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
}));
vi.mock("ora", () => ({ default: (opts: unknown) => oraMock(opts as never) }));

describe("spinner stream", () => {
  beforeEach(() => oraMock.mockClear());

  it("is constructed against stderr, never stdout", async () => {
    // `divinci model-edits describe X --json` emitted "- Describing X" and
    // "✔ Describing X" on stdout ahead of the JSON document, so every parser
    // failed on the first byte. stdout is the data channel; progress is not
    // data. ora defaults to stdout, so this must be set explicitly.
    const { createSpinner } = await import("../../src/output/spinner");
    createSpinner("working");

    expect(oraMock).toHaveBeenCalledTimes(1);
    const opts = oraMock.mock.calls[0][0] as { stream?: unknown };
    expect(opts.stream).toBe(process.stderr);
    expect(opts.stream).not.toBe(process.stdout);
  });
});
