/**
 * API Key types
 */

import type { ObjectId, ISODateString } from "./common.js";
import type { MembershipTier, TierLimits } from "./user.js";

/**
 * API Key
 */
export interface ApiKey {
  /** API key ID */
  id: ObjectId;
  /** Workspace ID */
  workspaceId: ObjectId;
  /** API key name */
  name: string;
  /** Key prefix (first 8 chars, for identification) */
  keyPrefix: string;
  /** Key status */
  status: ApiKeyStatus;
  /** Allowed origins for CORS */
  allowedOrigins: string[];
  /** Permissions granted */
  permissions: string[];
  /** Allowed membership tiers */
  allowedTiers?: MembershipTier[];
  /** Custom tier limits */
  customTierLimits?: Record<MembershipTier, Partial<TierLimits>>;
  /** Rate limit (requests per minute) */
  rateLimit?: number;
  /** Last used timestamp */
  lastUsedAt?: ISODateString;
  /** Expires at */
  expiresAt?: ISODateString;
  /** Created at */
  createdAt: ISODateString;
}

/**
 * API key status
 */
export type ApiKeyStatus = "active" | "revoked" | "expired";

/**
 * API key with secret (only returned on creation)
 */
export interface ApiKeyWithSecret extends ApiKey {
  /** The full API key secret (only shown once) */
  secret: string;
}

/**
 * Options for creating an API key
 */
export interface CreateApiKeyOptions {
  /** Workspace ID */
  workspaceId: ObjectId;
  /** Key name */
  name: string;
  /** Allowed origins */
  allowedOrigins?: string[];
  /** Permissions */
  permissions?: string[];
  /** Allowed tiers */
  allowedTiers?: MembershipTier[];
  /** Custom tier limits */
  customTierLimits?: Record<MembershipTier, Partial<TierLimits>>;
  /** Rate limit */
  rateLimit?: number;
  /** Expiration date */
  expiresAt?: ISODateString;
  /**
   * Share this key's user identity pool with an existing active key on the
   * same workspace. A customer authenticating through either key is treated
   * as the same person (same tier, usage, chat history) — useful when you
   * need multiple keys (e.g. per-environment, per-integration) that should
   * never fragment a returning user's identity. Only settable at creation.
   */
  linkedApikeyId?: ObjectId;
}

/**
 * Options for updating an API key
 */
export interface UpdateApiKeyOptions {
  /** Key name */
  name?: string;
  /** Allowed origins */
  allowedOrigins?: string[];
  /** Permissions */
  permissions?: string[];
  /** Allowed tiers */
  allowedTiers?: MembershipTier[];
  /** Custom tier limits */
  customTierLimits?: Record<MembershipTier, Partial<TierLimits>>;
  /** Rate limit */
  rateLimit?: number;
}

/**
 * Options for listing API keys
 */
export interface ListApiKeysOptions {
  /** Workspace ID */
  workspaceId: ObjectId;
  /** Filter by status */
  status?: ApiKeyStatus;
  /** Limit results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * API key usage statistics
 */
export interface ApiKeyUsageStats {
  /** API key ID */
  apiKeyId: ObjectId;
  /** Period */
  period: "day" | "week" | "month";
  /** Total requests */
  totalRequests: number;
  /** Unique users */
  uniqueUsers: number;
  /** Request breakdown by endpoint */
  byEndpoint: Record<string, number>;
  /** Request breakdown by status code */
  byStatusCode: Record<string, number>;
}
