/**
 * @divinci-ai/types - Zod Schemas
 *
 * Runtime-validated type schemas using Zod.
 * These schemas can be used for:
 * - Runtime validation of API responses
 * - Input validation
 * - Type inference via z.infer<typeof Schema>
 * - OpenAPI generation via zod-to-openapi
 */

// Re-export Zod for convenience
export { z } from "zod";

// Common schemas
export {
  ObjectIdSchema,
  ISODateStringSchema,
  TimestampSchema,
  HttpMethodSchema,
  PaginationOptionsSchema,
  PaginatedResponseSchema,
  DateRangeSchema,
  SortDirectionSchema,
  SortOptionsSchema,
  ResourceMetadataSchema,
  ApiResponseSchema,
  // Types
  type ObjectId,
  type ISODateString,
  type Timestamp,
  type HttpMethod,
  type PaginationOptions,
  type DateRange,
  type SortDirection,
  type SortOptions,
  type ResourceMetadata,
} from "./common.js";

// User schemas
export {
  MembershipTierSchema,
  UserMetadataSchema,
  UserSchema,
  ApiKeyUserSchema,
  TierLimitsSchema,
  TierConfigSchema,
  QuotaStatusSchema,
  // Types
  type MembershipTier,
  type UserMetadata,
  type User,
  type ApiKeyUser,
  type TierLimits,
  type TierConfig,
  type QuotaStatus,
} from "./user.js";

// Chat schemas
export {
  MessageRoleSchema,
  MessageContentTypeSchema,
  ChatVisibilitySchema,
  ChatMessageContextSchema,
  MessageReactionSchema,
  ChatMessageSchema,
  ChatThreadSchema,
  MessageAttachmentSchema,
  SendMessageOptionsSchema,
  ChatUsageSchema,
  ChatStreamChunkSchema,
  ChatResponseSchema,
  CreateChatOptionsSchema,
  ListChatsOptionsSchema,
  // Types
  type MessageRole,
  type MessageContentType,
  type ChatVisibility,
  type ChatMessageContext,
  type MessageReaction,
  type ChatMessage,
  type ChatThread,
  type MessageAttachment,
  type SendMessageOptions,
  type ChatUsage,
  type ChatStreamChunk,
  type ChatResponse,
  type CreateChatOptions,
  type ListChatsOptions,
} from "./chat.js";

// RAG schemas
export {
  RagCollectionStatusSchema,
  RagCollectionSettingsSchema,
  RagCollectionSchema,
  RagDocumentStatusSchema,
  RagDocumentSchema,
  RagChunkSchema,
  RagSearchResultSchema,
  CreateRagCollectionOptionsSchema,
  UploadDocumentOptionsSchema,
  RagSearchOptionsSchema,
  ListDocumentsOptionsSchema,
  // Types
  type RagCollectionStatus,
  type RagCollectionSettings,
  type RagCollection,
  type RagDocumentStatus,
  type RagDocument,
  type RagChunk,
  type RagSearchResult,
  type CreateRagCollectionOptions,
  type UploadDocumentOptions,
  type RagSearchOptions,
  type ListDocumentsOptions,
} from "./rag.js";

// API Key schemas
export {
  ApiKeyStatusSchema,
  ApiKeySchema,
  ApiKeyWithSecretSchema,
  CreateApiKeyOptionsSchema,
  UpdateApiKeyOptionsSchema,
  ListApiKeysOptionsSchema,
  ApiKeyUsageStatsSchema,
  // Types
  type ApiKeyStatus,
  type ApiKey,
  type ApiKeyWithSecret,
  type CreateApiKeyOptions,
  type UpdateApiKeyOptions,
  type ListApiKeysOptions,
  type ApiKeyUsageStats,
} from "./api-key.js";

// Release schemas
export {
  ReleaseStatusSchema,
  ReleaseAuthModeSchema,
  WhiteLabelReleaseAssistantSchema,
  FallbackAssistantsSchema,
  ReleaseThemeSchema,
  ReleaseConfigSchema,
  ReleaseSchema,
  CreateReleaseOptionsSchema,
  UpdateReleaseOptionsSchema,
  ListReleasesOptionsSchema,
  // Types
  type ReleaseStatus,
  type ReleaseAuthMode,
  type WhiteLabelReleaseAssistant,
  type ReleaseTheme,
  type ReleaseConfig,
  type Release,
  type CreateReleaseOptions,
  type UpdateReleaseOptions,
  type ListReleasesOptions,
} from "./release.js";

// Arena schemas
export {
  ArenaModeSchema,
  ArenaVariantSchema,
  ArenaCacheConfigSchema,
  ArenaConfigSchema,
  PipelineTimingMetricsSchema,
  ArenaInlineScoresSchema,
  ArenaResponseVariantSchema,
  ArenaStreamingStatusSchema,
  ArenaSelectBodySchema,
  ArenaSelectResponseSchema,
  ArenaRegenerateVariantBodySchema,
  ArenaPresetStatusSchema,
  ArenaPresetSchema,
  ArenaVariantResultSchema,
  ArenaResultsResponseSchema,
  // Types
  type ArenaMode,
  type ArenaVariant,
  type ArenaCacheConfig,
  type ArenaConfig,
  type PipelineTimingMetrics,
  type ArenaInlineScores,
  type ArenaResponseVariant,
  type ArenaStreamingStatus,
  type ArenaSelectBody,
  type ArenaSelectResponse,
  type ArenaRegenerateVariantBody,
  type ArenaPresetStatus,
  type ArenaPreset,
  type ArenaVariantResult,
  type ArenaResultsResponse,
} from "./arena.js";

// Error schemas
export {
  ErrorCodeSchema,
  DivinciErrorDataSchema,
  FieldValidationErrorSchema,
  ValidationErrorDetailsSchema,
  RateLimitErrorDetailsSchema,
  PaymentRequiredDetailsSchema,
  // Types
  type ErrorCode,
  type DivinciErrorData,
  type FieldValidationError,
  type ValidationErrorDetails,
  type RateLimitErrorDetails,
  type PaymentRequiredDetails,
} from "./errors.js";

// Thinking strategy schemas
export {
  ThinkingStrategyTypeSchema,
  ThinkingProviderSchema,
  ThinkingSandboxTypeSchema,
  RLMConfigSchema,
  CoTConfigSchema,
  SelfConsistencyConfigSchema,
  TreeOfThoughtsConfigSchema,
  ThinkingStrategyConfigSchema,
  ThinkingStrategyUsageSchema,
  ThinkingStrategyResultSchema,
  DEFAULT_THINKING_MODELS,
  // Types
  type ThinkingStrategyType,
  type ThinkingProvider,
  type ThinkingSandboxType,
  type RLMConfig,
  type CoTConfig,
  type SelfConsistencyConfig,
  type TreeOfThoughtsConfig,
  type ThinkingStrategyConfig,
  type ThinkingStrategyUsage,
  type ThinkingStrategyResult,
} from "./thinking-strategy.js";
