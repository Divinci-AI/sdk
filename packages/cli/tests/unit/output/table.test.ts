import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chalk to avoid ANSI codes in test assertions
vi.mock("../../../src/output/colors.js", () => ({
  colors: {
    dim: (s: string) => `[dim]${s}[/dim]`,
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
    cyanBold: (s: string) => `[cyanBold]${s}[/cyanBold]`,
  },
}));

import { renderTable, renderKeyValue, type TableColumn } from "../../../src/output/table.js";

describe("table", () => {
  describe("renderTable", () => {
    it("returns 'No results found' for empty data", () => {
      const columns: TableColumn[] = [{ key: "id", header: "ID" }];
      const result = renderTable([], columns);

      expect(result).toBe("[dim]No results found.[/dim]");
    });

    it("renders a table with data", () => {
      const columns: TableColumn[] = [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
      ];
      const data = [
        { id: "1", name: "Alpha" },
        { id: "2", name: "Beta" },
      ];

      const result = renderTable(data, columns);

      // The result is a cli-table3 string — verify it contains our data
      expect(result).toContain("[cyanBold]ID[/cyanBold]");
      expect(result).toContain("[cyanBold]Name[/cyanBold]");
      expect(result).toContain("Alpha");
      expect(result).toContain("Beta");
      expect(result).toContain("1");
      expect(result).toContain("2");
    });

    it("uses key as header when header is not specified", () => {
      const columns: TableColumn[] = [{ key: "status" }];
      const data = [{ status: "active" }];

      const result = renderTable(data, columns);

      expect(result).toContain("[cyanBold]status[/cyanBold]");
      expect(result).toContain("active");
    });

    it("renders null/undefined values as dim dash", () => {
      const columns: TableColumn[] = [
        { key: "name" },
        { key: "desc" },
      ];
      const data = [{ name: "test", desc: null }];

      const result = renderTable(data as Record<string, unknown>[], columns);

      expect(result).toContain("[dim]-[/dim]");
    });

    it("renders undefined values as dim dash", () => {
      const columns: TableColumn[] = [{ key: "missing" }];
      const data = [{ other: "value" }];

      const result = renderTable(data, columns);

      expect(result).toContain("[dim]-[/dim]");
    });

    it("applies custom format function to values", () => {
      const columns: TableColumn[] = [
        {
          key: "count",
          header: "Count",
          format: (v: unknown) => `#${v}`,
        },
      ];
      const data = [{ count: 42 }];

      const result = renderTable(data, columns);

      expect(result).toContain("#42");
    });

    it("converts non-string values to string", () => {
      const columns: TableColumn[] = [{ key: "num" }];
      const data = [{ num: 123 }];

      const result = renderTable(data, columns);

      expect(result).toContain("123");
    });

    it("handles multiple rows", () => {
      const columns: TableColumn[] = [{ key: "id" }];
      const data = [
        { id: "row-1" },
        { id: "row-2" },
        { id: "row-3" },
      ];

      const result = renderTable(data, columns);

      expect(result).toContain("row-1");
      expect(result).toContain("row-2");
      expect(result).toContain("row-3");
    });
  });

  describe("renderKeyValue", () => {
    it("renders key-value pairs", () => {
      const data = { Name: "Widget", Status: "active" };

      const result = renderKeyValue(data);

      expect(result).toContain("[cyan]Name[/cyan]");
      expect(result).toContain("Widget");
      expect(result).toContain("[cyan]Status[/cyan]");
      expect(result).toContain("active");
    });

    it("renders null values as dim 'null'", () => {
      const data = { field: null };

      const result = renderKeyValue(data as Record<string, unknown>);

      expect(result).toContain("[dim]null[/dim]");
    });

    it("skips undefined values", () => {
      const data = { present: "yes", missing: undefined };

      const result = renderKeyValue(data);

      expect(result).toContain("present");
      expect(result).not.toContain("missing");
    });

    it("converts non-string values to string", () => {
      const data = { count: 42, active: true };

      const result = renderKeyValue(data);

      expect(result).toContain("42");
      expect(result).toContain("true");
    });

    it("handles empty object", () => {
      const result = renderKeyValue({});

      // Should be a valid table string (just borders, no data rows)
      expect(typeof result).toBe("string");
    });

    it("renders an object value's .id instead of [object Object]", () => {
      // Mirrors file2's chunkingTool shape: { id, config, authId }
      const data = {
        chunkingTool: { id: "@divinci-ai/langextract", config: { chapterAware: true }, authId: "" },
      };

      const result = renderKeyValue(data);

      expect(result).toContain("@divinci-ai/langextract");
      expect(result).not.toContain("[object Object]");
    });

    it("falls back to compact JSON for an object value with no .id", () => {
      const data = { metadata: { foo: "bar", count: 3 } };

      const result = renderKeyValue(data);

      expect(result).toContain(JSON.stringify({ foo: "bar", count: 3 }));
      expect(result).not.toContain("[object Object]");
    });

    it("renders an array value as compact JSON rather than [object Object]", () => {
      const data = { tags: ["a", "b"] };

      const result = renderKeyValue(data);

      expect(result).toContain(JSON.stringify(["a", "b"]));
    });

    it("still supports a legacy plain-string chunkingTool value", () => {
      const data = { chunkingTool: "langextract" };

      const result = renderKeyValue(data);

      expect(result).toContain("langextract");
    });
  });
});
