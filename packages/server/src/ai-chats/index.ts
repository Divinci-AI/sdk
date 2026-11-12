/**
 * AIChats Client
 *
 * AIChats are user-owned conversations (the chat surface behind the web app,
 * embed, and the Divinci extension). Unlike the workspace API-key resources,
 * these routes authenticate as the SIGNED-IN USER, so this client requires an
 * OAuth `accessToken` (not an API key).
 *
 * v1 exposes message emoji reactions — the server stores them on the message's
 * `emojis` map; this is the SDK surface the extension dogfoods to sync
 * local-first reactions for account-mirrored chats.
 */

import { ServerHttpClient } from "../http-client.js";

export interface EmojiReactionResult {
  status: string;
}

/** Options for {@link AiChatsClient.sendLinearMessage}. */
export interface SendLinearMessageOptions {
  /** The user's message text. */
  content: string;
  /**
   * Which assistant should answer. Omit to use the chat's configured assistant.
   *
   * Unlike the tree-shaped contract, this is NOT inferred from whatever message
   * is being replied to — a linear turn always continues the latest one, so the
   * model is chosen per request and can change mid-conversation.
   */
  assistantName?: string;
  /** Client-supplied id echoed back on the stored message, for reconciling an
   *  optimistically-rendered bubble with the server's copy. */
  optimisticId?: string;
  /** Pre-computed category hints. Omit to let the server infer them. */
  category?: string;
  categoryConfidence?: number;
}

/** Result of {@link AiChatsClient.sendLinearMessage}. */
export interface SendLinearMessageResult {
  status: string;
}

export class AiChatsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  private emojiUrl(chatId: string, messageId: string): string {
    return `/ai-chat/${encodeURIComponent(chatId)}/message/${encodeURIComponent(messageId)}/emoji-reaction`;
  }

  /**
   * Send a message on a LINEAR chat — the simple, single-threaded contract.
   *
   * One turn at a time, always continuing the latest message. There is no
   * `replyTo`: the server anchors the turn itself, so a conversation is a plain
   * ordered list rather than a tree. This is almost certainly what you want when
   * building an app on top of Divinci.
   *
   * The chat's transcript must have opted in (`isLinear`). An existing
   * tree-shaped chat cannot be converted — fork a message into its own linear
   * transcript instead.
   *
   * Errors worth handling:
   *  - **403** the transcript is not linear.
   *  - **409** the chat is already handling a message. RETRYABLE — a linear chat
   *    refuses concurrent turns rather than queueing them, so wait for the
   *    in-flight reply and send again.
   *
   * Replies are delivered asynchronously (WebSocket / transcript poll), the same
   * as the standard message endpoint; a 200 here means the turn was accepted,
   * not that the assistant has finished.
   */
  async sendLinearMessage(
    chatId: string,
    options: SendLinearMessageOptions,
  ): Promise<SendLinearMessageResult> {
    return this.httpClient.post<SendLinearMessageResult>(
      `/ai-chat/${encodeURIComponent(chatId)}/linear-message`,
      { ...options },
    );
  }

  /** Add an emoji reaction to a message (idempotent server-side per user+emoji). */
  async addEmojiReaction(chatId: string, messageId: string, emoji: string): Promise<EmojiReactionResult> {
    return this.httpClient.post<EmojiReactionResult>(this.emojiUrl(chatId, messageId), {
      emoji,
      add: true,
    });
  }

  /** Remove an emoji reaction from a message. */
  async removeEmojiReaction(chatId: string, messageId: string, emoji: string): Promise<EmojiReactionResult> {
    return this.httpClient.post<EmojiReactionResult>(this.emojiUrl(chatId, messageId), {
      emoji,
      remove: true,
    });
  }

  /** Convenience: add or remove based on a boolean. */
  async setEmojiReaction(
    chatId: string,
    messageId: string,
    emoji: string,
    reacted: boolean,
  ): Promise<EmojiReactionResult> {
    return reacted
      ? this.addEmojiReaction(chatId, messageId, emoji)
      : this.removeEmojiReaction(chatId, messageId, emoji);
  }
}
