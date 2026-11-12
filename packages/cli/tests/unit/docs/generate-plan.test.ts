import { describe, it, expect } from "vitest";
import {
  slugForPath, titleForPage, withFrontmatter, buildSitePlan, applyPlaceholders,
} from "../../../src/commands/docs/generate-plan.js";

describe("slugForPath", () => {
  it("maps README to index and strips docs/ + extension", () => {
    expect(slugForPath("README.md")).toBe("index");
    expect(slugForPath("docs/cli.md")).toBe("cli");
    expect(slugForPath("docs/Guides/Quick Start.mdx")).toBe("guides/quick-start");
  });
  it("collapses a nested index.md to its directory (Starlight slug)", () => {
    expect(slugForPath("docs/audits/walk-path-audit/index.md")).toBe("audits/walk-path-audit");
    expect(slugForPath("docs/guides/index.mdx")).toBe("guides");
  });
});

describe("titleForPage", () => {
  it("prefers the first H1, else humanizes the filename", () => {
    expect(titleForPage("# Real Title\n\nbody", "docs/x.md")).toBe("Real Title");
    expect(titleForPage("no heading", "docs/weight-extraction.md")).toBe("Weight Extraction");
    expect(titleForPage("no heading", "README.md")).toBe("Overview");
  });
});

describe("withFrontmatter", () => {
  it("adds title frontmatter and drops a duplicate leading H1", () => {
    const out = withFrontmatter("# Title\n\nbody", "Title");
    expect(out.startsWith('---\ntitle: "Title"\n---')).toBe(true);
    expect(out).not.toContain("# Title");
    expect(out).toContain("body");
  });
  it("leaves existing frontmatter untouched", () => {
    const src = "---\ntitle: Keep\n---\n\nbody";
    expect(withFrontmatter(src, "Other")).toBe(src);
  });
});

describe("buildSitePlan", () => {
  const base = {
    projectName: "Larql", description: "A thing", githubUrl: "https://github.com/x/larql",
    siteUrl: "https://e.com", workerName: "larql-docs", assistantTitle: "Ask Larql",
    greeting: "hi", placeholder: "ask", webAppUrl: "", intro: "intro",
    defaultBranch: "main", sourceGlob: "docs/**",
  };
  it("writes index from README, groups docs pages, and fills placeholders", () => {
    const plan = buildSitePlan({
      ...base,
      pages: [
        { relPath: "README.md", body: "# Larql\n\nwelcome" },
        { relPath: "docs/cli.md", body: "# CLI\n\nusage" },
        { relPath: "docs/guides/start.md", body: "# Start\n\ngo" },
      ],
    });
    const paths = plan.contentFiles.map((f) => f.path);
    expect(paths).toContain("src/content/docs/index.md");
    expect(paths).toContain("src/content/docs/cli.md");
    expect(paths).toContain("src/content/docs/guides/start.md");
    // README is the home, not in the sidebar; "Guides" is its own group.
    const labels = plan.sidebar.map((g) => g.label).sort();
    expect(labels).toEqual(["Documentation", "Guides"]);
    expect(plan.placeholders.__DIVINCI_TITLE__).toBe("Larql");
    expect(plan.placeholders.__DIVINCI_PKG_NAME__).toBe("larql-docs");
    expect(plan.placeholders.__DIVINCI_SIDEBAR__).toContain('"slug": "cli"');
  });
});

describe("applyPlaceholders", () => {
  it("replaces known tokens and leaves unknown ones intact", () => {
    expect(applyPlaceholders('title: __DIVINCI_TITLE__ / __DIVINCI_UNKNOWN__', { __DIVINCI_TITLE__: "X" }))
      .toBe("title: X / __DIVINCI_UNKNOWN__");
  });
});
