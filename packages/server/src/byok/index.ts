/**
 * BYOK (Bring Your Own Key) Client
 *
 * Server-side management of provider credentials per whitelabel.
 * Credentials are encrypted at rest and validated against the provider's
 * live endpoint before being persisted.
 */

import { ServerHttpClient } from "../http-client.js";

export interface BYOK {
  _id: string;
  target: string;
  name: string;
  providerId: string;
  available: boolean;
  keyPreview?: string;
  /** providerId "openai-compatible" only: the registered /v1/chat/completions URL. Immutable. */
  customEndpoint?: string;
  /** providerId "openai-compatible" only: the model id sent to customEndpoint. Immutable. */
  customModel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BYOKListResponse {
  page: BYOK[];
  total: number;
}

export interface CreateBYOKBody {
  name: string;
  providerId: string;
  auth: Record<string, unknown>;
  /**
   * providerId "openai-compatible" only (required there): your
   * /v1/chat/completions URL, https on port 443. Immutable once created.
   */
  customEndpoint?: string;
  /** providerId "openai-compatible" only (required there): the model id sent to it. Immutable. */
  customModel?: string;
}

export interface UpdateBYOKMetaBody {
  name?: string;
  available?: boolean;
}

export interface RotateBYOKAuthBody {
  auth: Record<string, unknown>;
}

/**
 * Outcome of the fixed endpoint probe (openai-compatible keys only). Never
 * carries the reply text or the upstream body. `kind` names the failure:
 * "auth" (401/403), "rate-limited", "timeout", "redirect" (never followed),
 * "too-large", "bad-shape" (no assistant text), "upstream" (other non-2xx),
 * "network", "ssrf-blocked" (private/reserved address) or "config".
 */
export type BYOKEndpointTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; kind: string; status?: number; latencyMs: number };

export class BYOKClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** Create a new BYOK record. Auth is validated against the provider before save. */
  async create(workspaceId: string, body: CreateBYOKBody): Promise<BYOK> {
    return this.httpClient.post<BYOK>(
      `/white-label/${workspaceId}/tools/byok/keys`,
      body,
    );
  }

  /** List BYOK records, optionally filtered by provider id. */
  async list(
    workspaceId: string,
    filters: { providerId?: string; available?: boolean } = {},
  ): Promise<BYOKListResponse> {
    return this.httpClient.get<BYOKListResponse>(
      `/white-label/${workspaceId}/tools/byok/keys`,
      {
        providerId: filters.providerId,
        available: filters.available,
      },
    );
  }

  /** Get a single BYOK record by id. */
  async get(workspaceId: string, keyId: string): Promise<BYOK> {
    return this.httpClient.get<BYOK>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(keyId)}`,
    );
  }

  /** Update name / available flag (does NOT rotate auth — use rotate() for that). */
  async update(
    workspaceId: string,
    keyId: string,
    body: UpdateBYOKMetaBody,
  ): Promise<BYOK> {
    return this.httpClient.patch<BYOK>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(keyId)}`,
      body,
    );
  }

  /**
   * Rotate the encrypted credentials in place on an existing BYOK record.
   * Validated against the provider's BYOK schema + a live validateAuth() call
   * before persisting. RAG vectors and other consumers continue to reference
   * the same BYOK id; no caller needs to be re-pointed.
   */
  async rotate(
    workspaceId: string,
    keyId: string,
    body: RotateBYOKAuthBody,
  ): Promise<BYOK> {
    return this.httpClient.patch<BYOK>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(keyId)}/auth`,
      body,
    );
  }

  /**
   * Probe an openai-compatible key's endpoint: one fixed request through the
   * same path a TrustBench run uses, so "can Divinci reach my endpoint with
   * this token?" is answered before a run spends a quota slot. Rate-limited
   * (10/min per key and per workspace); answers 429 with Retry-After beyond that.
   */
  async test(workspaceId: string, keyId: string): Promise<BYOKEndpointTestResult> {
    return this.httpClient.post<BYOKEndpointTestResult>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(keyId)}/test`,
      {},
    );
  }

  /** Delete a BYOK record. */
  async delete(workspaceId: string, keyId: string): Promise<BYOK> {
    return this.httpClient.delete<BYOK>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(keyId)}`,
    );
  }
}
