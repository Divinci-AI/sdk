/**
 * User types
 */

import type { ObjectId, ISODateString } from "./common.js";

/**
 * User profile
 */
export interface User {
  /** User ID */
  id: ObjectId;
  /** Email address */
  email?: string;
  /** Display name */
  name?: string;
  /** Nickname */
  nickname?: string;
  /** Profile picture URL */
  picture?: string;
  /** Email verified */
  emailVerified?: boolean;
  /** User metadata */
  metadata?: UserMetadata;
}

/**
 * User metadata
 */
export interface UserMetadata {
  /** Last login timestamp */
  lastLogin?: ISODateString;
  /** Login count */
  loginCount?: number;
  /** Preferred locale */
  locale?: string;
  /** Timezone */
  timezone?: string;
}

/**
 * API key user (external user authenticated via API key)
 */
export interface ApiKeyUser {
  /** API key user ID */
  id: ObjectId;
  /** API key ID this user belongs to */
  apiKeyId: ObjectId;
  /** External user ID (from customer's system) */
  externalUserId?: string;
  /** Email */
  email?: string;
  /** Nickname */
  nickname?: string;
  /** Profile picture */
  picture?: string;
  /** Membership tier */
  membershipTier: MembershipTier;
  /** Last used timestamp */
  lastUsedAt?: ISODateString;
  /** Created at */
  createdAt: ISODateString;
}

/**
 * Membership tier levels
 */
export type MembershipTier = "free" | "basic" | "premium" | "enterprise" | "unlimited";

/**
 * Tier configuration
 */
export interface TierConfig {
  /** Tier name */
  tier: MembershipTier;
  /** Tier limits */
  limits: TierLimits;
}

/**
 * Tier usage limits
 */
export interface TierLimits {
  /** Messages per month */
  messagesPerMonth: number;
  /** Messages per day */
  messagesPerDay: number;
  /** Max tokens per message */
  maxTokensPerMessage: number;
  /** Max concurrent chats */
  maxConcurrentChats: number;
}

/**
 * Default tier limits
 */
export const DEFAULT_TIER_LIMITS: Record<MembershipTier, TierLimits> = {
  free: {
    messagesPerMonth: 100,
    messagesPerDay: 10,
    maxTokensPerMessage: 2000,
    maxConcurrentChats: 1,
  },
  basic: {
    messagesPerMonth: 500,
    messagesPerDay: 50,
    maxTokensPerMessage: 4000,
    maxConcurrentChats: 3,
  },
  premium: {
    messagesPerMonth: 2000,
    messagesPerDay: 200,
    maxTokensPerMessage: 8000,
    maxConcurrentChats: 10,
  },
  enterprise: {
    messagesPerMonth: 10000,
    messagesPerDay: 1000,
    maxTokensPerMessage: 16000,
    maxConcurrentChats: 50,
  },
  unlimited: {
    messagesPerMonth: Infinity,
    messagesPerDay: Infinity,
    maxTokensPerMessage: 32000,
    maxConcurrentChats: Infinity,
  },
};

/**
 * Quota status
 */
export interface QuotaStatus {
  /** Current tier */
  tier: MembershipTier;
  /** Usage counts */
  usage: {
    messagesThisMonth: number;
    messagesToday: number;
  };
  /** Remaining */
  remaining: {
    messagesThisMonth: number;
    messagesToday: number;
  };
  /** Whether quota is exceeded */
  exceeded: boolean;
}
