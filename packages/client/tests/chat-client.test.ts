/**
 * ChatClient tests
 *
 * Tests for chat operations including streaming SSE responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatClient } from "../src/chat/index.js";
import { HttpClient } from "../src/http-client.js";
import { StreamError, DivinciError } from "../src/errors.js";
import {
  createMockFetch,
  createMockResponse,
  createStreamingResponse,
} from "./mocks/fetch.js";

// Mock HttpClient
function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    getToken: vi.fn().mockResolvedValue("test-token"),
    getBaseUrl: vi.fn().mockReturnValue("https://api.divinci.app"),
  } as unknown as HttpClient;
}

describe("ChatClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("create", () => {
    it("should create a new chat thread", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        chat: {
          id: "chat-123",
          releases: ["release-456"],
          createdAt: "2024-01-01T00:00:00Z",
        },
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      const result = await client.create();

      expect(result.id).toBe("chat-123");
      expect(mockHttpClient.post).toHaveBeenCalledWith("/ai-chat", {
        title: "New Chat",
        releases: ["release-456"],
      });
    });

    it("should pass additional options", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        chat: { id: "chat-123" },
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      await client.create({ metadata: { source: "test" } });

      expect(mockHttpClient.post).toHaveBeenCalledWith("/ai-chat", {
        title: "New Chat",
        releases: ["release-456"],
        metadata: { source: "test" },
      });
    });
  });

  describe("get", () => {
    it("should get chat thread by ID", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        chat: {
          id: "chat-123",
          messages: [],
        },
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      const result = await client.get("chat-123");

      expect(result.id).toBe("chat-123");
      expect(mockHttpClient.get).toHaveBeenCalledWith("/ai-chat/chat-123");
    });
  });

  describe("list", () => {
    it("should handle legacy array response from server", async () => {
      const mockHttpClient = createMockHttpClient();
      // Legacy: Server returns array directly, SDK wraps it in PaginatedResponse
      mockHttpClient.get = vi.fn().mockResolvedValue([
        { id: "chat-1" },
        { id: "chat-2" },
      ]);

      const client = new ChatClient(mockHttpClient, "release-456");
      const result = await client.list({ limit: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(2);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/ai-chat",
        expect.objectContaining({
          release: "release-456",
          limit: 10,
        })
      );
    });

    it("should handle paginated response from server", async () => {
      const mockHttpClient = createMockHttpClient();
      // New: Server returns paginated response directly
      mockHttpClient.get = vi.fn().mockResolvedValue({
        data: [
          { id: "chat-1" },
          { id: "chat-2" },
        ],
        hasMore: true,
        total: 10,
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      const result = await client.list({ limit: 2, offset: 0 });

      expect(result.data).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(10);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/ai-chat",
        expect.objectContaining({
          release: "release-456",
          limit: 2,
          offset: 0,
        })
      );
    });
  });

  describe("send", () => {
    it("should send a message and receive response", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        message: {
          id: "msg-123",
          role: "assistant",
          content: "Hello! How can I help?",
        },
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      const result = await client.send("chat-123", "Hello");

      expect(result.message.content).toBe("Hello! How can I help?");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/ai-chat/chat-123/message",
        {
          content: "Hello",
          stream: false,
        }
      );
    });
  });

  describe("stream", () => {
    it("should emit start event with messageId", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":""}\n\n',
        'data: {"content":"Hello"}\n\n',
        'data: {"content":" world"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const events: Array<{ type: string; messageId?: string }> = [];
      await client.stream("chat-123", "Hello", {
        onEvent: (event) => events.push(event as { type: string; messageId?: string }),
      });

      const startEvent = events.find((e) => e.type === "start");
      expect(startEvent).toBeDefined();
      expect(startEvent?.messageId).toBe("msg-123");
    });

    it("should accumulate content from chunks", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":""}\n\n',
        'data: {"content":"Hello"}\n\n',
        'data: {"content":" "}\n\n',
        'data: {"content":"world"}\n\n',
        'data: {"content":"!"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const chunks: string[] = [];
      const result = await client.stream("chat-123", "Hello", {
        onChunk: (content) => chunks.push(content),
      });

      expect(chunks.join("")).toBe("Hello world!");
      expect(result.content).toBe("Hello world!");
    });

    it("should emit context event when context arrives", async () => {
      const context = [
        { vectorId: "vec-1", content: "Test context" },
        { vectorId: "vec-2", content: "More context" },
      ];

      const sseChunks = [
        'data: {"messageId":"msg-123","content":""}\n\n',
        `data: {"context":${JSON.stringify(context)}}\n\n`,
        'data: {"content":"Based on the context..."}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const events: Array<{ type: string; context?: unknown }> = [];
      const result = await client.stream("chat-123", "Hello", {
        onEvent: (event) => events.push(event as { type: string; context?: unknown }),
      });

      const contextEvent = events.find((e) => e.type === "context");
      expect(contextEvent).toBeDefined();
      expect(contextEvent?.context).toEqual(context);
      expect(result.context).toEqual(context);
    });

    it("should emit done event with complete message", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":""}\n\n',
        'data: {"content":"Hello world"}\n\n',
        'data: {"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":5}}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const events: Array<{
        type: string;
        message?: { content: string };
        usage?: { promptTokens: number };
      }> = [];
      await client.stream("chat-123", "Hello", {
        onEvent: (event) =>
          events.push(
            event as {
              type: string;
              message?: { content: string };
              usage?: { promptTokens: number };
            }
          ),
      });

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.message?.content).toBe("Hello world");
      expect(doneEvent?.usage?.promptTokens).toBe(10);
    });

    it("should handle [DONE] marker", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":"Test"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      // Should not throw
      const result = await client.stream("chat-123", "Hello");
      expect(result.content).toBe("Test");
    });

    it("should handle malformed JSON chunks gracefully", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":""}\n\n',
        'data: {"content":"Hello"}\n\n',
        "data: {invalid json}\n\n", // Malformed
        'data: {"content":" world"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      // Should not throw, just skip the malformed chunk
      const result = await client.stream("chat-123", "Hello");
      expect(result.content).toBe("Hello world");
    });

    it("should call onComplete callback", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":"Done"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const onComplete = vi.fn();
      await client.stream("chat-123", "Hello", { onComplete });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Done",
          role: "assistant",
        })
      );
    });

    it("should handle stream error response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        createMockResponse({
          status: 400,
          ok: false,
          body: { code: "VALIDATION_ERROR", message: "Invalid input" },
        })
      );

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const onError = vi.fn();
      await expect(
        client.stream("chat-123", "Hello", { onError })
      ).rejects.toThrow(DivinciError);

      expect(onError).toHaveBeenCalled();
    });

    it("should throw StreamError when response has no body", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        headers: new Headers({ "content-type": "text/event-stream" }),
      });

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      await expect(client.stream("chat-123", "Hello")).rejects.toThrow(StreamError);
    });

    it("should include Authorization header with token", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":"Test"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      const mockFetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));
      globalThis.fetch = mockFetch;

      const mockHttpClient = createMockHttpClient();
      mockHttpClient.getToken = vi.fn().mockResolvedValue("bearer-token-123");

      const client = new ChatClient(mockHttpClient, "release-456");
      await client.stream("chat-123", "Hello");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer bearer-token-123",
          }),
        })
      );
    });
  });

  describe("processStream - edge cases", () => {
    it("should handle split chunks across reads", async () => {
      // Simulate chunks being split in the middle of a message
      const sseChunks = [
        'data: {"messageId":"msg-123","con',
        'tent":"Hello"}\n\n',
        'data: {"content":" world"}\n\ndata: {"fini',
        'shReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const result = await client.stream("chat-123", "Hello");
      expect(result.content).toBe("Hello world");
    });

    it("should construct message when no finish event", async () => {
      const sseChunks = [
        'data: {"messageId":"msg-123","content":"Partial"}\n\n',
        'data: {"content":" response"}\n\n',
        // No finishReason, stream just ends
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const result = await client.stream("chat-123", "Hello");
      expect(result.content).toBe("Partial response");
      expect(result.role).toBe("assistant");
      expect(result.id).toBe("msg-123");
    });

    it("should generate message ID if none provided", async () => {
      const sseChunks = [
        'data: {"content":"Response without messageId"}\n\n',
        'data: {"finishReason":"stop"}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createStreamingResponse(sseChunks));

      const mockHttpClient = createMockHttpClient();
      const client = new ChatClient(mockHttpClient, "release-456");

      const result = await client.stream("chat-123", "Hello");
      expect(result.id).toBeDefined();
      expect(result.id.length).toBeGreaterThan(0);
    });
  });

  describe("getTranscript", () => {
    it("should get all messages in chat", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        messages: [
          { id: "msg-1", role: "user", content: "Hello" },
          { id: "msg-2", role: "assistant", content: "Hi there!" },
        ],
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      const messages = await client.getTranscript("chat-123");

      expect(messages).toHaveLength(2);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/ai-chat/chat-123/transcript"
      );
    });
  });

  describe("createAnonymous", () => {
    it("should create anonymous chat session", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        id: "anon-chat-123",
        isAnonymous: true,
      });

      const client = new ChatClient(mockHttpClient, "release-456");
      const result = await client.createAnonymous();

      expect(result.id).toBe("anon-chat-123");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/ai-chat/anonymous-chat",
        { releaseId: "release-456" }
      );
    });
  });
});
