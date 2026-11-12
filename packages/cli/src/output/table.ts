import Table from "cli-table3";
import { colors } from "./colors.js";
import { safeLabel, stripControlChars } from "./safe-text.js";

export interface TableColumn {
  key: string;
  header?: string;
  width?: number;
  align?: "left" | "center" | "right";
  format?: (value: unknown) => string;
}

export function renderTable(
  data: Record<string, unknown>[],
  columns: TableColumn[]
): string {
  if (data.length === 0) {
    return colors.dim("No results found.");
  }

  const table = new Table({
    head: columns.map((col) => colors.cyanBold(col.header ?? col.key)),
    style: { head: [], border: [] },
    colWidths: columns.map((col) => col.width).filter(Boolean) as number[],
  });

  for (const row of data) {
    table.push(
      columns.map((col) => {
        const value = row[col.key];
        if (col.format) return col.format(value);
        if (value === null || value === undefined) return colors.dim("-");
        // Untrusted: a RAG title is a crawled page's <title>.
        return safeLabel(String(value), 200);
      })
    );
  }

  return table.toString();
}

export function renderKeyValue(data: Record<string, unknown>): string {
  const table = new Table({
    style: { head: [], border: [] },
  });

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    table.push({
      [colors.cyan(stripControlChars(key))]: formatKeyValueCell(value),
    });
  }

  return table.toString();
}

/**
 * Renders a single keyValue-table cell. Object values (e.g. a
 * { id, config, authId } tool-selector field) stringify to "[object Object]"
 * via plain String(value) — render the object's .id when present (the
 * human-readable identifier), otherwise fall back to compact JSON so nested
 * data is still legible instead of opaque.
 */
function formatKeyValueCell(value: unknown): string {
  if (value === null) return colors.dim("null");
  if (typeof value === "object") {
    if (!Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string") {
      return stripControlChars((value as Record<string, unknown>).id as string);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return stripControlChars(String(value));
    }
  }
  return stripControlChars(String(value));
}
