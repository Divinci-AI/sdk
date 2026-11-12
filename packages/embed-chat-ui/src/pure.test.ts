import { describe, it, expect } from "vitest";
import {
  renderMarkdown,
  renderInline,
  ipAvatarHtml,
  sourceTitle,
  sourceExcerpt,
  classifyModerationError,
  isRateLimitError,
  stripMarkdownForSpeech,
  reactionsStorageKey,
  messageReactionKey,
  toggleReaction,
  normalizeLocalPolicy,
  localToggleState,
  shouldRouteLocal,
  localFallbackAllowed,
} from "./pure";

describe("on-device routing policy", () => {
  it("normalizeLocalPolicy defaults unknown → fallback", () => {
    expect(normalizeLocalPolicy("off")).toBe("off");
    expect(normalizeLocalPolicy("prefer")).toBe("prefer");
    expect(normalizeLocalPolicy("fallback")).toBe("fallback");
    expect(normalizeLocalPolicy(undefined)).toBe("fallback");
    expect(normalizeLocalPolicy("nonsense")).toBe("fallback");
  });

  it("localToggleState hides the toggle when off or no extension", () => {
    expect(localToggleState("off", true, null)).toEqual({ show: false, on: false });
    expect(localToggleState("fallback", false, null)).toEqual({ show: false, on: false });
  });

  it("localToggleState defaults ON (local-first), stored pref wins", () => {
    expect(localToggleState("fallback", true, null)).toEqual({ show: true, on: true });
    expect(localToggleState("fallback", true, false)).toEqual({ show: true, on: false });
    expect(localToggleState("prefer", true, false)).toEqual({ show: true, on: false });
  });

  it("shouldRouteLocal gates on policy + extension + user toggle", () => {
    expect(shouldRouteLocal("off", true, true)).toBe(false);
    expect(shouldRouteLocal("fallback", false, true)).toBe(false);
    expect(shouldRouteLocal("fallback", true, false)).toBe(false);
    expect(shouldRouteLocal("fallback", true, true)).toBe(true);
    expect(shouldRouteLocal("prefer", true, true)).toBe(true);
  });

  it("localFallbackAllowed only for the fallback policy", () => {
    expect(localFallbackAllowed("fallback")).toBe(true);
    expect(localFallbackAllowed("prefer")).toBe(false);
    expect(localFallbackAllowed("off")).toBe(false);
  });
});

describe("renderInline — citations + code spans", () => {
  it("linkifies a single [N] citation as a clickable chip", () => {
    const out = renderInline("vanilla JavaScript [1].");
    expect(out).toContain('data-cite="1"');
    expect(out).toContain('class="da-cite"');
  });

  it("linkifies each number in a grouped [1, 5] citation", () => {
    const out = renderInline("custom chat experiences [1, 5].");
    expect(out).toContain('data-cite="1"');
    expect(out).toContain('data-cite="5"');
    // brackets/comma stay as plain text
    expect(out).toMatch(/\[<a[^>]*data-cite="1"[^>]*>1<\/a>, <a[^>]*data-cite="5"[^>]*>5<\/a>\]/);
  });

  it("does NOT linkify [N] inside inline code (the bug): `argv[1]` stays intact", () => {
    const out = renderInline("Run `argv[1]` then check [2].");
    expect(out).toContain("<code>argv[1]</code>"); // [1] preserved inside code
    expect(out).not.toMatch(/<code>argv\[<a/); // no chip injected into the code span
    expect(out).toContain('data-cite="2"'); // the real citation outside code still links
  });

  it("does not touch a real markdown link", () => {
    const out = renderInline('see [docs](https://x.io/a) and [3]');
    expect(out).toContain('<a href="https://x.io/a"');
    expect(out).toContain('data-cite="3"');
  });

  it("renders bold", () => {
    expect(renderInline("a **bold** b")).toContain("<strong>bold</strong>");
  });
});

describe("renderMarkdown", () => {
  it("escapes HTML (render-boundary XSS defense)", () => {
    const out = renderMarkdown("hello <img src=x onerror=alert(1)>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("clamps headings to h3–h5", () => {
    expect(renderMarkdown("# Title")).toContain("<h3>Title</h3>");
    expect(renderMarkdown("## Sub")).toContain("<h4>Sub</h4>");
    expect(renderMarkdown("###### Deep")).toContain("<h5>Deep</h5>");
  });

  it("renders ordered + unordered lists", () => {
    expect(renderMarkdown("- a\n- b")).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toContain("<ol><li>a</li><li>b</li></ol>");
  });

  it("keeps a code-span citation safe end-to-end", () => {
    const out = renderMarkdown("Install with `npm i pkg[2]` — see [2].");
    expect(out).toContain("<code>npm i pkg[2]</code>");
    expect(out).toContain('data-cite="2"');
  });
});

describe("ipAvatarHtml", () => {
  it("stacks 4 zero-padded octets for IPv4", () => {
    expect(ipAvatarHtml("1.22.3.255")).toBe(
      "<span>001</span><span>022</span><span>003</span><span>255</span>",
    );
  });
  it("stacks the last 3 hex groups (upper, ≤4 chars) for IPv6", () => {
    expect(ipAvatarHtml("2a09:bac1:76c0:b78::6d:1c")).toBe(
      "<span>B78</span><span>6D</span><span>1C</span>",
    );
  });
  it('falls back to "IP" for empty or malformed input', () => {
    expect(ipAvatarHtml("")).toContain("IP");
    expect(ipAvatarHtml("not-an-ip")).toContain("IP");
  });
});

describe("sourceTitle", () => {
  it("uses a readable metadata name + strips the extension", () => {
    expect(sourceTitle({ metadata: { originalName: "Getting Started.md" } }, 0)).toBe("Getting Started");
  });
  it("skips opaque hex ids and falls back to the first heading", () => {
    expect(
      sourceTitle({ metadata: { originalName: "6a2cf963c7b96641c117c08c" }, content: "# Real Title\nbody" }, 0),
    ).toBe("Real Title");
  });
  it("falls back to Source N when nothing readable exists", () => {
    expect(sourceTitle({}, 3)).toBe("Source 4");
  });
});

describe("sourceExcerpt", () => {
  it("strips markdown noise and trims", () => {
    expect(sourceExcerpt("# Heading\n\n**bold** and `code` and ![img](x) text")).toBe("Heading bold and code and text");
  });
  it("truncates long content with an ellipsis", () => {
    const long = "x".repeat(300);
    const out = sourceExcerpt(long);
    expect(out.length).toBe(241); // 240 + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("classifyModerationError", () => {
  it("treats a bare HTTP 400 as off-topic (widget never sends malformed requests)", () => {
    expect(classifyModerationError({ status: 400, message: "bad form data" })).toEqual({ offTopic: true, harmful: false });
  });
  it("flags harmful from the error body and does not mark it off-topic", () => {
    expect(
      classifyModerationError({ status: 400, details: { errors: [{ type: "harmful" }] } }),
    ).toEqual({ offTopic: false, harmful: true });
  });
  it("flags off-topic from the error body type", () => {
    expect(
      classifyModerationError({ status: 400, details: { errors: [{ type: "on topic" }] } }).offTopic,
    ).toBe(true);
  });
  it("does not classify a 500 / network error as a moderation block", () => {
    expect(classifyModerationError({ status: 500, message: "server error" })).toEqual({ offTopic: false, harmful: false });
  });
});

describe("isRateLimitError", () => {
  it("detects HTTP 429 by status", () => {
    expect(isRateLimitError({ status: 429, message: "nope" })).toBe(true);
  });
  it("detects the 'too many requests' message (no status)", () => {
    expect(isRateLimitError(new Error("too many requests, please try again later"))).toBe(true);
  });
  it("detects 'rate limit' and 'quota' phrasings", () => {
    expect(isRateLimitError(new Error("rate-limited"))).toBe(true);
    expect(isRateLimitError(new Error("monthly quota exceeded"))).toBe(true);
  });
  it("does NOT flag moderation / outage errors", () => {
    expect(isRateLimitError({ status: 400, message: "bad form data" })).toBe(false);
    expect(isRateLimitError({ status: 500, message: "server error" })).toBe(false);
    expect(isRateLimitError(new Error("Something went wrong"))).toBe(false);
  });
});

describe("stripMarkdownForSpeech", () => {
  it("drops emphasis, headings, list markers, and inline code", () => {
    const out = stripMarkdownForSpeech("# Title\n\n- **bold** and `code` here");
    expect(out).toBe("Title bold and code here");
  });
  it("keeps link text but drops the URL", () => {
    expect(stripMarkdownForSpeech("see [the docs](https://x.io/y)")).toBe("see the docs");
  });
  it("removes single and grouped [N] citation markers", () => {
    expect(stripMarkdownForSpeech("vanilla JS [1] and more [1, 5].")).toBe("vanilla JS and more .");
  });
  it("strips fenced code blocks entirely", () => {
    expect(stripMarkdownForSpeech("before\n```ts\nconst x = 1;\n```\nafter")).toBe("before after");
  });
  it("is safe on empty / falsy input", () => {
    expect(stripMarkdownForSpeech("")).toBe("");
  });
});

describe("reactions", () => {
  it("namespaces the storage key by releaseId", () => {
    expect(reactionsStorageKey("abc123")).toBe("divinci-docs-reactions:abc123");
  });
  it("derives a stable key from message content", () => {
    expect(messageReactionKey("hello world")).toBe(messageReactionKey("hello world"));
    expect(messageReactionKey("hello world")).not.toBe(messageReactionKey("goodbye world"));
  });
  it("toggleReaction sets a new reaction immutably", () => {
    const m = {};
    const next = toggleReaction(m, "k", "👍");
    expect(next).toEqual({ k: "👍" });
    expect(m).toEqual({}); // original untouched
  });
  it("toggleReaction clears when the same emoji is tapped again", () => {
    expect(toggleReaction({ k: "👍" }, "k", "👍")).toEqual({});
  });
  it("toggleReaction replaces a different emoji", () => {
    expect(toggleReaction({ k: "👍" }, "k", "❤️")).toEqual({ k: "❤️" });
  });
});
