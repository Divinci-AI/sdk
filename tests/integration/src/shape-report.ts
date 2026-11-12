/**
 * Shape report — records what the live API actually returned for every
 * operation the suite exercised, so type fixes are made against evidence.
 *
 * Only key NAMES and value TYPES are recorded — never values — so the
 * report is safe to commit/share.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface ShapeEntry {
  operation: string;
  shape: unknown;
  note?: string;
}

const entries: ShapeEntry[] = [];

/** Replace values with their types, recursing one or two levels. */
export function describeShape(value: unknown, depth = 2): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length === 0
      ? "array(empty)"
      : [`array(${value.length})`, describeShape(value[0], depth)];
  }
  if (typeof value === "object") {
    if (depth <= 0) return "object";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = describeShape(v, depth - 1);
    }
    return out;
  }
  return typeof value;
}

export function record(operation: string, value: unknown, note?: string): void {
  entries.push({ operation, shape: describeShape(value), note });
}

export function flushReport(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "shape-report.json");
  writeFileSync(path, JSON.stringify(entries, null, 2));
  return path;
}
