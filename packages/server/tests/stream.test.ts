/**
 * ServerHttpClient.stream() tests
 *
 * Tests for SSE streaming: content yielding, metadata resolution,
 * error handling, timeout, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServerHttpClient, ServerApiError } from "../src/http-client.js";

/**
 * Helper: create a ReadableStream from SSE event strings.
 * Each string in `events` is encoded and pushed as a chunk.
 */
function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(encoder.encode(events[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Helper: create a mock Response with an SSE body stream.
 */
function createSSEResponse(
  events: string[],
  options: {
    status?: number;
    ok?: boolean;
    headers?: Record<string, string>;
  } = {}
): Response {
  const { status = 200, ok = true, headers = {} } = options;
  const responseHeaders = new Headers({
    "content-type": "text/event-stream",
    ...headers,
  });

  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: responseHeaders,
    body: createSSEStream(events),
    text: vi.fn().mockResolvedValue(events.join("")),
    json: vi.fn().mockResolvedValue({}),
    clone: vi.fn(),
    bodyUsed: false,
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    bytes: vi.fn(),
  } as unknown as Response;
}

describe("ServerHttpClient.stream()", () => {
  let originalFetch: typeof fetch;
  let client: ServerHttpClient;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new ServerHttpClient({ apiKey: "test-key", timeout: 5000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("basic streaming", () => {
    it("should yield content strings from SSE events", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":"Hello"}\n\n',
        'data: {"content":" world"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat", { body: { message: "hi" } });
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Hello", " world"]);
    });

    it("should yield raw data when not valid JSON", async () => {
      const mockResponse = createSSEResponse([
        "data: plain text chunk\n\n",
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["plain text chunk"]);
    });

    it("should handle multiple data lines in a single chunk", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":"A"}\n\ndata: {"content":"B"}\n\ndata: {"content":"C"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["A", "B", "C"]);
    });

    it("should handle split chunks across reads", async () => {
      // Simulate data split across two read() calls
      const mockResponse = createSSEResponse([
        'data: {"conte',
        'nt":"split"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["split"]);
    });

    it("should stop on [DONE] sentinel", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":"before"}\n\n',
        "data: [DONE]\n\n",
        'data: {"content":"after"}\n\n',
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["before"]);
    });

    it("should handle stream ending without [DONE]", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":"only"}\n\n',
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["only"]);
    });

    it("should skip non-data lines", async () => {
      const mockResponse = createSSEResponse([
        ': this is a comment\n\n',
        'event: message\ndata: {"content":"real"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["real"]);
    });
  });

  describe("metadata", () => {
    it("should resolve metadata from done event", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":"hi"}\n\n',
        'data: {"done":true,"transcriptId":"tx-123"}\n\n',
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const meta = await stream.metadata;
      expect(meta).toEqual({ done: true, transcriptId: "tx-123" });
      expect(chunks).toEqual(["hi"]);
    });

    it("should resolve metadata from x-transcript-id header", async () => {
      const mockResponse = createSSEResponse(
        [
          'data: {"content":"hi"}\n\n',
          "data: [DONE]\n\n",
        ],
        { headers: { "x-transcript-id": "hdr-456" } }
      );
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      const meta = await stream.metadata;
      expect(meta).toEqual({ transcriptId: "hdr-456" });
    });

    it("should resolve empty metadata when no metadata present", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":"hi"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      const meta = await stream.metadata;
      expect(meta).toEqual({});
    });

    it("should resolve empty metadata when response has no body", async () => {
      const responseHeaders = new Headers({ "content-type": "text/event-stream" });
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: responseHeaders,
        body: null,
        text: vi.fn(),
        json: vi.fn(),
        clone: vi.fn(),
        bodyUsed: false,
        redirected: false,
        type: "basic" as ResponseType,
        url: "",
        arrayBuffer: vi.fn(),
        blob: vi.fn(),
        formData: vi.fn(),
        bytes: vi.fn(),
      } as unknown as Response;

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      const meta = await stream.metadata;
      expect(meta).toEqual({});
    });

    it("should prefer header metadata over [DONE] fallback", async () => {
      const mockResponse = createSSEResponse(
        [
          'data: {"content":"hi"}\n\n',
          "data: [DONE]\n\n",
        ],
        { headers: { "x-transcript-id": "from-header" } }
      );
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      const meta = await stream.metadata;
      expect(meta).toEqual({ transcriptId: "from-header" });
    });
  });

  describe("request construction", () => {
    it("should default to POST method", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createSSEResponse(["data: [DONE]\n\n"])
      );
      globalThis.fetch = mockFetch;

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should set Accept: text/event-stream header", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createSSEResponse(["data: [DONE]\n\n"])
      );
      globalThis.fetch = mockFetch;

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Accept": "text/event-stream",
          }),
        })
      );
    });

    it("should include API key header", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createSSEResponse(["data: [DONE]\n\n"])
      );
      globalThis.fetch = mockFetch;

      const stream = client.stream("/chat");
      for await (const _ of stream) { /* consume */ }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-key",
          }),
        })
      );
    });

    it("should serialize body as JSON", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createSSEResponse(["data: [DONE]\n\n"])
      );
      globalThis.fetch = mockFetch;

      const stream = client.stream("/chat", {
        body: { message: "hello", stream: true },
      });
      for await (const _ of stream) { /* consume */ }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ message: "hello", stream: true }),
        })
      );
    });

    it("should build URL with query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createSSEResponse(["data: [DONE]\n\n"])
      );
      globalThis.fetch = mockFetch;

      const stream = client.stream("/chat", {
        params: { model: "gpt-4", temperature: 0.7 },
      });
      for await (const _ of stream) { /* consume */ }

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("model=gpt-4");
      expect(calledUrl).toContain("temperature=0.7");
    });
  });

  describe("error handling", () => {
    it("should throw ServerApiError on non-ok response", async () => {
      const mockResponse = createSSEResponse([], {
        status: 401,
        ok: false,
      });
      // Override text() to return error JSON
      mockResponse.text = vi.fn().mockResolvedValue(
        JSON.stringify({ code: "UNAUTHORIZED", message: "Invalid API key" })
      );
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).message).toBe("Invalid API key");
        expect((error as ServerApiError).code).toBe("UNAUTHORIZED");
      }

      // Suppress unhandled rejection from metadata
      stream.metadata.catch(() => {});
    });

    it("should reject metadata promise on error", async () => {
      const mockResponse = createSSEResponse([], {
        status: 500,
        ok: false,
      });
      mockResponse.text = vi.fn().mockResolvedValue(
        JSON.stringify({ code: "INTERNAL_ERROR", message: "Server error" })
      );
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");

      // Consume to trigger the error
      try {
        for await (const _ of stream) { /* consume */ }
      } catch {
        // expected
      }

      try {
        await stream.metadata;
        expect.fail("Should have rejected");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
      }
    });

    it("should wrap network errors as NETWORK_ERROR", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError("fetch failed")
      );

      const stream = client.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("NETWORK_ERROR");
      }

      stream.metadata.catch(() => {});
    });

    it("should reject metadata on network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError("fetch failed")
      );

      const stream = client.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
      } catch {
        // expected
      }

      try {
        await stream.metadata;
        expect.fail("Should have rejected");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("NETWORK_ERROR");
      }
    });

    it("should extract requestId from error response headers", async () => {
      const mockResponse = createSSEResponse([], {
        status: 400,
        ok: false,
        headers: { "x-request-id": "req-err-789" },
      });
      mockResponse.text = vi.fn().mockResolvedValue(
        JSON.stringify({ code: "BAD_REQUEST", message: "Bad input" })
      );
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as ServerApiError).requestId).toBe("req-err-789");
      }

      stream.metadata.catch(() => {});
    });

    it("should handle non-JSON error response gracefully", async () => {
      const mockResponse = createSSEResponse([], {
        status: 502,
        ok: false,
      });
      mockResponse.text = vi.fn().mockResolvedValue("<html>Bad Gateway</html>");
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("UNKNOWN_ERROR");
      }

      stream.metadata.catch(() => {});
    });
  });

  describe("timeout", () => {
    it("should wrap AbortError as TIMEOUT", async () => {
      // Mock fetch that never resolves, respects abort signal
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (options?.signal) {
              if (options.signal.aborted) {
                reject(new DOMException("Aborted", "AbortError"));
                return;
              }
              options.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }
          })
      );

      const shortTimeoutClient = new ServerHttpClient({
        apiKey: "test-key",
        timeout: 100,
      });

      const stream = shortTimeoutClient.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("TIMEOUT");
      }

      stream.metadata.catch(() => {});
    });

    it("should reject metadata on timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (options?.signal) {
              options.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }
          })
      );

      const shortTimeoutClient = new ServerHttpClient({
        apiKey: "test-key",
        timeout: 100,
      });

      const stream = shortTimeoutClient.stream("/chat");

      try {
        for await (const _ of stream) { /* consume */ }
      } catch {
        // expected
      }

      try {
        await stream.metadata;
        expect.fail("Should have rejected");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("TIMEOUT");
      }
    });
  });

  describe("external abort signal", () => {
    it("should respect external abort signal", async () => {
      const externalController = new AbortController();

      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (options?.signal) {
              // If already aborted, reject immediately
              if (options.signal.aborted) {
                reject(new DOMException("Aborted", "AbortError"));
                return;
              }
              options.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }
          })
      );

      const stream = client.stream("/chat", {
        signal: externalController.signal,
      });

      // Abort externally after a microtask to ensure listeners are set up
      setTimeout(() => externalController.abort(), 10);

      try {
        for await (const _ of stream) { /* consume */ }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("TIMEOUT");
      }

      // Suppress unhandled rejection from metadata
      stream.metadata.catch(() => {});
    });
  });

  describe("edge cases", () => {
    it("should handle empty stream (immediate [DONE])", async () => {
      const mockResponse = createSSEResponse(["data: [DONE]\n\n"]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
      const meta = await stream.metadata;
      expect(meta).toEqual({});
    });

    it("should handle JSON events without content field", async () => {
      const mockResponse = createSSEResponse([
        'data: {"type":"status","value":"thinking"}\n\n',
        'data: {"content":"answer"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Only the event with content should be yielded
      expect(chunks).toEqual(["answer"]);
    });

    it("should handle empty content strings", async () => {
      const mockResponse = createSSEResponse([
        'data: {"content":""}\n\n',
        'data: {"content":"real"}\n\n',
        "data: [DONE]\n\n",
      ]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");
      const chunks: string[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Empty string is still typeof string, so it should be yielded
      expect(chunks).toEqual(["", "real"]);
    });

    it("should return StreamResponse with metadata property", () => {
      const mockResponse = createSSEResponse(["data: [DONE]\n\n"]);
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const stream = client.stream("/chat");

      expect(stream).toBeDefined();
      expect(stream.metadata).toBeInstanceOf(Promise);
      expect(typeof stream.next).toBe("function");
      expect(typeof stream.return).toBe("function");
      expect(typeof stream.throw).toBe("function");
    });
  });
});
