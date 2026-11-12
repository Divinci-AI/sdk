/**
 * API Keys Namespace
 *
 * Handles workspace API key management.
 */

import { BaseNamespace } from "../base.js";

/**
 * API Key document
 */
export interface ApiKeyDoc {
  _id: string;
  whitelabelId: string;
  name: string;
  description?: string;
  prefix: string;
  permissions: ApiKeyPermissions;
  rateLimit?: ApiKeyRateLimit;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * API Key permissions
 */
export interface ApiKeyPermissions {
  chat?: boolean;
  rag?: boolean;
  audio?: boolean;
  fineTune?: boolean;
  admin?: boolean;
}

/**
 * API Key rate limit
 */
export interface ApiKeyRateLimit {
  requestsPerMinute?: number;
  requestsPerDay?: number;
}

/**
 * Create API key body
 */
export interface CreateApiKeyBody {
  name: string;
  description?: string;
  permissions?: ApiKeyPermissions;
  rateLimit?: ApiKeyRateLimit;
  expiresAt?: string;
  /**
   * Share this key's user identity pool with an existing active key on the
   * same workspace — a customer authenticating through either key is treated
   * as the same person (same tier, usage, chat history). Only settable at
   * creation.
   */
  linkedApikeyId?: string;
}

/**
 * Update API key body
 */
export interface UpdateApiKeyBody {
  name?: string;
  description?: string;
  permissions?: ApiKeyPermissions;
  rateLimit?: ApiKeyRateLimit;
  expiresAt?: string;
}

/**
 * Created API key response (includes secret key)
 */
export interface CreatedApiKeyResponse extends ApiKeyDoc {
  secretKey: string;
}

/**
 * Rotate API key response
 */
export interface RotateApiKeyResponse {
  newSecretKey: string;
}

/**
 * API key user
 */
export interface ApiKeyUser {
  id: string;
  externalUserId: string;
  email?: string;
  name?: string;
  lastActiveAt?: string;
  createdAt: string;
}

/**
 * API Keys Namespace
 *
 * Manages API keys for a workspace.
 *
 * @example
 * ```typescript
 * // Create an API key
 * const key = await client.apiKeys.create(
 *   { workspaceId: "ws-123" },
 *   { name: "Production Key", permissions: { chat: true, rag: true } }
 * );
 * console.log("Secret:", key.secretKey); // Only shown once!
 *
 * // List API keys
 * const keys = await client.apiKeys.list({ workspaceId: "ws-123" });
 *
 * // Rotate a key
 * const { newSecretKey } = await client.apiKeys.rotate({
 *   workspaceId: "ws-123",
 *   keyId: "key-456"
 * });
 * ```
 */
export class ApiKeyNamespace extends BaseNamespace {
  /**
   * Create a new API key
   *
   * NOTE: The secret key is only returned once at creation.
   * Make sure to store it securely.
   */
  async create(
    params: { workspaceId?: string },
    body: CreateApiKeyBody
  ): Promise<CreatedApiKeyResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<CreatedApiKeyResponse>(
      `/white-label/${workspaceId}/api-keys`,
      body
    );
  }

  /**
   * List all API keys for the workspace
   */
  async list(params: { workspaceId?: string } = {}): Promise<ApiKeyDoc[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ApiKeyDoc[]>(
      `/white-label/${workspaceId}/api-keys`
    );
  }

  /**
   * Get an API key by ID
   */
  async get(params: { workspaceId?: string; keyId: string }): Promise<ApiKeyDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ApiKeyDoc>(
      `/white-label/${workspaceId}/api-keys/${params.keyId}`
    );
  }

  /**
   * Update an API key
   */
  async update(
    params: { workspaceId?: string; keyId: string },
    body: UpdateApiKeyBody
  ): Promise<ApiKeyDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.patch<ApiKeyDoc>(
      `/white-label/${workspaceId}/api-keys/${params.keyId}`,
      body
    );
  }

  /**
   * Delete an API key
   */
  async delete(params: { workspaceId?: string; keyId: string }): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.delete(
      `/white-label/${workspaceId}/api-keys/${params.keyId}`
    );
  }

  /**
   * Rotate an API key's secret
   *
   * This generates a new secret key and invalidates the old one.
   */
  async rotate(params: { workspaceId?: string; keyId: string }): Promise<RotateApiKeyResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<RotateApiKeyResponse>(
      `/white-label/${workspaceId}/api-keys/${params.keyId}/rotate`,
      {}
    );
  }

  /**
   * List users who have used this API key
   */
  async getUsers(params: { workspaceId?: string; keyId: string }): Promise<ApiKeyUser[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ApiKeyUser[]>(
      `/white-label/${workspaceId}/api-keys/${params.keyId}/users`
    );
  }

  /**
   * Create a scoped ApiKeyNamespace with a preset workspaceId
   */
  withWorkspace(workspaceId: string): ApiKeyNamespace {
    return new ApiKeyNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
