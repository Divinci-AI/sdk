import { describe, it, expect } from "vitest";
import { getAssistantPageConfig } from "./assistant-page-context";

describe("getAssistantPageConfig", () => {
  it("matches the leading section regardless of sub-path or trailing slash", () => {
    expect(getAssistantPageConfig("/cli")?.suggestions[0].label).toBe("Install the CLI");
    expect(getAssistantPageConfig("/cli/overview/")?.suggestions[0].label).toBe("Install the CLI");
    expect(getAssistantPageConfig("/cli/reference/chat")?.context).toMatch(/Divinci CLI/i);
  });

  it("resolves each wired SDK section to its own config", () => {
    expect(getAssistantPageConfig("/client/overview/")?.context).toMatch(/Client SDK/i);
    expect(getAssistantPageConfig("/server/rag/")?.context).toMatch(/Server SDK/i);
    expect(getAssistantPageConfig("/mcp/payments/")?.context).toMatch(/Model Context Protocol/i);
    expect(getAssistantPageConfig("/embed/reference/")?.context).toMatch(/embed script/i);
  });

  it("covers the entry-point sections, which take the most cold traffic", () => {
    // The splash page and getting-started are where first-time visitors land.
    // They were the two sections with no starters and no context at all, so a
    // cold visitor got the least help exactly where they needed the most.
    expect(getAssistantPageConfig("/")?.context).toMatch(/home page/i);
    expect(getAssistantPageConfig("")?.context).toMatch(/home page/i);
    expect(getAssistantPageConfig("/getting-started/introduction/")?.context).toMatch(
      /getting-started/i,
    );
    expect(getAssistantPageConfig("/guides/models/")?.context).toMatch(/guides/i);
    expect(getAssistantPageConfig("/reference/types/")?.context).toMatch(/type reference/i);
  });

  it("returns null only for sections that genuinely do not exist", () => {
    expect(getAssistantPageConfig("/totally-unknown/")).toBeNull();
  });

  it("does not partial-match a section prefix as another section", () => {
    // "/clients" must NOT resolve to the "/client" config.
    expect(getAssistantPageConfig("/clients/overview/")).toBeNull();
    expect(getAssistantPageConfig("/cli-tools/")).toBeNull();
  });

  // Every section the docs site actually publishes. A section missing from
  // this list is a section whose visitors get no starters and no context.
  const SECTIONS = [
    "/",
    "/getting-started",
    "/client",
    "/server",
    "/mcp",
    "/embed",
    "/cli",
    "/guides",
    "/reference",
  ];

  it.each(SECTIONS)("every %s config is well-formed (3-4 non-empty starters + context)", (path) => {
    const cfg = getAssistantPageConfig(path);
    expect(cfg).not.toBeNull();
    // Chips wrap badly past four, and one or two reads as an afterthought.
    expect(cfg!.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(cfg!.suggestions.length).toBeLessThanOrEqual(4);
    for (const s of cfg!.suggestions) {
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.message.trim().length).toBeGreaterThan(0);
      // Starter messages should be full questions, not one-word labels.
      expect(s.message.length).toBeGreaterThan(s.label.length);
    }
    expect(cfg!.context.trim().length).toBeGreaterThan(40);
    // The hidden context must not carry the widget's reserved sentinel tokens.
    expect(cfg!.context).not.toContain("DIVINCI_PAGE_CONTEXT");
  });

  it("keeps starter labels unique within a section", () => {
    for (const path of SECTIONS) {
      const labels = getAssistantPageConfig(path)!.suggestions.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
