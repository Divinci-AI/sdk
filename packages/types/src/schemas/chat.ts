/**
 * Chat Zod schemas
 */

import { z } from "zod";
import { ObjectIdSchema, ISODateStringSchema, ResourceMetadataSchema, ChatMessageContextSchema } from "./common.js";
import { ArenaResponseVariantSchema, ArenaStreamingStatusSchema } from "./arena.js";

// Re-export ChatMessageContextSchema so existing consumers of chat.ts still find it
export { ChatMessageContextSchema };

/**
 * Message role
 */
export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

/**
 * Message content type
 */
export const MessageContentTypeSchema = z.enum(["text", "image", "audio", "file"]);

/**
 * Chat visibility options
 */
export const ChatVisibilitySchema = z.enum(["private", "shared", "public"]);

/**
 * Message reaction
 */
export const MessageReactionSchema = z.object({
  /** Emoji */
  emoji: z.string(),
  /** User IDs who reacted */
  users: z.array(ObjectIdSchema),
  /** Count */
  count: z.number().int().positive(),
});

/**
 * Chat message
 */
export const ChatMessageSchema = z.object({
  /** Message ID */
  id: ObjectIdSchema,
  /** Chat ID this message belongs to */
  chatId: ObjectIdSchema.optional(),
  /** Message role */
  role: MessageRoleSchema,
  /** Message content */
  content: z.string(),
  /** Content type */
  contentType: MessageContentTypeSchema.optional(),
  /** Timestamp */
  timestamp: ISODateStringSchema,
  /** Token count */
  tokenCount: z.number().int().nonnegative().optional(),
  /** RAG context sources (if contextBubbles enabled) */
  context: z.array(ChatMessageContextSchema).optional(),
  /** Emoji reactions */
  reactions: z.array(MessageReactionSchema).optional(),
  /** Message metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Arena mode: array of model variant responses */
  arenaVariants: z.array(ArenaResponseVariantSchema).optional(),
  /** Arena mode: index of user's chosen variant */
  arenaSelectedIndex: z.number().int().nonnegative().optional(),
  /** Arena streaming status */
  arenaStreamingStatus: ArenaStreamingStatusSchema.optional(),
  /** Arena streaming: expected variant count (for rendering skeletons) */
  arenaExpectedVariants: z.number().int().nonnegative().optional(),
});

/**
 * Chat thread/conversation
 */
export const ChatThreadSchema = z.object({
  /** Chat ID */
  id: ObjectIdSchema,
  /** Chat title (auto-generated or user-set) */
  title: z.string().optional(),
  /** Release ID this chat belongs to */
  releaseId: ObjectIdSchema,
  /** Owner user ID */
  ownerId: ObjectIdSchema,
  /** Workspace ID */
  workspaceId: ObjectIdSchema.optional(),
  /** Message count */
  messageCount: z.number().int().nonnegative(),
  /** Last message timestamp */
  lastMessageAt: ISODateStringSchema.optional(),
  /** Chat visibility */
  visibility: ChatVisibilitySchema,
  /** Whether chat is archived */
  archived: z.boolean(),
  /** Chat metadata */
  metadata: ResourceMetadataSchema,
});

/**
 * Message attachment
 */
export const MessageAttachmentSchema = z.object({
  /** Attachment type */
  type: z.enum(["image", "audio", "file"]),
  /** File URL or base64 data */
  data: z.string(),
  /** MIME type */
  mimeType: z.string(),
  /** File name */
  name: z.string().optional(),
});

/**
 * Options for sending a chat message
 */
export const SendMessageOptionsSchema = z.object({
  /** Message content */
  content: z.string().min(1),
  /** Content type (defaults to "text") */
  contentType: MessageContentTypeSchema.optional(),
  /** Attachments */
  attachments: z.array(MessageAttachmentSchema).optional(),
  /** Stream the response */
  stream: z.boolean().optional(),
  /** Custom metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Assistant name/ID to use for the response (required if no replyTo) */
  assistantName: z.string().optional(),
  /** Reply to a specific message ID */
  replyTo: z.string().optional(),
});

/**
 * Chat usage statistics
 */
export const ChatUsageSchema = z.object({
  /** Prompt tokens */
  promptTokens: z.number().int().nonnegative(),
  /** Completion tokens */
  completionTokens: z.number().int().nonnegative(),
  /** Total tokens */
  totalTokens: z.number().int().nonnegative(),
  /** Estimated cost in USD */
  estimatedCostUsd: z.number().nonnegative().optional(),
});

/**
 * Streaming chat response chunk
 */
export const ChatStreamChunkSchema = z.object({
  /** Chunk type */
  type: z.enum(["content", "context", "done", "error"]),
  /** Message ID (sent on first chunk) */
  messageId: z.string().optional(),
  /** Content delta */
  content: z.string().optional(),
  /** Context sources (for RAG) */
  context: z.array(ChatMessageContextSchema).optional(),
  /** Complete message (on done) */
  message: ChatMessageSchema.optional(),
  /** Finish reason (on done) */
  finishReason: z.enum(["stop", "length", "content_filter", "tool_calls"]).optional(),
  /** Usage statistics (on done) */
  usage: ChatUsageSchema.optional(),
  /** Error (if type is error) */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

/**
 * Chat response (non-streaming)
 */
export const ChatResponseSchema = z.object({
  /** The assistant's response message */
  message: ChatMessageSchema,
  /** Usage statistics */
  usage: ChatUsageSchema,
  /** Context sources used */
  context: z.array(ChatMessageContextSchema).optional(),
});

/**
 * Options for creating a new chat
 */
export const CreateChatOptionsSchema = z.object({
  /** Release ID to use */
  releaseId: ObjectIdSchema,
  /** Initial title */
  title: z.string().optional(),
  /** Initial system message */
  systemMessage: z.string().optional(),
  /** Chat visibility */
  visibility: ChatVisibilitySchema.optional(),
  /** Custom metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Options for listing chats
 */
export const ListChatsOptionsSchema = z.object({
  /** Filter by release ID */
  releaseId: ObjectIdSchema.optional(),
  /** Include archived chats */
  includeArchived: z.boolean().optional(),
  /** Limit results */
  limit: z.number().int().positive().max(100).optional(),
  /** Pagination cursor */
  cursor: z.string().optional(),
});

// Type exports using z.infer
export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type MessageContentType = z.infer<typeof MessageContentTypeSchema>;
export type ChatVisibility = z.infer<typeof ChatVisibilitySchema>;
export type ChatMessageContext = z.infer<typeof ChatMessageContextSchema>;
export type MessageReaction = z.infer<typeof MessageReactionSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatThread = z.infer<typeof ChatThreadSchema>;
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;
export type SendMessageOptions = z.infer<typeof SendMessageOptionsSchema>;
export type ChatUsage = z.infer<typeof ChatUsageSchema>;
export type ChatStreamChunk = z.infer<typeof ChatStreamChunkSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type CreateChatOptions = z.infer<typeof CreateChatOptionsSchema>;
export type ListChatsOptions = z.infer<typeof ListChatsOptionsSchema>;
