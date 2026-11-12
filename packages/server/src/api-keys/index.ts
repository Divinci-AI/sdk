/**
 * API Key Client
 *
 * Server-side API key management operations
 */

import type {
  ApiKey,
  ApiKeyWithSecret,
  CreateApiKeyOptions,
  UpdateApiKeyOptions,
  ListApiKeysOptions,
  ApiKeyUsageStats,
  PaginatedResponse,
} from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

/**
 * API Key client for server-side operations
 */
export class ApiKeyClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List API keys for a workspace
   */
  async list(
    workspaceId: string,
    options: Omit<ListApiKeysOptions, "workspaceId"> = {}
  ): Promise<PaginatedResponse<ApiKey>> {
    return this.httpClient.get<PaginatedResponse<ApiKey>>(
      `/api/v1/workspaces/${workspaceId}/api-keys`,
      {
        status: options.status,
        limit: options.limit,
        cursor: options.cursor,
      }
    );
  }

  /**
   * Get an API key by ID
   */
  async get(workspaceId: string, apiKeyId: string): Promise<ApiKey> {
    return this.httpClient.get<ApiKey>(
      `/api/v1/workspaces/${workspaceId}/api-keys/${apiKeyId}`
    );
  }

  /**
   * Create a new API key
   *
   * @returns The created API key with secret. The secret is only returned once!
   */
  async create(
    options: Omit<CreateApiKeyOptions, "workspaceId"> & { workspaceId: string }
  ): Promise<ApiKeyWithSecret> {
    return this.httpClient.post<ApiKeyWithSecret>(
      `/api/v1/workspaces/${options.workspaceId}/api-keys`,
      {
        name: options.name,
        allowedOrigins: options.allowedOrigins,
        permissions: options.permissions,
        allowedTiers: options.allowedTiers,
        customTierLimits: options.customTierLimits,
        rateLimit: options.rateLimit,
        expiresAt: options.expiresAt,
        linkedApikeyId: options.linkedApikeyId,
      }
    );
  }

  /**
   * Update an API key
   */
  async update(
    workspaceId: string,
    apiKeyId: string,
    options: UpdateApiKeyOptions
  ): Promise<ApiKey> {
    return this.httpClient.patch<ApiKey>(
      `/api/v1/workspaces/${workspaceId}/api-keys/${apiKeyId}`,
      options
    );
  }

  /**
   * Revoke an API key
   */
  async revoke(workspaceId: string, apiKeyId: string): Promise<ApiKey> {
    return this.httpClient.post<ApiKey>(
      `/api/v1/workspaces/${workspaceId}/api-keys/${apiKeyId}/revoke`
    );
  }

  /**
   * Delete an API key
   */
  async delete(workspaceId: string, apiKeyId: string): Promise<void> {
    await this.httpClient.delete(
      `/api/v1/workspaces/${workspaceId}/api-keys/${apiKeyId}`
    );
  }

  /**
   * Get API key usage statistics
   */
  async getUsage(
    workspaceId: string,
    apiKeyId: string,
    period: "day" | "week" | "month" = "month"
  ): Promise<ApiKeyUsageStats> {
    return this.httpClient.get<ApiKeyUsageStats>(
      `/api/v1/workspaces/${workspaceId}/api-keys/${apiKeyId}/usage`,
      { period }
    );
  }

  /**
   * Rotate an API key (create new secret, keep same ID)
   *
   * @returns The API key with new secret. The secret is only returned once!
   */
  async rotate(workspaceId: string, apiKeyId: string): Promise<ApiKeyWithSecret> {
    // The server answers `{ newSecretKey }` (public-api routes/api-keys.ts),
    // not the `{ secret }` this method is typed to return. Unmapped, every
    // caller read `result.secret` as undefined and `divinci api-key rotate`
    // printed "undefined" after invalidating the old secret (found 2026-09-23).
    const res = await this.httpClient.post<Partial<ApiKeyWithSecret> & { newSecretKey?: string }>(
      `/api/v1/workspaces/${workspaceId}/api-keys/${apiKeyId}/rotate`
    );
    const secret = res.secret ?? res.newSecretKey;
    if (typeof secret !== "string" || secret.length === 0) {
      throw new Error("API key rotate response carried no secret; the old secret may already be invalid.");
    }
    const { newSecretKey: _dropped, ...rest } = res;
    return { ...rest, secret } as ApiKeyWithSecret;
  }

  /**
   * Validate an API key
   */
  async validate(apiKey: string): Promise<ApiKeyValidationResult> {
    return this.httpClient.post<ApiKeyValidationResult>("/api/v1/auth/validate-key", {
      apiKey,
    });
  }
}

/**
 * API key validation result
 */
export interface ApiKeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** Key status */
  status?: "active" | "revoked" | "expired";
  /** Workspace ID */
  workspaceId?: string;
  /** Key name */
  name?: string;
  /** Permissions */
  permissions?: string[];
  /** Error message if invalid */
  error?: string;
}
