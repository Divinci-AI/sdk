/**
 * API Key Zod schemas
 */

import { z } from "zod";
import { ObjectIdSchema, ISODateStringSchema } from "./common.js";
import { MembershipTierSchema, TierLimitsSchema } from "./user.js";

/**
 * API key status
 */
export const ApiKeyStatusSchema = z.enum(["active", "revoked", "expired"]);

/**
 * API Key
 */
export const ApiKeySchema = z.object({
  /** API key ID */
  id: ObjectIdSchema,
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** API key name */
  name: z.string().min(1).max(100),
  /** Key prefix (first 8 chars, for identification) */
  keyPrefix: z.string().length(8),
  /** Key status */
  status: ApiKeyStatusSchema,
  /** Allowed origins for CORS */
  allowedOrigins: z.array(z.string()),
  /** Permissions granted */
  permissions: z.array(z.string()),
  /** Allowed membership tiers */
  allowedTiers: z.array(MembershipTierSchema).optional(),
  /** Custom tier limits */
  customTierLimits: z.record(MembershipTierSchema, TierLimitsSchema.partial()).optional(),
  /** Rate limit (requests per minute) */
  rateLimit: z.number().int().positive().optional(),
  /** Last used timestamp */
  lastUsedAt: ISODateStringSchema.optional(),
  /** Expires at */
  expiresAt: ISODateStringSchema.optional(),
  /** Created at */
  createdAt: ISODateStringSchema,
});

/**
 * API key with secret (only returned on creation)
 */
export const ApiKeyWithSecretSchema = ApiKeySchema.extend({
  /** The full API key secret (only shown once) */
  secret: z.string(),
});

/**
 * Options for creating an API key
 */
export const CreateApiKeyOptionsSchema = z.object({
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** Key name */
  name: z.string().min(1).max(100),
  /** Allowed origins */
  allowedOrigins: z.array(z.string()).optional(),
  /** Permissions */
  permissions: z.array(z.string()).optional(),
  /** Allowed tiers */
  allowedTiers: z.array(MembershipTierSchema).optional(),
  /** Custom tier limits */
  customTierLimits: z.record(MembershipTierSchema, TierLimitsSchema.partial()).optional(),
  /** Rate limit */
  rateLimit: z.number().int().positive().optional(),
  /** Expiration date */
  expiresAt: ISODateStringSchema.optional(),
});

/**
 * Options for updating an API key
 */
export const UpdateApiKeyOptionsSchema = z.object({
  /** Key name */
  name: z.string().min(1).max(100).optional(),
  /** Allowed origins */
  allowedOrigins: z.array(z.string()).optional(),
  /** Permissions */
  permissions: z.array(z.string()).optional(),
  /** Allowed tiers */
  allowedTiers: z.array(MembershipTierSchema).optional(),
  /** Custom tier limits */
  customTierLimits: z.record(MembershipTierSchema, TierLimitsSchema.partial()).optional(),
  /** Rate limit */
  rateLimit: z.number().int().positive().optional(),
});

/**
 * Options for listing API keys
 */
export const ListApiKeysOptionsSchema = z.object({
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** Filter by status */
  status: ApiKeyStatusSchema.optional(),
  /** Limit results */
  limit: z.number().int().positive().max(100).optional(),
  /** Pagination cursor */
  cursor: z.string().optional(),
});

/**
 * API key usage statistics
 */
export const ApiKeyUsageStatsSchema = z.object({
  /** API key ID */
  apiKeyId: ObjectIdSchema,
  /** Period */
  period: z.enum(["day", "week", "month"]),
  /** Total requests */
  totalRequests: z.number().int().nonnegative(),
  /** Unique users */
  uniqueUsers: z.number().int().nonnegative(),
  /** Request breakdown by endpoint */
  byEndpoint: z.record(z.string(), z.number().int().nonnegative()),
  /** Request breakdown by status code */
  byStatusCode: z.record(z.string(), z.number().int().nonnegative()),
});

// Type exports using z.infer
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type ApiKeyWithSecret = z.infer<typeof ApiKeyWithSecretSchema>;
export type CreateApiKeyOptions = z.infer<typeof CreateApiKeyOptionsSchema>;
export type UpdateApiKeyOptions = z.infer<typeof UpdateApiKeyOptionsSchema>;
export type ListApiKeysOptions = z.infer<typeof ListApiKeysOptionsSchema>;
export type ApiKeyUsageStats = z.infer<typeof ApiKeyUsageStatsSchema>;
