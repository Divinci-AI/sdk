/**
 * BYOK (Bring Your Own Key) Namespace
 *
 * Manages provider credentials (Neo4j, OpenAI, Anthropic, etc.) attached to a
 * whitelabel. Credentials are encrypted at rest and validated against the
 * provider before being stored.
 */

import { BaseNamespace } from "../base.js";

export interface BYOKDoc {
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
  page: BYOKDoc[];
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

export class BYOKNamespace extends BaseNamespace {
  /** Create a new BYOK record. Auth is validated against the provider before save. */
  async create(
    params: { workspaceId?: string },
    body: CreateBYOKBody,
  ): Promise<BYOKDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<BYOKDoc>(
      `/white-label/${workspaceId}/tools/byok/keys`,
      body,
    );
  }

  /** List BYOK records, optionally filtered by provider. */
  async list(
    params: { workspaceId?: string; providerId?: string; available?: boolean } = {},
  ): Promise<BYOKListResponse> {
    const workspaceId = this.getWorkspaceId(params);
    const qs: string[] = [];
    if (params.providerId) qs.push(`providerId=${encodeURIComponent(params.providerId)}`);
    if (typeof params.available === "boolean") qs.push(`available=${params.available}`);
    const query = qs.length > 0 ? `?${qs.join("&")}` : "";
    return this.httpClient.get<BYOKListResponse>(
      `/white-label/${workspaceId}/tools/byok/keys${query}`,
    );
  }

  /** Get a single BYOK record by id. */
  async get(params: { workspaceId?: string; keyId: string }): Promise<BYOKDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<BYOKDoc>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(params.keyId)}`,
    );
  }

  /** Update name / available flag (does NOT rotate auth — use rotate() for that). */
  async update(
    params: { workspaceId?: string; keyId: string },
    body: UpdateBYOKMetaBody,
  ): Promise<BYOKDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.patch<BYOKDoc>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(params.keyId)}`,
      body,
    );
  }

  /**
   * Rotate the encrypted credentials in place on an existing BYOK record.
   * The new auth payload is validated against the provider's BYOK schema +
   * a live validateAuth() call before persisting. Existing RAG vectors and
   * any other consumers continue to reference the same BYOK id; no caller
   * needs to be re-pointed.
   */
  async rotate(
    params: { workspaceId?: string; keyId: string },
    body: RotateBYOKAuthBody,
  ): Promise<BYOKDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.patch<BYOKDoc>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(params.keyId)}/auth`,
      body,
    );
  }

  /**
   * Probe an openai-compatible key's endpoint: one fixed request through the
   * same path a TrustBench run uses, so "can Divinci reach my endpoint with
   * this token?" is answered before a run spends a quota slot. Rate-limited
   * (10/min per key and per workspace); answers 429 with Retry-After beyond that.
   */
  async test(params: { workspaceId?: string; keyId: string }): Promise<BYOKEndpointTestResult> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<BYOKEndpointTestResult>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(params.keyId)}/test`,
      {},
    );
  }

  /** Delete a BYOK record. */
  async delete(params: { workspaceId?: string; keyId: string }): Promise<BYOKDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.delete<BYOKDoc>(
      `/white-label/${workspaceId}/tools/byok/keys/${encodeURIComponent(params.keyId)}`,
    );
  }

  withWorkspace(workspaceId: string): BYOKNamespace {
    return new BYOKNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
