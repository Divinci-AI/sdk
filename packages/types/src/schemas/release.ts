/**
 * Release Zod schemas
 */

import { z } from "zod";
import { ObjectIdSchema, ResourceMetadataSchema } from "./common.js";

/**
 * Release status
 */
export const ReleaseStatusSchema = z.enum(["draft", "active", "archived"]);

/**
 * Release authentication mode
 */
export const ReleaseAuthModeSchema = z.enum(["anonymous", "required", "optional"]);

/**
 * A reference to an AI model assistant on a release — same shape for the
 * primary `assistant` and each `fallbackAssistants` entry.
 */
export const WhiteLabelReleaseAssistantSchema = z.object({
  id: z.string().min(1),
  finetune: z.boolean(),
});

/**
 * Ordered fallback model chain. Capped to match the server-side
 * MAX_FALLBACK_ASSISTANTS guard (release/public/validate/assistant-validator).
 */
export const FallbackAssistantsSchema = z
  .array(WhiteLabelReleaseAssistantSchema)
  .max(5);

/**
 * Hex color validator
 */
const HexColorSchema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color");

/**
 * Release theme configuration
 */
export const ReleaseThemeSchema = z.object({
  /** Primary color (hex) */
  primaryColor: HexColorSchema.optional(),
  /** Secondary color (hex) */
  secondaryColor: HexColorSchema.optional(),
  /** Background color (hex) */
  backgroundColor: HexColorSchema.optional(),
  /** Text color (hex) */
  textColor: HexColorSchema.optional(),
  /** Font family */
  fontFamily: z.string().optional(),
  /** Logo URL */
  logoUrl: z.string().url().optional(),
  /** Favicon URL */
  faviconUrl: z.string().url().optional(),
  /** Dark mode enabled */
  darkMode: z.boolean().optional(),
  /** Custom CSS */
  customCss: z.string().max(50000).optional(),
});

/**
 * Release configuration
 */
export const ReleaseConfigSchema = z.object({
  /** AI model to use */
  model: z.string().optional(),
  /** System prompt */
  systemPrompt: z.string().max(10000).optional(),
  /** Max tokens per response */
  maxTokens: z.number().int().positive().max(128000).optional(),
  /** Temperature (0-2) */
  temperature: z.number().min(0).max(2).optional(),
  /** RAG collection IDs to use */
  ragCollectionIds: z.array(ObjectIdSchema).optional(),
  /** Enable context bubbles */
  contextBubbles: z.boolean().optional(),
  /** Enable product recommendations */
  productRecommendations: z.boolean().optional(),
  /** Enable help requests */
  helpRequests: z.boolean().optional(),
  /** Enable notifications */
  notifications: z.boolean().optional(),
  /** Enable metrics tracking */
  metrics: z.boolean().optional(),
  /** Welcome message */
  welcomeMessage: z.string().max(1000).optional(),
  /** Chat disclaimer */
  chatDisclaimer: z.string().max(2000).optional(),
  /** Conversation starters */
  conversationStarters: z.array(z.string().max(200)).max(10).optional(),
  /**
   * On-device routing policy for the embed widget when the visitor has the
   * Divinci Local Inference extension (window.divinci):
   *   - "off": always use the cloud release.
   *   - "fallback" (default): local-first when present + the visitor's toggle is
   *     on; cloud on local error.
   *   - "prefer": local-only when present (no cloud fallback).
   */
  localModel: z.enum(["off", "fallback", "prefer"]).optional(),
});

/**
 * A whitelabel release (deployment configuration)
 */
export const ReleaseSchema = z.object({
  /** Release ID */
  id: ObjectIdSchema,
  /** Release name */
  name: z.string().min(1).max(100),
  /** Release status */
  status: ReleaseStatusSchema,
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** Authentication mode */
  authMode: ReleaseAuthModeSchema,
  /** Release configuration */
  config: ReleaseConfigSchema,
  /** Theme configuration */
  theme: ReleaseThemeSchema.optional(),
  /** Allowed origins for CORS */
  allowedOrigins: z.array(z.string()),
  /** Ordered fallback model chain (see Release.fallbackAssistants). */
  fallbackAssistants: FallbackAssistantsSchema.optional(),
  /** Resource metadata */
  metadata: ResourceMetadataSchema,
});

/**
 * Options for creating a release
 */
export const CreateReleaseOptionsSchema = z.object({
  /** Release name */
  name: z.string().min(1).max(100),
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** Authentication mode */
  authMode: ReleaseAuthModeSchema.optional(),
  /** Release configuration */
  config: ReleaseConfigSchema.partial().optional(),
  /** Theme configuration */
  theme: ReleaseThemeSchema.partial().optional(),
  /** Allowed origins */
  allowedOrigins: z.array(z.string()).optional(),
  /** Ordered fallback model chain (see Release.fallbackAssistants). */
  fallbackAssistants: FallbackAssistantsSchema.optional(),
});

/**
 * Options for updating a release
 */
export const UpdateReleaseOptionsSchema = z.object({
  /** Release name */
  name: z.string().min(1).max(100).optional(),
  /** Release status */
  status: ReleaseStatusSchema.optional(),
  /** Authentication mode */
  authMode: ReleaseAuthModeSchema.optional(),
  /** Release configuration */
  config: ReleaseConfigSchema.partial().optional(),
  /** Theme configuration */
  theme: ReleaseThemeSchema.partial().optional(),
  /** Allowed origins */
  allowedOrigins: z.array(z.string()).optional(),
  /** Ordered fallback model chain (see Release.fallbackAssistants). */
  fallbackAssistants: FallbackAssistantsSchema.optional(),
  /**
   * Require a valid landing-page HMAC signature on anonymous-chat requests
   * for this release (see public-api verify-landing-page-hmac middleware).
   */
  requireSignedAnonymousChat: z.boolean().optional(),
  /** Whether anonymous (no-login) chat is permitted for this release. */
  allowAnonymousChat: z.boolean().optional(),
  /** Max messages per anonymous chat session. */
  maxAnonymousChatMessages: z.number().int().min(0).optional(),
  /** RAG vector indexes attached to this release (replaces the full list). */
  ragIndexes: z.array(z.object({ id: z.string() })).optional(),
  /** MCP server exposure for this release (see ReleaseMcpConfig). */
  mcpConfig: z.object({
    enabled: z.boolean(),
    exposedTools: z.array(z.string()).optional(),
    allowedScopes: z.array(z.string()).optional(),
    mcpRateLimit: z.object({
      requestsPerMinute: z.number().int().min(1),
      requestsPerDay: z.number().int().min(1),
    }).optional(),
    allowAnonymousMcp: z.boolean().optional(),
    maxSpendPerTokenCents: z.number().int().min(0).optional(),
  }).optional(),
  /**
   * Per-release cap on how many chunks survive the cross-index RAG merge-rerank
   * before reaching the LLM (per-tenant override for the global
   * RAG_RERANK_MAX_CHUNKS default). Lower = fewer prompt tokens / faster prefill,
   * at the cost of fewer grounding sources. 0 disables the trim; omit to use the
   * platform default (8).
   */
  rerankMaxChunks: z.number().int().min(0).optional(),
  /**
   * Pre-emptive RAG gate (Tier 1). mode="heuristic" skips RAG retrieval for
   * messages that don't need grounding (greetings/acks); "always" (default)
   * always retrieves. Never skips when the release requires grounding.
   */
  ragTrigger: z.object({
    mode: z.enum(["always", "heuristic"]).optional(),
    minChars: z.number().int().min(0).optional(),
    skipPatterns: z.array(z.string()).optional(),
  }).optional(),
  /** Cloudflare AI Gateway routing (gateway-routable providers only). */
  aiGateway: z.object({
    enabled: z.boolean(),
    gatewayId: z.string().optional(),
    useDefaultGateway: z.boolean().optional(),
    useWhiteLabelDefaults: z.boolean().optional(),
    customAccountId: z.string().optional(),
  }).optional(),
  /** Response-level semantic cache (skip the LLM on a repeated prompt). */
  publicResponseCache: z.object({
    enabled: z.boolean(),
    ttlSeconds: z.number().int().positive().optional(),
    similarityThreshold: z.number().min(0).max(1).optional(),
  }).nullable().optional(),
});

/**
 * Options for listing releases
 */
export const ListReleasesOptionsSchema = z.object({
  /** Filter by workspace ID */
  workspaceId: ObjectIdSchema.optional(),
  /** Filter by status */
  status: ReleaseStatusSchema.optional(),
  /** Limit results */
  limit: z.number().int().positive().max(100).optional(),
  /** Pagination cursor */
  cursor: z.string().optional(),
});

// Type exports using z.infer
export type ReleaseStatus = z.infer<typeof ReleaseStatusSchema>;
export type ReleaseAuthMode = z.infer<typeof ReleaseAuthModeSchema>;
export type WhiteLabelReleaseAssistant = z.infer<typeof WhiteLabelReleaseAssistantSchema>;
export type ReleaseTheme = z.infer<typeof ReleaseThemeSchema>;
export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type CreateReleaseOptions = z.infer<typeof CreateReleaseOptionsSchema>;
export type UpdateReleaseOptions = z.infer<typeof UpdateReleaseOptionsSchema>;
export type ListReleasesOptions = z.infer<typeof ListReleasesOptionsSchema>;
