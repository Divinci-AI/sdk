/**
 * External Tools Client — the third-party RAG ecosystem.
 *
 * A workspace registers an HTTPS endpoint it controls as either a document
 * PARSER (`RAG/Chunker` — raw file in, NDJSON chunks out, once per file) or a
 * search backend (`RAG/Retriever` — JSON query in, JSON results out, on EVERY
 * chat turn against a vector that selected it). Divinci never hosts the code;
 * it only calls the endpoint.
 *
 * Wire paths verified against the whitelabel external-tools router
 * (`/white-label/:whitelabelId/external-tools/*`) on 2026-09-07.
 *
 * ⚠️ THE CREDENTIAL IS WRITE-ONLY. `authSecret` may be sent on create/update
 * and is NEVER returned by any read path — a view carries `hasAuth: boolean`
 * instead. Do not build anything that expects to read it back.
 *
 * ⚠️ EVERY EXTERNAL TOOL IS FREE (decided 2026-09-07). `pricing` is still
 * accepted so existing registrations keep working, but the declared rate is
 * NOT billed to anyone. Do not present it to a vendor as revenue.
 */

import { ServerHttpClient } from "../http-client.js";

export type ExternalToolType = "RAG/Chunker" | "RAG/Retriever";
export type ExternalToolAuthType = "none" | "bearer" | "header";

/** A registered tool as the API returns it — never carries the credential. */
export interface ExternalTool {
  id: string;
  /** `ext:<workspaceId>:<slug>` — the id used wherever a tool is selected. */
  toolId: string;
  whitelabelId: string;
  toolType: ExternalToolType;
  /** Immutable: the tool id derives from it. */
  slug: string;
  title: string;
  description?: string;
  vendorName?: string;
  vendorUrl?: string;
  endpointUrl: string;
  authType: ExternalToolAuthType;
  authHeaderName?: string;
  /** Whether a credential is stored. The credential itself is never returned. */
  hasAuth: boolean;
  /**
   * Opaque per-registration identifier sent to the vendor as `tenant`.
   * Deliberately NOT the workspace id — a vendor should not learn that.
   */
  tenantToken: string;
  enabled: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Last stored probe verdict. `status` is "unknown" until health-checked. */
  health?: { status: string, checkedAt?: number, detail?: string };
  /** Live circuit-breaker state, when the shared store could be read. */
  circuit?: { open: boolean, failures: number, retryAfterMs?: number };
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateExternalToolInput {
  toolType: ExternalToolType;
  slug: string;
  title: string;
  endpointUrl: string;
  description?: string;
  vendorName?: string;
  vendorUrl?: string;
  authType?: ExternalToolAuthType;
  /** Write-only. Required when authType is "bearer" or "header". */
  authSecret?: string;
  authHeaderName?: string;
  /** Clamped to the ceiling FOR THE TOOL TYPE — a tool may lower, never raise. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  enabled?: boolean;
}

export type UpdateExternalToolInput = Partial<
  Omit<CreateExternalToolInput, "toolType" | "slug">
>;

export class ExternalToolsClient {
  constructor(private httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/external-tools`;
  }

  /** Every tool registered by this workspace. Credentials are never included. */
  async list(workspaceId: string): Promise<ExternalTool[]> {
    return this.httpClient.get<ExternalTool[]>(this.base(workspaceId));
  }

  /** One registered tool by its Mongo id (not the `ext:` toolId). */
  async get(workspaceId: string, externalToolId: string): Promise<ExternalTool> {
    return this.httpClient.get<ExternalTool>(`${this.base(workspaceId)}/${externalToolId}`);
  }

  /**
   * Register a tool.
   *
   * The endpoint must be publicly resolvable — registration refuses a host that
   * does not resolve, rather than accepting it and failing silently later.
   */
  async create(workspaceId: string, input: CreateExternalToolInput): Promise<ExternalTool> {
    return this.httpClient.post<ExternalTool>(this.base(workspaceId), input);
  }

  /** Update a registration. `toolType` and `slug` are immutable. */
  async update(
    workspaceId: string,
    externalToolId: string,
    input: UpdateExternalToolInput
  ): Promise<ExternalTool> {
    return this.httpClient.patch<ExternalTool>(
      `${this.base(workspaceId)}/${externalToolId}`,
      input
    );
  }

  /**
   * Probe the vendor and store the verdict.
   *
   * Sends a fixed synthetic request — never customer data — and requires a
   * CONTRACT-CONFORMING answer, so it catches a wrong path, a rejected
   * credential and a broken response shape, not merely whether the host is up.
   */
  async healthCheck(workspaceId: string, externalToolId: string): Promise<ExternalTool> {
    return this.httpClient.post<ExternalTool>(
      `${this.base(workspaceId)}/${externalToolId}/health-check`,
      {}
    );
  }

  /** Delete a registration. Vectors still pointing at it will retrieve nothing. */
  async delete(workspaceId: string, externalToolId: string): Promise<{ success: boolean }> {
    return this.httpClient.delete<{ success: boolean }>(
      `${this.base(workspaceId)}/${externalToolId}`
    );
  }
}
