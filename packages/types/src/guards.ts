/**
 * @divinci-ai/types - Type Guards
 *
 * Runtime type guards using Zod schemas.
 * These functions allow runtime type checking with full TypeScript narrowing.
 */

import {
  ChatMessageSchema,
  ChatThreadSchema,
  ChatResponseSchema,
  ChatStreamChunkSchema,
  UserSchema,
  ApiKeyUserSchema,
  RagCollectionSchema,
  RagDocumentSchema,
  RagSearchResultSchema,
  ApiKeySchema,
  ReleaseSchema,
  DivinciErrorDataSchema,
  ArenaResponseVariantSchema,
  ArenaPresetSchema,
  ArenaConfigSchema,
  ArenaResultsResponseSchema,
} from "./schemas/index.js";

import type {
  ChatMessage,
  ChatThread,
  ChatResponse,
  ChatStreamChunk,
  User,
  ApiKeyUser,
  RagCollection,
  RagDocument,
  RagSearchResult,
  ApiKey,
  Release,
  DivinciErrorData,
  ArenaResponseVariant,
  ArenaPreset,
  ArenaConfig,
  ArenaResultsResponse,
} from "./schemas/index.js";

// ============================================
// Chat Type Guards
// ============================================

/**
 * Check if value is a ChatMessage
 */
export function isChatMessage(value: unknown): value is ChatMessage {
  return ChatMessageSchema.safeParse(value).success;
}

/**
 * Assert value is a ChatMessage (throws if invalid)
 */
export function assertChatMessage(value: unknown): asserts value is ChatMessage {
  const result = ChatMessageSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ChatMessage, got: ${result.error.message}`);
  }
}

/**
 * Check if value is a ChatThread
 */
export function isChatThread(value: unknown): value is ChatThread {
  return ChatThreadSchema.safeParse(value).success;
}

/**
 * Assert value is a ChatThread (throws if invalid)
 */
export function assertChatThread(value: unknown): asserts value is ChatThread {
  const result = ChatThreadSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ChatThread, got: ${result.error.message}`);
  }
}

/**
 * Check if value is a ChatResponse
 */
export function isChatResponse(value: unknown): value is ChatResponse {
  return ChatResponseSchema.safeParse(value).success;
}

/**
 * Assert value is a ChatResponse (throws if invalid)
 */
export function assertChatResponse(value: unknown): asserts value is ChatResponse {
  const result = ChatResponseSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ChatResponse, got: ${result.error.message}`);
  }
}

/**
 * Check if value is a ChatStreamChunk
 */
export function isChatStreamChunk(value: unknown): value is ChatStreamChunk {
  return ChatStreamChunkSchema.safeParse(value).success;
}

/**
 * Assert value is a ChatStreamChunk (throws if invalid)
 */
export function assertChatStreamChunk(value: unknown): asserts value is ChatStreamChunk {
  const result = ChatStreamChunkSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ChatStreamChunk, got: ${result.error.message}`);
  }
}

// ============================================
// User Type Guards
// ============================================

/**
 * Check if value is a User
 */
export function isUser(value: unknown): value is User {
  return UserSchema.safeParse(value).success;
}

/**
 * Assert value is a User (throws if invalid)
 */
export function assertUser(value: unknown): asserts value is User {
  const result = UserSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected User, got: ${result.error.message}`);
  }
}

/**
 * Check if value is an ApiKeyUser
 */
export function isApiKeyUser(value: unknown): value is ApiKeyUser {
  return ApiKeyUserSchema.safeParse(value).success;
}

/**
 * Assert value is an ApiKeyUser (throws if invalid)
 */
export function assertApiKeyUser(value: unknown): asserts value is ApiKeyUser {
  const result = ApiKeyUserSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ApiKeyUser, got: ${result.error.message}`);
  }
}

// ============================================
// RAG Type Guards
// ============================================

/**
 * Check if value is a RagCollection
 */
export function isRagCollection(value: unknown): value is RagCollection {
  return RagCollectionSchema.safeParse(value).success;
}

/**
 * Assert value is a RagCollection (throws if invalid)
 */
export function assertRagCollection(value: unknown): asserts value is RagCollection {
  const result = RagCollectionSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected RagCollection, got: ${result.error.message}`);
  }
}

/**
 * Check if value is a RagDocument
 */
export function isRagDocument(value: unknown): value is RagDocument {
  return RagDocumentSchema.safeParse(value).success;
}

/**
 * Assert value is a RagDocument (throws if invalid)
 */
export function assertRagDocument(value: unknown): asserts value is RagDocument {
  const result = RagDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected RagDocument, got: ${result.error.message}`);
  }
}

/**
 * Check if value is a RagSearchResult
 */
export function isRagSearchResult(value: unknown): value is RagSearchResult {
  return RagSearchResultSchema.safeParse(value).success;
}

/**
 * Assert value is a RagSearchResult (throws if invalid)
 */
export function assertRagSearchResult(value: unknown): asserts value is RagSearchResult {
  const result = RagSearchResultSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected RagSearchResult, got: ${result.error.message}`);
  }
}

// ============================================
// API Key Type Guards
// ============================================

/**
 * Check if value is an ApiKey
 */
export function isApiKey(value: unknown): value is ApiKey {
  return ApiKeySchema.safeParse(value).success;
}

/**
 * Assert value is an ApiKey (throws if invalid)
 */
export function assertApiKey(value: unknown): asserts value is ApiKey {
  const result = ApiKeySchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ApiKey, got: ${result.error.message}`);
  }
}

// ============================================
// Release Type Guards
// ============================================

/**
 * Check if value is a Release
 */
export function isRelease(value: unknown): value is Release {
  return ReleaseSchema.safeParse(value).success;
}

/**
 * Assert value is a Release (throws if invalid)
 */
export function assertRelease(value: unknown): asserts value is Release {
  const result = ReleaseSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected Release, got: ${result.error.message}`);
  }
}

// ============================================
// Error Type Guards
// ============================================

/**
 * Check if value is a DivinciErrorData
 */
export function isDivinciErrorData(value: unknown): value is DivinciErrorData {
  return DivinciErrorDataSchema.safeParse(value).success;
}

/**
 * Assert value is a DivinciErrorData (throws if invalid)
 */
export function assertDivinciErrorData(value: unknown): asserts value is DivinciErrorData {
  const result = DivinciErrorDataSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected DivinciErrorData, got: ${result.error.message}`);
  }
}

// ============================================
// Arena Type Guards
// ============================================

/**
 * Check if value is an ArenaResponseVariant
 */
export function isArenaResponseVariant(value: unknown): value is ArenaResponseVariant {
  return ArenaResponseVariantSchema.safeParse(value).success;
}

/**
 * Assert value is an ArenaResponseVariant (throws if invalid)
 */
export function assertArenaResponseVariant(value: unknown): asserts value is ArenaResponseVariant {
  const result = ArenaResponseVariantSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ArenaResponseVariant, got: ${result.error.message}`);
  }
}

/**
 * Check if value is an ArenaPreset
 */
export function isArenaPreset(value: unknown): value is ArenaPreset {
  return ArenaPresetSchema.safeParse(value).success;
}

/**
 * Assert value is an ArenaPreset (throws if invalid)
 */
export function assertArenaPreset(value: unknown): asserts value is ArenaPreset {
  const result = ArenaPresetSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ArenaPreset, got: ${result.error.message}`);
  }
}

/**
 * Check if value is an ArenaConfig
 */
export function isArenaConfig(value: unknown): value is ArenaConfig {
  return ArenaConfigSchema.safeParse(value).success;
}

/**
 * Assert value is an ArenaConfig (throws if invalid)
 */
export function assertArenaConfig(value: unknown): asserts value is ArenaConfig {
  const result = ArenaConfigSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ArenaConfig, got: ${result.error.message}`);
  }
}

/**
 * Check if value is an ArenaResultsResponse
 */
export function isArenaResultsResponse(value: unknown): value is ArenaResultsResponse {
  return ArenaResultsResponseSchema.safeParse(value).success;
}

/**
 * Assert value is an ArenaResultsResponse (throws if invalid)
 */
export function assertArenaResultsResponse(value: unknown): asserts value is ArenaResultsResponse {
  const result = ArenaResultsResponseSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`Expected ArenaResultsResponse, got: ${result.error.message}`);
  }
}

/**
 * Check if a ChatMessage has arena variants
 */
export function isArenaMessage(value: unknown): boolean {
  if (!isChatMessage(value)) return false;
  const msg = value as ChatMessage;
  return (msg.arenaVariants !== undefined && msg.arenaVariants.length > 0) ||
    msg.arenaStreamingStatus === "streaming";
}

// ============================================
// Utility Type Guards
// ============================================

/**
 * Check if value is an array of a specific type
 */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

/**
 * Check if value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if value has a specific property
 */
export function hasProperty<K extends string>(
  value: unknown,
  key: K
): value is Record<K, unknown> {
  return isObject(value) && key in value;
}

/**
 * Check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Check if value is a valid ObjectId format (24 hex characters)
 */
export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

/**
 * Check if value is a valid ISO date string
 */
export function isISODateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !isNaN(date.getTime()) && value.includes("T");
}
