/**
 * External Tools Namespace
 *
 * Register and manage a workspace's own document parsers and retrievers —
 * tools Divinci did not write, which the ingestion path calls instead of a
 * built-in chunker, or which the chat path queries instead of a built-in
 * vector index.
 *
 * Wire paths verified against `src/api/v1/routes/external-tools.ts`. The route
 * is scoped by the API key's workspace, so no workspaceId appears in the path.
 *
 * Unlike the MCP surface, this namespace DOES accept a credential: an SDK call
 * is made by a program, so the secret never passes through a model's context.
 */

import { BaseNamespace } from "../base.js";

/**
 * Which registry a tool extends. IMMUTABLE once registered.
 *
 * - `"RAG/Chunker"` — a document parser. Receives the raw file body, answers
 *   NDJSON `{"text": "..."}` lines. Runs once per file inside an ingest job;
 *   timeout 30s by default, 120s at most.
 * - `"RAG/Retriever"` — a search backend. Receives
 *   `{ query, topK, minScore, tenant, filters, config }` as JSON and answers
 *   `{ results: [{ id, text, score, metadata? }] }`. Runs on EVERY chat turn
 *   against a vector that selected it, and its results are placed in the
 *   model's context; timeout 2s by default, 5s at most. `text` must ride
 *   inline — there is no first-party storage to hydrate a result from.
 */
export type ExternalToolType = "RAG/Chunker" | "RAG/Retriever";

export type ExternalToolAuthType = "none" | "bearer" | "header";

export interface ExternalToolPricing {
  model: "free" | "per-kb";
  /** Required when model is "per-kb". Nano-USD per KB of input. */
  nanoUsdPerKb?: number;
}

export interface ExternalToolHealth {
  status: "unknown" | "ok" | "failing";
  checkedAt?: number;
  detail?: string;
}

/**
 * Live circuit-breaker state. After five consecutive failed calls the
 * platform stops calling the endpoint for a cooldown (60s) and every call in
 * that window contributes zero results with no network I/O; one call is then
 * let through, and a success closes the circuit. A passing `healthCheck()`
 * closes it immediately. Read at request time; absent when unavailable.
 */
export interface ExternalToolCircuit {
  open: boolean;
  /** Present while open: ms until one call is let through. */
  retryAfterMs?: number;
  /** Consecutive failures on record. */
  failures: number;
}

/**
 * A registered external tool, as returned by the API.
 *
 * The credential is never present: `hasAuth` reports whether one is stored.
 */
export interface ExternalTool {
  id: string;
  /** `ext:<workspaceId>:<slug>` — the value stored on RAG documents. */
  toolId: string;
  whitelabelId: string;
  toolType: ExternalToolType;
  slug: string;
  title: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  vendorName?: string;
  vendorUrl?: string;
  endpointUrl: string;
  authType: ExternalToolAuthType;
  authHeaderName?: string;
  /** True when a credential is stored. The credential itself is never returned. */
  hasAuth: boolean;
  /** Field name -> type token ("string", "number?", "boolean[]", ...). */
  declaredConfigSchema?: Record<string, string>;
  declaredConfigDefault?: Record<string, unknown>;
  pricing: ExternalToolPricing;
  timeoutMs: number;
  maxResponseBytes: number;
  health: ExternalToolHealth;
  /** Best-effort, live. See ExternalToolCircuit. */
  circuit?: ExternalToolCircuit;
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
  [extension: string]: unknown;
}

export interface CreateExternalToolInput {
  toolType: ExternalToolType;
  /**
   * Lowercase letters, digits and hyphens, 3-40 chars.
   *
   * IMMUTABLE. `toolId` derives from (workspace, slug) and is stored on every
   * RAG document that selected this tool, so it cannot be renamed later — the
   * API refuses a slug change rather than silently ignoring it.
   */
  slug: string;
  title: string;
  description?: string;
  iconUrl?: string;
  docsUrl?: string;
  vendorName?: string;
  vendorUrl?: string;
  /**
   * https only. What it receives and must answer depends on `toolType` —
   * see {@link ExternalToolType}.
   */
  endpointUrl: string;
  authType?: ExternalToolAuthType;
  /** Write-only. Stored encrypted and never returned. */
  authSecret?: string;
  /** Required when authType is "header" (e.g. "X-Api-Key"). */
  authHeaderName?: string;
  declaredConfigSchema?: Record<string, string>;
  declaredConfigDefault?: Record<string, unknown>;
  /**
   * The tool's declared rate. ⛔ NOT CURRENTLY BILLED TO ANYONE — every
   * external tool is free (decided 2026-09-07). Accepted and stored so
   * existing registrations keep working; setting it produces no income.
   */
  pricing?: ExternalToolPricing;
  /**
   * Clamped to the ceiling for the tool's type (parser 120 000 ms, retriever
   * 5 000 ms) — a tool may lower this, never raise it.
   */
  timeoutMs?: number;
  /** Clamped to the platform ceiling. */
  maxResponseBytes?: number;
  enabled?: boolean;
}

/** `slug` and `toolType` are absent on purpose — both are immutable. */
export type UpdateExternalToolInput = Partial<Omit<CreateExternalToolInput, "toolType" | "slug">>;

export interface DeleteExternalToolResult {
  deleted: boolean;
  /** How many file documents still named this tool as their chunker at deletion time. */
  filesStillReferencing: number;
  /** How many RAG vectors still named this tool as their retriever at deletion time. */
  vectorsStillReferencing: number;
}

export class ExternalToolsNamespace extends BaseNamespace {
  private base(): string {
    return "/api/v1/external-tools";
  }

  /** List the workspace's registered external tools. Credentials are never included. */
  async list(): Promise<ExternalTool[]> {
    return this.httpClient.get<ExternalTool[]>(this.base());
  }

  /** Get one registered tool by its record id. */
  async get(externalToolId: string): Promise<ExternalTool> {
    return this.httpClient.get<ExternalTool>(
      `${this.base()}/${encodeURIComponent(externalToolId)}`,
    );
  }

  /**
   * Register an external tool.
   *
   * ⚠️ A parser endpoint will receive RAW CUSTOMER DOCUMENTS. A retriever
   * endpoint will receive every visitor's query, and whatever it returns is
   * placed in the model's context. Register only an endpoint the workspace
   * owner has approved, and prefer a vendor with a data-processing agreement
   * in place.
   */
  async create(input: CreateExternalToolInput): Promise<ExternalTool> {
    return this.httpClient.post<ExternalTool>(this.base(), input);
  }

  /**
   * Update a registered tool.
   *
   * Setting `authType: "none"` clears the stored credential. Changing
   * `endpointUrl` resets health to "unknown", because the last result described
   * a host that is no longer called.
   */
  async update(externalToolId: string, input: UpdateExternalToolInput): Promise<ExternalTool> {
    return this.httpClient.patch<ExternalTool>(
      `${this.base()}/${encodeURIComponent(externalToolId)}`,
      input,
    );
  }

  /**
   * Probe the tool and store the result.
   *
   * POSTs a fixed synthetic request through the same headers and auth the real
   * call uses, and requires a contract-conforming answer — one well-formed
   * NDJSON chunk from a parser, a JSON `results` array from a retriever — so it
   * catches a wrong path, a rejected credential and a broken response
   * contract, not just whether the host is up. No customer data is sent.
   *
   * Operator-triggered only: nothing in the ingest path calls this, so a broken
   * tool cannot become a loop of probes against a vendor's service.
   */
  async healthCheck(externalToolId: string): Promise<ExternalTool> {
    return this.httpClient.post<ExternalTool>(
      `${this.base()}/${encodeURIComponent(externalToolId)}/health-check`,
      {},
    );
  }

  /**
   * Delete a registered tool.
   *
   * Refuses while file documents still reference a parser (reindex replays the
   * stored chunker id) or RAG vectors still reference a retriever (every chat
   * turn resolves it). Pass `{ force: true }` to delete anyway — those files'
   * reindex will fail, and those vectors will answer nothing from the next turn
   * on. Disabling (`update(id, { enabled: false })`) stops new use without
   * breaking what exists, and is usually what you want.
   */
  async delete(
    externalToolId: string,
    options: { force?: boolean } = {},
  ): Promise<DeleteExternalToolResult> {
    const query = options.force ? "?force=true" : "";
    return this.httpClient.delete<DeleteExternalToolResult>(
      `${this.base()}/${encodeURIComponent(externalToolId)}${query}`,
    );
  }
}
