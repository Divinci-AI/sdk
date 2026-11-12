/**
 * Chat and messaging types
 */

import type { ObjectId, ISODateString, ResourceMetadata } from "./common.js";
import type { ArenaResponseVariant, ArenaStreamingStatus } from "./arena.js";

/**
 * Message role
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * Message content type
 */
export type MessageContentType = "text" | "image" | "audio" | "file";

/**
 * Chat message
 */
export interface ChatMessage {
  /** Message ID (normalized from `_id` by the SDK) */
  id: ObjectId;
  /** Chat ID this message belongs to */
  chatId?: ObjectId;
  /** Release ID this message belongs to (wire field) */
  release?: string;
  /** Message role */
  role: MessageRole;
  /** Message content */
  content: string;
  /** Content type */
  contentType?: MessageContentType;
  /**
   * Timestamp. Wire returns epoch milliseconds (number) on transcript endpoints
   * and ISO string on stream endpoints — handle both.
   */
  timestamp: ISODateString | number;
  /** Sender display name (wire field — assistant model name for AI turns) */
  name?: string;
  /** Sender Auth0 user ID (wire field — present on user turns) */
  userId?: string;
  /** Message category (wire field) */
  category?: string;
  /** Token count */
  tokenCount?: number;
  /** RAG context sources (if contextBubbles enabled) */
  context?: ChatMessageContext[];
  /** Product recommendations surfaced for this message (RAG products and/or
   *  retroactively-matched catalog products). Anonymous chat returns these on
   *  the message; owned chat also drives inline decoration via `context`. */
  products?: ProductRecommendation[];
  /** Emoji reactions */
  reactions?: MessageReaction[];
  /** Message metadata */
  metadata?: Record<string, unknown>;
  /** Arena mode: array of model variant responses for side-by-side comparison */
  arenaVariants?: ArenaResponseVariant[];
  /** Arena mode: index of the user's chosen response variant */
  arenaSelectedIndex?: number;
  /** Arena streaming: status of variant arrival */
  arenaStreamingStatus?: ArenaStreamingStatus;
  /** Arena streaming: how many variants are expected (for rendering skeletons) */
  arenaExpectedVariants?: number;
}

/**
 * RAG context attached to a message
 */
export interface ChatMessageContext {
  /** Vector ID */
  vectorId: string;
  /** Content chunk */
  content: string;
  /** Source file metadata */
  metadata: {
    /** Original file name */
    originalName: string;
    /** File object key */
    fileObjectKey: string;
    /** Token count of this chunk */
    tokenCount: number;
    /** True for product chunks / synthetic retro-match decoration items. */
    isProduct?: boolean;
    /** Product display name (for inline product decoration). */
    productName?: string;
    /** Product URL (for inline product decoration). */
    productUrl?: string;
    /** Product image URL. */
    imageUrl?: string;
  };
  /** Similarity score */
  score?: number;
}

/**
 * A product recommendation surfaced alongside an assistant message.
 */
export interface ProductRecommendation {
  /** Catalog product id (or a synthetic `retro-*` id for matched mentions). */
  productId: string;
  /** Display name. */
  name: string;
  /** List price. */
  price?: number;
  /** Sale price, if discounted. */
  salePrice?: number;
  /** Product image URL. */
  imageUrl?: string;
  /** Link to the product page. */
  productUrl?: string;
  /** Match confidence [0,1]. */
  score?: number;
  /** Human-readable reason this product was surfaced. */
  matchReason?: string;
}

/**
 * Message reaction
 */
export interface MessageReaction {
  /** Emoji */
  emoji: string;
  /** User IDs who reacted */
  users: ObjectId[];
  /** Count */
  count: number;
}

/** Rating sentiment for an assistant message. -1 = thumbs-down, 1 = thumbs-up. */
export type MessageSentiment = -1 | 1;

/** Free-text feedback for a message (the thumbs-down dropdown). */
export interface MessageFeedbackInput {
  /** The user's free-text feedback. */
  feedback?: string;
  /** Optional sentiment to tag the feedback with. */
  sentiment?: MessageSentiment;
}

/**
 * Feedback for an anonymous (landing/embed) message. Authenticity is proven by
 * the held signed transcript — the server verifies it before recording.
 */
export interface AnonymousFeedbackInput extends MessageFeedbackInput {
  /** Release the anonymous chat belongs to. */
  releaseId: ObjectId;
  /** The client-held signed anonymous transcript. */
  transcript: unknown[];
  /** HMAC signature proving the transcript is server-issued. */
  signiture: string;
  /** Index of the rated exchange within the transcript. */
  messageIndex: number;
}

/**
 * Chat thread/conversation
 */
export interface ChatThread {
  /** Chat ID (normalized from `_id` by the SDK) */
  id: ObjectId;
  /** Chat title (auto-generated or user-set) */
  title?: string;
  /** Whether the title has been explicitly set (vs auto-generated) */
  titleSet?: boolean;
  /**
   * Release ID this chat belongs to (declared alias).
   * @deprecated Wire sends `releases[]` (array). Use `releases[0]` for the
   * primary release. The client SDK sets `releaseId` from `releases[0]` for
   * backwards compatibility.
   */
  releaseId?: ObjectId;
  /** Release IDs this chat belongs to (wire field) */
  releases?: string[];
  /**
   * Owner user ID (declared alias).
   * @deprecated Wire sends `ownerUser` (string). Use `ownerUser`.
   */
  ownerId?: ObjectId;
  /** Owner Auth0 user ID (wire field) */
  ownerUser?: string;
  /** Workspace ID */
  workspaceId?: ObjectId;
  /** Underlying transcript document ID */
  transcriptId?: string;
  /** Message count (not always present on wire) */
  messageCount?: number;
  /** Last message timestamp */
  lastMessageAt?: ISODateString;
  /** Chat visibility */
  visibility?: ChatVisibility;
  /** Whether chat is archived */
  archived?: boolean;
  /** Creation timestamp (epoch ms on wire) */
  createdAt?: number;
  /** Last-update timestamp (epoch ms on wire) */
  updatedAt?: number;
  /** Chat metadata (present on server-SDK routes) */
  metadata?: ResourceMetadata;
}

/**
 * Chat visibility options
 */
export type ChatVisibility = "private" | "shared" | "public";

/**
 * Per-call inference parameter overrides.
 *
 * Only honored when the release is pinned to a BYOK provider
 * (release.config.byokId). For platform-default releases, override
 * is ignored — hosted-provider tier gating must not be bypassable.
 *
 * Phase 3 of the as-above-so-below-rts SDK integration.
 */
export interface SendMessageOverride {
  /** Override the release's default model for this call only */
  model?: string;
  /** Override temperature (0-2) for this call only */
  temperature?: number;
  /** Override max tokens for this call only (clamped to tier cap) */
  maxTokens?: number;
  /** Override topP (0-1) for this call only */
  topP?: number;
}

/**
 * Options for sending a chat message
 */
export interface SendMessageOptions {
  /** Message content */
  content: string;
  /** Content type (defaults to "text") */
  contentType?: MessageContentType;
  /** Attachments */
  attachments?: MessageAttachment[];
  /** Stream the response */
  stream?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Assistant name/ID to use for the response (required if no replyTo) */
  assistantName?: string;
  /** Reply to a specific message ID */
  replyTo?: string;
  /**
   * Per-call inference parameter overrides. Only honored on BYOK-pinned
   * releases. See SendMessageOverride for behavior.
   */
  override?: SendMessageOverride;
}

/**
 * Message attachment
 */
export interface MessageAttachment {
  /** Attachment type */
  type: "image" | "audio" | "file";
  /** File URL or base64 data */
  data: string;
  /** MIME type */
  mimeType: string;
  /** File name */
  name?: string;
}

/**
 * Streaming chat response chunk
 */
export interface ChatStreamChunk {
  /** Chunk type */
  type: "content" | "context" | "done" | "error";
  /** Message ID (sent on first chunk) */
  messageId?: string;
  /** Content delta */
  content?: string;
  /** Context sources (for RAG) */
  context?: ChatMessageContext[];
  /** Complete message (on done) */
  message?: ChatMessage;
  /** Finish reason (on done) */
  finishReason?: "stop" | "length" | "content_filter" | "tool_calls";
  /** Usage statistics (on done) */
  usage?: ChatUsage;
  /** Error (if type is error) */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Acknowledgement returned by `chat.send()`.
 *
 * `send()` submits the message to the server and returns immediately with a
 * delivery acknowledgement. The actual assistant reply is delivered
 * asynchronously — use `chat.stream()` to receive it in real time, or call
 * `chat.getTranscript(chatId)` after a short delay to read it.
 *
 * Use `chat.sendAndPoll()` if you want a single call that waits for the reply.
 */
export interface SendAck {
  /** Delivery status — `"sent"` when the message was accepted. */
  status: string;
}

/**
 * Chat response (non-streaming) — returned by `chat.sendAndPoll()`.
 *
 * @deprecated `chat.send()` now returns `SendAck`. Use `chat.stream()` for
 * streaming replies or `chat.sendAndPoll()` for a polled synchronous response.
 */
export interface ChatResponse {
  /** The assistant's response message */
  message: ChatMessage;
  /** Usage statistics */
  usage?: ChatUsage;
  /** Context sources used */
  context?: ChatMessageContext[];
}

/**
 * Chat usage statistics
 */
export interface ChatUsage {
  /** Prompt tokens */
  promptTokens: number;
  /** Completion tokens */
  completionTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Estimated cost in USD */
  estimatedCostUsd?: number;
}

/**
 * Options for creating a new chat
 */
export interface CreateChatOptions {
  /** Release ID to use */
  releaseId: ObjectId;
  /** Initial title */
  title?: string;
  /** Initial system message */
  systemMessage?: string;
  /** Chat visibility */
  visibility?: ChatVisibility;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for listing chats
 */
export interface ListChatsOptions {
  /** Filter by release ID */
  releaseId?: ObjectId;
  /** Include archived chats */
  includeArchived?: boolean;
  /** Limit results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}
