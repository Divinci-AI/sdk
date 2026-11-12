/**
 * safe-text — escaping for text this CLI did not author.
 *
 * The threat is not hypothetical-only: a RAG document's `title` is the <title>
 * of a crawled web page, and `divinci rag files` renders it into a table.
 */
import { describe, expect, it } from "vitest";
import { safeLabel, stripControlChars } from "../../../src/output/safe-text";
import { renderTable } from "../../../src/output/table";

describe("stripControlChars", () => {
  it("removes ESC, so a crawled title cannot drive the terminal", () => {
    // ESC[2J = erase display, ESC[1;1H = cursor home. Together they let a
    // title blank the screen and rewrite what was printed above it.
    const evil = "Docs" + "\u001B" + "[2J" + "\u001B" + "[1;1H" + "Total: 0 errors";
    const out = stripControlChars(evil);
    expect(out).not.toContain("\u001B");
    expect(out).toBe("Docs[2J[1;1HTotal: 0 errors");
  });

  it("removes NUL and newline, which corrupt table layout", () => {
    expect(stripControlChars("a" + "\u0000" + "b")).toBe("ab");
    expect(stripControlChars("row1" + "\n" + "row2")).toBe("row1row2");
  });

  it("keeps all printable Unicode", () => {
    // Mangling legitimate titles to defend a terminal is a bad trade.
    const s = "Weights & Biases — 日本語 — café — 100% ✓";
    expect(stripControlChars(s)).toBe(s);
  });
});

describe("safeLabel", () => {
  it("caps length so later columns stay on screen", () => {
    expect(safeLabel("x".repeat(500)).length).toBe(120);
    expect(safeLabel("x".repeat(500), 20).length).toBe(20);
  });

  it("leaves short text untouched", () => {
    expect(safeLabel("B2 — docs.wandb.ai corpus")).toBe("B2 — docs.wandb.ai corpus");
  });

  it("handles null/undefined without printing them", () => {
    expect(safeLabel(undefined)).toBe("");
    expect(safeLabel(null)).toBe("");
  });
});

describe("renderTable applies it to DATA but not to our own colours", () => {
  it("strips control bytes from a cell value", () => {
    const out = renderTable(
      [{ title: "Evil" + "\u001B" + "[2JPage" }],
      [{ key: "title", header: "Title" }],
    );
    expect(out).toContain("Evil[2JPage");
  });

  it("does NOT strip a col.format() result, which is OURS to colour", () => {
    // The regression this guards: applying the strip to the assembled line, or
    // after formatting, would silently kill colour across every command. A
    // format function is caller-authored, so its escapes must survive.
    const out = renderTable(
      [{ title: "plain" }],
      [{ key: "title", header: "Title", format: (v) => "\u001B" + "[31m" + String(v) + "\u001B" + "[39m" }],
    );
    expect(out).toContain("\u001B");
  });
});
