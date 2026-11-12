import { renderTable, renderKeyValue, type TableColumn } from "./table.js";

let jsonMode = false;
let quietMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function setOutputQuietMode(enabled: boolean): void {
  quietMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export interface OutputOptions {
  table?: {
    columns: TableColumn[];
  };
  keyValue?: boolean;
}

export function output(data: unknown, options?: OutputOptions): void {
  // --json is an explicit request for machine-readable output and must win
  // over --quiet, which only suppresses human-facing chrome. Returning early
  // for quiet+json made commands emit NOTHING, breaking scripted callers
  // (found by the demo-pipeline orchestrator dogfooding, 2026-06-10).
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (quietMode) return;

  if (options?.keyValue && data && typeof data === "object" && !Array.isArray(data)) {
    console.log(renderKeyValue(data as Record<string, unknown>));
    return;
  }

  if (options?.table && Array.isArray(data)) {
    console.log(renderTable(data as Record<string, unknown>[], options.table.columns));
    return;
  }

  if (typeof data === "string") {
    console.log(data);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

export function outputSuccess(message: string): void {
  if (!quietMode) {
    console.log(message);
  }
}

export function outputError(message: string): void {
  console.error(message);
}
