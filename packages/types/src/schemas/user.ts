/**
 * User Zod schemas
 */

import { z } from "zod";
import { ObjectIdSchema, ISODateStringSchema } from "./common.js";

/**
 * Membership tier levels
 */
export const MembershipTierSchema = z.enum([
  "free",
  "basic",
  "premium",
  "enterprise",
  "unlimited",
]);

/**
 * User metadata
 */
export const UserMetadataSchema = z.object({
  /** Last login timestamp */
  lastLogin: ISODateStringSchema.optional(),
  /** Login count */
  loginCount: z.number().int().nonnegative().optional(),
  /** Preferred locale */
  locale: z.string().optional(),
  /** Timezone */
  timezone: z.string().optional(),
});

/**
 * User profile
 */
export const UserSchema = z.object({
  /** User ID */
  id: ObjectIdSchema,
  /** Email address */
  email: z.string().email().optional(),
  /** Display name */
  name: z.string().optional(),
  /** Nickname */
  nickname: z.string().optional(),
  /** Profile picture URL */
  picture: z.string().url().optional(),
  /** Email verified */
  emailVerified: z.boolean().optional(),
  /** User metadata */
  metadata: UserMetadataSchema.optional(),
});

/**
 * API key user (external user authenticated via API key)
 */
export const ApiKeyUserSchema = z.object({
  /** API key user ID */
  id: ObjectIdSchema,
  /** API key ID this user belongs to */
  apiKeyId: ObjectIdSchema,
  /** External user ID (from customer's system) */
  externalUserId: z.string().optional(),
  /** Email */
  email: z.string().email().optional(),
  /** Nickname */
  nickname: z.string().optional(),
  /** Profile picture */
  picture: z.string().url().optional(),
  /** Membership tier */
  membershipTier: MembershipTierSchema,
  /** Last used timestamp */
  lastUsedAt: ISODateStringSchema.optional(),
  /** Created at */
  createdAt: ISODateStringSchema,
});

/**
 * Tier usage limits
 */
export const TierLimitsSchema = z.object({
  /** Messages per month */
  messagesPerMonth: z.number().int().nonnegative(),
  /** Messages per day */
  messagesPerDay: z.number().int().nonnegative(),
  /** Max tokens per message */
  maxTokensPerMessage: z.number().int().positive(),
  /** Max concurrent chats */
  maxConcurrentChats: z.number().int().positive(),
});

/**
 * Tier configuration
 */
export const TierConfigSchema = z.object({
  /** Tier name */
  tier: MembershipTierSchema,
  /** Tier limits */
  limits: TierLimitsSchema,
});

/**
 * Quota status
 */
export const QuotaStatusSchema = z.object({
  /** Current tier */
  tier: MembershipTierSchema,
  /** Usage counts */
  usage: z.object({
    messagesThisMonth: z.number().int().nonnegative(),
    messagesToday: z.number().int().nonnegative(),
  }),
  /** Remaining */
  remaining: z.object({
    messagesThisMonth: z.number().int(),
    messagesToday: z.number().int(),
  }),
  /** Whether quota is exceeded */
  exceeded: z.boolean(),
});

// Type exports using z.infer
export type MembershipTier = z.infer<typeof MembershipTierSchema>;
export type UserMetadata = z.infer<typeof UserMetadataSchema>;
export type User = z.infer<typeof UserSchema>;
export type ApiKeyUser = z.infer<typeof ApiKeyUserSchema>;
export type TierLimits = z.infer<typeof TierLimitsSchema>;
export type TierConfig = z.infer<typeof TierConfigSchema>;
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;
