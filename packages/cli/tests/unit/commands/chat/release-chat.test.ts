import { describe, it, expect } from "vitest";
import {
  releaseEnvBody,
  extractCitations,
  formatCitations,
  isRequestTimeout,
  isStillGenerating,
  replyRequestTimeoutMs,
  assertReleaseUsable,
} from "../../../../src/commands/chat/release-chat.js";

describe("releaseEnvBody", () => {
  it("is the explicit env selector the API uses to pin one message to a whole release", () => {
    expect(releaseEnvBody("rel-1")).toEqual({ type: "release", releaseId: "rel-1" });
  });
});

describe("extractCitations", () => {
  const context = [
    { content: "Io", metadata: { originalName: "io.md", sourceUrl: "https://example.org/io", similarity: 0.63 } },
    { content: "Europa", metadata: { originalName: "europa.md", similarity: 0.55 } },
    { content: "Io again", metadata: { originalName: "io.md", similarity: 0.7 } },
  ];

  it("returns only the cited sources, with the URL the index recorded", () => {
    const out = extractCitations({ content: "x", citedSources: ["io.md"], context });
    expect(out).toEqual([{ source: "io.md", url: "https://example.org/io", similarity: 0.7 }]);
  });

  it("keeps a cited name even when no retrieved passage carries it", () => {
    expect(extractCitations({ content: "x", citedSources: ["gone.md"], context })).toEqual([{ source: "gone.md" }]);
  });

  it("falls back to the retrieved passages when nothing is named as cited", () => {
    const names = extractCitations({ content: "x", context }).map((c) => c.source);
    expect(names).toEqual(["io.md", "europa.md"]);
  });

  it("is empty for a reply with no RAG evidence, and for no reply at all", () => {
    expect(extractCitations({ content: "x" })).toEqual([]);
    expect(extractCitations(null)).toEqual([]);
  });

  it("formats numbered lines with the URL when there is one", () => {
    expect(formatCitations([{ source: "io.md", url: "https://example.org/io" }, { source: "europa.md" }]))
      .toEqual(["  [1] io.md  https://example.org/io", "  [2] europa.md"]);
  });
});

describe("isRequestTimeout", () => {
  it("recognises the SDK's timeout wording and a TimeoutError", () => {
    expect(isRequestTimeout(new Error("Request timed out after 30000ms"))).toBe(true);
    const e = new Error("slow"); e.name = "TimeoutError";
    expect(isRequestTimeout(e)).toBe(true);
  });
  it("does not swallow other failures", () => {
    expect(isRequestTimeout(new Error("HTTP 403: forbidden"))).toBe(false);
    expect(isRequestTimeout("timed out")).toBe(false);
  });
});

describe("isStillGenerating", () => {
  const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

  it("treats the client timeout as still generating", () => {
    expect(isStillGenerating(new Error("Request timed out after 120000ms"))).toBe(true);
  });
  it("treats Cloudflare / load-balancer cut-offs (502, 504, 524) as still generating", () => {
    for (const s of [502, 504, 524]) expect(isStillGenerating(withStatus(s))).toBe(true);
  });
  it("does not mistake a real answer from the API for a cut-off", () => {
    for (const s of [400, 401, 403, 404, 429, 500, 503]) expect(isStillGenerating(withStatus(s))).toBe(false);
    expect(isStillGenerating(new Error("boom"))).toBe(false);
    expect(isStillGenerating(null)).toBe(false);
    expect(isStillGenerating(undefined)).toBe(false);
    expect(isStillGenerating("524")).toBe(false);
  });
});

describe("replyRequestTimeoutMs", () => {
  it("never drops below the 120s floor, and always outlasts the wait", () => {
    expect(replyRequestTimeoutMs(0)).toBe(120_000);
    expect(replyRequestTimeoutMs(30)).toBe(120_000);
    expect(replyRequestTimeoutMs(300)).toBe(330_000);
  });
});

describe("assertReleaseUsable", () => {
  it("passes a published release without comment", () => {
    expect(assertReleaseUsable({ status: "available" }, "r", { publishedOnly: true })).toEqual({ status: "available" });
  });

  it("says the release is missing and how to find the right one", () => {
    expect(() => assertReleaseUsable(null, "r9", { publishedOnly: false }))
      .toThrow(/Release r9 not found in this workspace.*divinci release list/);
  });

  it("warns, but answers, for a draft when testing as the owner", () => {
    const out = assertReleaseUsable({ status: "draft" }, "r1", { publishedOnly: false });
    expect(out.status).toBe("draft");
    expect(out.warning).toMatch(/draft.*End users cannot reach it until it is published/);
  });

  it("refuses an unpublished release under --published-only and names the fix", () => {
    expect(() => assertReleaseUsable({ status: "draft" }, "r1", { publishedOnly: true }))
      .toThrow(/not published.*divinci release publish r1/);
    expect(() => assertReleaseUsable({ status: "deprecated" }, "r1", { publishedOnly: true }))
      .toThrow(/"deprecated", not published/);
  });
});
