/**
 * Chat Client
 *
 * Handles chat operations including sending messages and streaming responses
 */

import type {
  ChatThread,
  ChatMessage,
  SendAck,
  ChatStreamChunk,
  SendMessageOptions,
  CreateChatOptions,
  ListChatsOptions,
  PaginatedResponse,
  ArenaResponseVariant,
  ArenaSelectResponse,
  MessageSentiment,
  MessageFeedbackInput,
  AnonymousFeedbackInput,
} from "@divinci-ai/types";
import { HttpClient } from "../http-client.js";
import { StreamError, DivinciError } from "../errors.js";

/**
 * Chat stream event types
 */
export type ChatStreamEvent =
  | { type: "start"; messageId: string }
  | { type: "chunk"; content: string; chunk: ChatStreamChunk }
  | { type: "context"; context: ChatMessage["context"] }
  | { type: "done"; message: ChatMessage; usage?: ChatStreamChunk["usage"] }
  | { type: "error"; error: DivinciError }
  | { type: "arena-variant"; variantIndex: number; variant: ArenaResponseVariant }
  | { type: "arena-complete"; variants: ArenaResponseVariant[]; expectedVariants?: number };

/**
 * Chat stream options
 */
export interface StreamOptions {
  /** Callback for each stream event */
  onEvent?: (event: ChatStreamEvent) => void;
  /** Callback for content chunks (convenience) */
  onChunk?: (content: string) => void;
  /** Callback when complete */
  onComplete?: (message: ChatMessage) => void;
  /** Callback on error */
  onError?: (error: DivinciError) => void;
  /** Callback when an arena variant arrives */
  onArenaVariant?: (variant: ArenaResponseVariant) => void;
  /** Callback when all arena variants are complete */
  onArenaComplete?: (variants: ArenaResponseVariant[]) => void;
  /** Abort signal */
  signal?: AbortSignal;
}

/**
 * Chat client class
 */
/**
 * The wire format for chat threads is the Mongo document (`_id`, `releases[]`,
 * `ownerUser`) — verified against staging by tests/integration. Normalize the
 * declared `ChatThread.id` field additively so both `thread.id` (typed) and
 * the raw wire fields work.
 */
function normalizeThread(
  chat: ChatThread & { _id?: string; releases?: string[]; ownerUser?: string }
): ChatThread {
  if (!chat) return chat;
  let out = chat;
  // _id → id
  if (!out.id && out._id) out = { ...out, id: out._id };
  // releases[0] → releaseId (backwards-compat alias; wire sends array)
  if (!out.releaseId && out.releases?.[0]) out = { ...out, releaseId: out.releases[0] };
  // ownerUser → ownerId (backwards-compat alias; wire sends ownerUser)
  if (!out.ownerId && out.ownerUser) out = { ...out, ownerId: out.ownerUser };
  return out;
}

export class ChatClient {
  private readonly httpClient: HttpClient;
  private readonly releaseId: string;
  /** chatId → transcript.isLinear, learned once per chat. See messagePath(). */
  private readonly linearByChatId = new Map<string, boolean>();

  constructor(httpClient: HttpClient, releaseId: string) {
    this.httpClient = httpClient;
    this.releaseId = releaseId;
  }

  /**
   * Which message endpoint this chat's transcript accepts.
   *
   * There are two contracts and they are not interchangeable:
   *
   *   POST /ai-chat/:id/message         tree-capable; REFUSES a linear
   *                                     transcript with 403 "addChatMessage
   *                                     cannot write to a linear transcript"
   *   POST /ai-chat/:id/linear-message  linear; maintains the linear chain and
   *                                     takes part in the linear concurrency
   *                                     guard
   *
   * The SDK always used the first one, so send() and stream() 403'd on every
   * chat create() had just made — new transcripts are linear. Verified against
   * a local stack on 2026-09-20: a release-bound chat from this exact create()
   * call reports transcript.isLinear true, /message returns 403 and
   * /linear-message returns {"status":"ok"}.
   *
   * The web client makes the same choice from the same field (MessageForm reads
   * transcript.isLinear); this is the SDK catching up, not a new convention.
   *
   * Linearity is a property of the transcript and does not change under us, so
   * it is learned once per chat and cached. An unknown chat costs one GET on
   * its first send; create() and get() prime the cache, so the common
   * create-then-send path costs nothing extra.
   */
  private async messagePath(chatId: string): Promise<string> {
    let linear = this.linearByChatId.get(chatId);
    if (linear === undefined) {
      // Deliberately tolerant: if we cannot determine linearity, fall back to
      // the tree contract, which is what every caller got before this existed.
      linear = await this.fetchLinearity(chatId).catch(() => false);
      this.linearByChatId.set(chatId, linear);
    }
    return linear ? `/ai-chat/${chatId}/linear-message` : `/ai-chat/${chatId}/message`;
  }

  /** transcript.isLinear for a chat, straight from GET /ai-chat/:id. */
  private async fetchLinearity(chatId: string): Promise<boolean> {
    const response = await this.httpClient.get<{ transcript?: { isLinear?: boolean } }>(
      `/ai-chat/${chatId}`,
    );
    return response?.transcript?.isLinear === true;
  }

  /**
   * Create a new chat thread
   */
  async create(options: Omit<CreateChatOptions, "releaseId"> = {}): Promise<ChatThread> {
    const { title = "New Chat", ...rest } = options;
    const response = await this.httpClient.post<{
      chat: ChatThread;
      transcript?: { isLinear?: boolean };
    }>("/ai-chat", {
      title,
      releases: [this.releaseId],
      ...rest,
    });
    const thread = normalizeThread(response.chat);
    // Prime the cache when the server told us, so the first send needs no
    // extra round trip. When it did not, messagePath() asks.
    if (typeof response.transcript?.isLinear === "boolean" && thread.id) {
      this.linearByChatId.set(thread.id, response.transcript.isLinear);
    }
    return thread;
  }

  /**
   * Get a chat thread by ID
   */
  async get(chatId: string): Promise<ChatThread> {
    const response = await this.httpClient.get<{
      chat: ChatThread;
      transcript?: { isLinear?: boolean };
    }>(`/ai-chat/${chatId}`);
    if (typeof response.transcript?.isLinear === "boolean") {
      this.linearByChatId.set(chatId, response.transcript.isLinear);
    }
    return normalizeThread(response.chat);
  }

  /**
   * List chat threads with pagination
   */
  async list(
    options: Omit<ListChatsOptions, "releaseId"> = {}
  ): Promise<PaginatedResponse<ChatThread>> {
    const response = await this.httpClient.get<
      PaginatedResponse<ChatThread> | ChatThread[]
    >("/ai-chat", {
      release: this.releaseId,
      ...options,
    } as Record<string, string | number | boolean | undefined>);

    // Handle both new paginated response and legacy array response
    if (Array.isArray(response)) {
      // Legacy: Server returns array (backwards compatibility)
      return {
        data: response.map(normalizeThread),
        hasMore: false,
        total: response.length,
      };
    }

    // New: Server returns paginated response directly
    return { ...response, data: (response.data ?? []).map(normalizeThread) };
  }

  /**
   * Send a message and receive a delivery acknowledgement.
   *
   * The server accepts the message and returns `{ status: "sent" }` immediately.
   * The assistant's reply is delivered **asynchronously** — via the live
   * WebSocket if you have one open, or polled via `getTranscript()`.
   *
   * For a single blocking call that waits for the reply, use `sendAndPoll()`.
   * For real-time streaming, use `stream()`.
   *
   * **Required:** `assistantName` (or `replyTo`) must be included — the server
   * returns 400 if neither is present.
   *
   * @example
   * ```typescript
   * const ack = await chat.send(threadId, "Hello!", { assistantName: "Divinci" });
   * console.log(ack.status); // "sent"
   * // reply arrives async — poll or subscribe via WebSocket
   * ```
   */
  async send(
    chatId: string,
    content: string,
    options: Omit<SendMessageOptions, "chatId" | "content" | "stream"> = {}
  ): Promise<SendAck> {
    return this.httpClient.post<SendAck>(await this.messagePath(chatId), {
      content,
      stream: false,
      ...options,
    });
  }

  /**
   * Delegated-inference turn: the release runs its full pipeline server-side
   * (RAG + persona + input moderation on prepare; style-rewrite + persist on
   * complete) and ONLY the LLM call is run by `generate` — e.g. the user's
   * on-device model (`window.divinci.chat`). The user message is persisted at
   * prepare, the assistant turn (provenance:"local") at complete. No cloud LLM,
   * no AI billing. The authenticated analog of `anonymousChat.sendDelegated`.
   *
   * @example
   * ```typescript
   * const { responseId } = await chat.sendDelegated(chatId, "How do I…", (msgs) =>
   *   window.divinci.chat({ messages: msgs }).then((r) => r.fullText));
   * ```
   */
  async sendDelegated(
    chatId: string,
    content: string,
    generate: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<string>,
    options: { userInfo?: { timezone?: string }; signal?: AbortSignal } = {}
  ): Promise<{ requestId: string; responseId: string }> {
    // 1. PREPARE: release assembles RAG + persona + thread + input moderation,
    //    persists the user message, returns the messages + context.
    const prep = await this.httpClient.post<{
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      context: Array<{ content: string }>;
      requestId: string;
    }>(
      `/ai-chat/${chatId}/prepare`,
      { content, ...(options.userInfo ? { userInfo: options.userInfo } : {}) },
    );
    // 2. GENERATE on-device.
    const response = await generate(prep.messages);
    // 3. COMPLETE: release post-gen (style-rewrite) + persist the assistant turn.
    return this.httpClient.post<{ requestId: string; responseId: string }>(
      `/ai-chat/${chatId}/complete`,
      {
        requestId: prep.requestId,
        response,
        context: prep.context,
        ...(options.userInfo ? { userInfo: options.userInfo } : {}),
      },
    );
  }

  /**
   * Send a message and poll `getTranscript()` until the assistant reply appears.
   *
   * Calls `send()` then polls every `pollInterval` ms (default 1500) until a new
   * assistant message appears at the end of the transcript, or `timeout` ms
   * elapses (default 60 000). Returns the assistant's reply message.
   *
   * **Required:** `assistantName` (or `replyTo`) must be included in `options`.
   *
   * @example
   * ```typescript
   * const reply = await chat.sendAndPoll(threadId, "Summarize this.", {
   *   assistantName: "Divinci",
   * });
   * console.log(reply.content);
   * ```
   */
  async sendAndPoll(
    chatId: string,
    content: string,
    options: Omit<SendMessageOptions, "chatId" | "content" | "stream"> & {
      pollInterval?: number;
      timeout?: number;
    } = {}
  ): Promise<ChatMessage> {
    const { pollInterval = 1500, timeout = 60_000, ...sendOptions } = options;

    // snapshot current transcript length before sending
    const before = await this.getTranscript(chatId);
    const beforeCount = before.length;

    await this.send(chatId, content, sendOptions);

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, pollInterval));
      const messages = await this.getTranscript(chatId);
      const last = messages[messages.length - 1];
      if (messages.length > beforeCount && last?.role === "assistant") {
        return last;
      }
    }

    throw new DivinciError("sendAndPoll timed out waiting for assistant reply", {
      code: "TIMEOUT",
      status: 408,
    });
  }

  /**
   * Send a message with streaming response
   */
  async stream(
    chatId: string,
    content: string,
    options: Omit<SendMessageOptions, "chatId" | "content" | "stream"> & StreamOptions = {}
  ): Promise<ChatMessage> {
    const { onEvent, onChunk, onComplete, onError, onArenaVariant, onArenaComplete, signal, ...messageOptions } = options;

    // Get the base URL from the http client config
    const baseUrl = this.httpClient.getBaseUrl();
    const url = new URL(await this.messagePath(chatId), baseUrl);

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const token = await this.httpClient.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Make streaming request
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        content,
        stream: true,
        ...messageOptions,
      }),
      signal,
    });

    if (!response.ok) {
      let errorData: Record<string, unknown>;
      const errorText = await response.text();
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = {
          code: "STREAM_ERROR",
          message: response.statusText || "Stream request failed",
        };
      }

      const error = DivinciError.fromResponse({
        code: (errorData.code as string) ?? "STREAM_ERROR",
        message: (errorData.message as string) ?? "Stream request failed",
        status: response.status,
        details: errorData.details as Record<string, unknown>,
      });

      onError?.(error);
      onEvent?.({ type: "error", error });
      throw error;
    }

    if (!response.body) {
      throw new StreamError("No response body for stream");
    }

    const streamMsg = await this.processStream(response.body, {
      onEvent,
      onChunk,
      onComplete,
      onError,
      onArenaVariant,
      onArenaComplete,
    });

    // SSE content variability: replies are delivered primarily over the live
    // WebSocket on this platform. When no chunks reached the SSE connection
    // the resolved message has empty content. Fall back to getTranscript() once
    // so callers always receive the actual reply text.
    if (!streamMsg.content) {
      await new Promise<void>((r) => setTimeout(r, 900));
      try {
        const messages = await this.getTranscript(chatId);
        const committed = [...messages].reverse().find(
          (m) => m.role === "assistant" && m.content
        );
        if (committed) return committed;
      } catch {
        // transcript fetch failed — return the stream result as-is
      }
    }

    return streamMsg;
  }

  /**
   * Process SSE stream
   */
  private async processStream(
    body: ReadableStream<Uint8Array>,
    callbacks: Pick<StreamOptions, "onEvent" | "onChunk" | "onComplete" | "onError" | "onArenaVariant" | "onArenaComplete">
  ): Promise<ChatMessage> {
    const { onEvent, onChunk, onComplete, onError, onArenaVariant, onArenaComplete } = callbacks;

    const reader = body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let fullContent = "";
    let finalMessage: ChatMessage | null = null;
    let context: ChatMessage["context"] | undefined;
    let usage: ChatStreamChunk["usage"] | undefined;
    let messageId: string | undefined;

    // Arena state
    let arenaVariants: ArenaResponseVariant[] = [];
    let arenaExpectedVariants: number | undefined;
    let arenaStreamingStatus: ChatMessage["arenaStreamingStatus"] | undefined;
    let arenaSelectedIndex: number | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            // Handle [DONE] marker
            if (data === "[DONE]") {
              continue;
            }

            try {
              const chunk = JSON.parse(data) as ChatStreamChunk & {
                arenaVariants?: ArenaResponseVariant[];
                arenaStreamingStatus?: string;
                arenaExpectedVariants?: number;
                arenaSelectedIndex?: number;
              };

              // Handle start event
              if (chunk.messageId && !messageId) {
                messageId = chunk.messageId;
                onEvent?.({ type: "start", messageId });
              }

              // Handle content chunk
              if (chunk.content) {
                fullContent += chunk.content;
                onChunk?.(chunk.content);
                onEvent?.({ type: "chunk", content: chunk.content, chunk });
              }

              // Handle context
              if (chunk.context) {
                context = chunk.context;
                onEvent?.({ type: "context", context });
              }

              // Handle usage
              if (chunk.usage) {
                usage = chunk.usage;
              }

              // Handle arena expected variants count
              if (chunk.arenaExpectedVariants !== undefined) {
                arenaExpectedVariants = chunk.arenaExpectedVariants;
              }

              // Handle arena selected index
              if (chunk.arenaSelectedIndex !== undefined) {
                arenaSelectedIndex = chunk.arenaSelectedIndex;
              }

              // Handle arena variants arriving
              if (chunk.arenaVariants && chunk.arenaVariants.length > 0) {
                for (const variant of chunk.arenaVariants) {
                  // Check if this variant is new (not already tracked)
                  const existing = arenaVariants.find(v => v.variantIndex === variant.variantIndex);
                  if (!existing) {
                    arenaVariants.push(variant);
                    onArenaVariant?.(variant);
                    onEvent?.({ type: "arena-variant", variantIndex: variant.variantIndex, variant });
                  }
                }
              }

              // Handle arena streaming status changes
              if (chunk.arenaStreamingStatus) {
                arenaStreamingStatus = chunk.arenaStreamingStatus as ChatMessage["arenaStreamingStatus"];
                if (arenaStreamingStatus === "complete" && arenaVariants.length > 0) {
                  onArenaComplete?.(arenaVariants);
                  onEvent?.({
                    type: "arena-complete",
                    variants: arenaVariants,
                    expectedVariants: arenaExpectedVariants,
                  });
                }
              }

              // Handle finish
              if (chunk.finishReason) {
                finalMessage = {
                  id: messageId || crypto.randomUUID(),
                  chatId: "",
                  role: "assistant",
                  content: fullContent,
                  context,
                  timestamp: new Date().toISOString(),
                  // Include arena data if present
                  ...(arenaVariants.length > 0 && { arenaVariants }),
                  ...(arenaSelectedIndex !== undefined && { arenaSelectedIndex }),
                  ...(arenaStreamingStatus && { arenaStreamingStatus }),
                  ...(arenaExpectedVariants !== undefined && { arenaExpectedVariants }),
                };

                onComplete?.(finalMessage);
                onEvent?.({ type: "done", message: finalMessage, usage });
              }
            } catch (e) {
              // Skip invalid JSON
              console.warn("[Divinci] Invalid SSE chunk:", data);
            }
          }
        }
      }

      // Return final message or construct one
      if (finalMessage) {
        return finalMessage;
      }

      // If stream ended without finish event, construct message
      return {
        id: messageId || crypto.randomUUID(),
        chatId: "",
        role: "assistant",
        content: fullContent,
        context,
        timestamp: new Date().toISOString(),
        ...(arenaVariants.length > 0 && { arenaVariants }),
        ...(arenaSelectedIndex !== undefined && { arenaSelectedIndex }),
        ...(arenaStreamingStatus && { arenaStreamingStatus }),
        ...(arenaExpectedVariants !== undefined && { arenaExpectedVariants }),
      };
    } catch (error) {
      const streamError =
        error instanceof DivinciError
          ? error
          : new StreamError(`Stream processing failed: ${(error as Error).message}`);

      onError?.(streamError);
      onEvent?.({ type: "error", error: streamError });
      throw streamError;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get chat transcript (all messages)
   */
  async getTranscript(chatId: string): Promise<ChatMessage[]> {
    const response = await this.httpClient.get<{ messages: ChatMessage[] }>(
      `/ai-chat/${chatId}/transcript`
    );
    // Wire messages are Mongo-shaped (`_id`); normalize declared `id` additively.
    return (response.messages ?? []).map((message) => {
      const wire = message as ChatMessage & { _id?: string };
      return wire.id || !wire._id ? message : { ...message, id: wire._id };
    });
  }

  /**
   * Create anonymous chat session
   */
  async createAnonymous(): Promise<ChatThread> {
    const chat = await this.httpClient.post<ChatThread & { _id?: string }>(
      "/ai-chat/anonymous-chat",
      { releaseId: this.releaseId }
    );
    return normalizeThread(chat);
  }

  /**
   * Delete a chat thread
   */
  async delete(chatId: string): Promise<void> {
    await this.httpClient.delete(`/ai-chat/${chatId}`);
  }

  /**
   * Select a winning arena variant for a chat message
   *
   * Convenience method — equivalent to `sdk.arena.selectChatVariant()`
   *
   * @example
   * ```typescript
   * await client.chat.selectArena("chat-123", "msg-456", 0);
   * ```
   */
  async selectArena(
    chatId: string,
    messageId: string,
    selectedIndex: number
  ): Promise<ArenaSelectResponse> {
    return this.httpClient.post<ArenaSelectResponse>(
      `/ai-chat/${chatId}/message/${messageId}/arena-select`,
      { selectedIndex }
    );
  }

  /**
   * Rate an assistant message thumbs up/down (authenticated / owned chat).
   *
   * @param rating -1 = thumbs-down, 1 = thumbs-up, 0 = clear the vote.
   * @example
   * ```typescript
   * await client.chat.rateMessage("chat-123", "msg-456", -1);
   * ```
   */
  async rateMessage(
    chatId: string,
    messageId: string,
    rating: MessageSentiment | 0
  ): Promise<void> {
    await this.httpClient.post(
      `/ai-chat/${chatId}/message/${messageId}/rating`,
      { rating }
    );
  }

  /**
   * Submit free-text feedback for an assistant message (the thumbs-down
   * dropdown), authenticated / owned chat. Routed server-side to the
   * whitelabel's notification channels (consolidated 24h email digest +
   * real-time non-email).
   *
   * @example
   * ```typescript
   * await client.chat.submitMessageFeedback("chat-123", "msg-456", {
   *   feedback: "The answer missed the warranty terms.",
   *   sentiment: -1,
   * });
   * ```
   */
  async submitMessageFeedback(
    chatId: string,
    messageId: string,
    input: MessageFeedbackInput
  ): Promise<void> {
    await this.httpClient.post(
      `/ai-chat/${chatId}/message/${messageId}/feedback`,
      { feedback: input.feedback, sentiment: input.sentiment }
    );
  }

  /**
   * Submit feedback for an ANONYMOUS (landing/embed) message. Proves
   * authenticity with the held signed transcript + signature (the server
   * verifies before recording). Only negative / feedback-bearing submissions
   * are recorded server-side.
   *
   * @example
   * ```typescript
   * await client.chat.submitAnonymousFeedback({
   *   releaseId, transcript, signiture, messageIndex: 0,
   *   feedback: "Not quite right", sentiment: -1,
   * });
   * ```
   */
  async submitAnonymousFeedback(input: AnonymousFeedbackInput): Promise<void> {
    await this.httpClient.post("/ai-chat/anonymous-feedback", {
      releaseId: input.releaseId,
      transcript: input.transcript,
      signiture: input.signiture,
      messageIndex: input.messageIndex,
      feedback: input.feedback,
      sentiment: input.sentiment,
    });
  }

  /**
   * Messages sub-namespace for cleaner API
   *
   * @example
   * ```typescript
   * await client.chat.messages.send(chatId, "Hello");
   * await client.chat.messages.stream(chatId, "Hello", { onChunk });
   * ```
   */
  get messages() {
    return {
      send: this.send.bind(this),
      stream: this.stream.bind(this),
    };
  }
}
