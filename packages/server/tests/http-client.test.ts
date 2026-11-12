/**
 * ServerHttpClient tests
 *
 * Tests for the server-side HTTP client including API key auth, uploads, and retry logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServerHttpClient, ServerApiError } from "../src/http-client.js";
import { createMockFetch, createMockResponse, createNetworkErrorFetch } from "./mocks/fetch.js";

describe("ServerHttpClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should throw if API key not provided", () => {
      expect(() => {
        new ServerHttpClient({ baseUrl: "https://api.test.com" } as never);
      }).toThrow("API key or access token is required for server SDK");
    });

    it("should accept API key", () => {
      const client = new ServerHttpClient({ apiKey: "test-key" });
      expect(client).toBeDefined();
    });

    it("should merge config with defaults", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        baseUrl: "https://custom.api.com",
      });

      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://custom.api.com"),
        expect.any(Object)
      );
    });
  });

  describe("buildHeaders", () => {
    it("should include X-API-Key header", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "my-api-key" });
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "my-api-key",
          }),
        })
      );
    });

    it("should include X-API-Version when configured", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        apiVersion: "2024-01-01",
      });
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Version": "2024-01-01",
          }),
        })
      );
    });

    it("should include custom headers", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        headers: { "X-Custom": "value" },
      });
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Custom": "value",
          }),
        })
      );
    });
  });

  describe("buildUrl", () => {
    it("should build URL with path", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.get("/api/v1/test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.divinci.app/api/v1/test",
        expect.any(Object)
      );
    });

    it("should append query params", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.get("/test", { foo: "bar", num: 123 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("foo=bar");
      expect(calledUrl).toContain("num=123");
    });

    it("should skip undefined params", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.get("/test", { foo: "bar", skip: undefined });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("foo=bar");
      expect(calledUrl).not.toContain("skip");
    });
  });

  describe("HTTP methods", () => {
    it("should make GET request", async () => {
      const mockFetch = createMockFetch({ body: { data: "test" } });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const result = await client.get<{ data: string }>("/test");

      expect(result).toEqual({ data: "test" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("should make POST request with body", async () => {
      const mockFetch = createMockFetch({ body: { id: "123" } });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const result = await client.post<{ id: string }>("/test", { name: "foo" });

      expect(result).toEqual({ id: "123" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "foo" }),
        })
      );
    });

    it("should make PUT request", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.put("/test", { name: "bar" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "bar" }),
        })
      );
    });

    it("should make PATCH request", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.patch("/test", { name: "baz" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "baz" }),
        })
      );
    });

    it("should make DELETE request", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.delete("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("upload", () => {
    it("should construct FormData with file", async () => {
      const mockFetch = createMockFetch({ body: { id: "doc-123" } });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const fileContent = Buffer.from("test file content");

      await client.upload("/upload", fileContent, "test.txt");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/upload"),
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );

      // Verify FormData contents
      const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
      const formData = callArgs.body as FormData;
      expect(formData.get("file")).toBeDefined();
    });

    it("should add additional fields to FormData", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const fileContent = Buffer.from("content");

      await client.upload("/upload", fileContent, "test.txt", {
        collectionId: "col-123",
        metadata: '{"key":"value"}',
      });

      const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
      const formData = callArgs.body as FormData;
      expect(formData.get("collectionId")).toBe("col-123");
      expect(formData.get("metadata")).toBe('{"key":"value"}');
    });

    it("should not set Content-Type header (let browser set multipart boundary)", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      await client.upload("/upload", Buffer.from("content"), "test.txt");

      const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = callArgs.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("should include API key in upload headers", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "upload-key" });
      await client.upload("/upload", Buffer.from("content"), "test.txt");

      const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = callArgs.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("upload-key");
    });

    it("should handle Blob input", async () => {
      const mockFetch = createMockFetch({ body: { id: "doc-456" } });
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const blob = new Blob(["blob content"], { type: "text/plain" });

      const result = await client.upload<{ id: string }>("/upload", blob, "blob.txt");

      expect(result).toEqual({ id: "doc-456" });
    });
  });

  describe("retry logic", () => {
    it("should retry on network errors up to maxRetries", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(createMockResponse({ body: { success: true } }));

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        maxRetries: 3,
      });

      const resultPromise = client.get("/test");

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should throw after max retries exceeded", async () => {
      const mockFetch = createNetworkErrorFetch();
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        maxRetries: 2,
      });

      const resultPromise = client.get("/test");

      // Suppress unhandled rejection warning
      resultPromise.catch(() => {});

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow(ServerApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should retry 429 with retry-after header", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 429,
            ok: false,
            headers: { "retry-after": "3" },
            body: { code: "RATE_LIMITED", message: "Too many requests" },
          })
        )
        .mockResolvedValueOnce(createMockResponse({ body: { success: true } }));

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        maxRetries: 3,
      });

      const resultPromise = client.get("/test");

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should retry 500+ errors with backoff", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 503,
            ok: false,
            body: { code: "SERVICE_UNAVAILABLE", message: "Try again" },
          })
        )
        .mockResolvedValueOnce(createMockResponse({ body: { success: true } }));

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        maxRetries: 3,
      });

      const resultPromise = client.get("/test");

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry 4xx errors (except 429)", async () => {
      const mockFetch = createMockFetch({
        status: 400,
        ok: false,
        body: { code: "BAD_REQUEST", message: "Invalid input" },
      });

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        maxRetries: 3,
      });

      await expect(client.get("/test")).rejects.toThrow(ServerApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should throw timeout error", async () => {
      // Mock fetch that respects the abort signal
      const mockFetch = vi.fn().mockImplementation(
        (_url: string, options?: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (options?.signal) {
              options.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }
          })
      );
      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({
        apiKey: "test-key",
        timeout: 1000,
      });

      const resultPromise = client.get("/test");

      // Suppress unhandled rejection warning
      resultPromise.catch(() => {});

      await vi.advanceTimersByTimeAsync(1001);

      await expect(resultPromise).rejects.toThrow("timed out");
    });
  });

  describe("error handling", () => {
    it("should extract error details from response", async () => {
      const mockFetch = createMockFetch({
        status: 400,
        ok: false,
        body: {
          code: "VALIDATION_ERROR",
          message: "Field is required",
          details: { field: "name" },
        },
      });

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });

      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("VALIDATION_ERROR");
        expect((error as ServerApiError).message).toBe("Field is required");
        expect((error as ServerApiError).details).toEqual({ field: "name" });
      }
    });

    /**
     * The API speaks three error shapes. v1 wraps as
     * `{ error: { code, message } }`; the tenant-scoped routes answer with a
     * flat `{ error: "..." }`; the SSRF pre-gates answer
     * `{ status: "denied", reason: "..." }`. Only the first carries `message`,
     * and most throw sites fall through to the literal "API request failed"
     * without it — so tenant-route failures reached the CLI with the server's
     * explanation discarded ("API error (409): API request failed").
     */
    it("surfaces a flat string error body (tenant routes)", async () => {
      globalThis.fetch = createMockFetch({
        status: 409,
        ok: false,
        body: { error: "A sync job is already in progress", jobId: "job_1" },
      });

      const client = new ServerHttpClient({ apiKey: "test-key", maxRetries: 0 });

      try {
        await client.post("/test", {});
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as ServerApiError).message).toBe("A sync job is already in progress");
        // The extra fields stay reachable — jobId is what a caller retries on.
        expect((error as ServerApiError).body).toMatchObject({ jobId: "job_1" });
      }
    });

    it("surfaces a `reason` body (SSRF denials)", async () => {
      globalThis.fetch = createMockFetch({
        status: 403,
        ok: false,
        body: { status: "denied", reason: "private ip literal" },
      });

      const client = new ServerHttpClient({ apiKey: "test-key", maxRetries: 0 });

      try {
        await client.post("/test", {});
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as ServerApiError).message).toBe("private ip literal");
      }
    });

    it("still prefers a wrapped message when both could apply", async () => {
      // A wrapped body is the richer shape; the string fallbacks must not
      // shadow it.
      globalThis.fetch = createMockFetch({
        status: 400,
        ok: false,
        body: { error: { code: "X", message: "wrapped wins" }, reason: "ignored" },
      });

      const client = new ServerHttpClient({ apiKey: "test-key", maxRetries: 0 });

      try {
        await client.post("/test", {});
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as ServerApiError).message).toBe("wrapped wins");
      }
    });

    it("should extract requestId from headers", async () => {
      const mockFetch = createMockFetch({
        status: 500,
        ok: false,
        headers: { "x-request-id": "req-abc123" },
        body: { code: "INTERNAL_ERROR", message: "Something went wrong" },
      });

      globalThis.fetch = mockFetch;

      // Disable retries so we can test error handling directly
      const client = new ServerHttpClient({ apiKey: "test-key", maxRetries: 0 });

      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as ServerApiError).requestId).toBe("req-abc123");
      }
    });

    it("should handle non-JSON error response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
      });

      globalThis.fetch = mockFetch;

      // Disable retries so we can test error handling directly
      const client = new ServerHttpClient({ apiKey: "test-key", maxRetries: 0 });

      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("UNKNOWN_ERROR");
      }
    });
  });

  describe("handleResponse - success", () => {
    it("should parse JSON response", async () => {
      const mockFetch = createMockFetch({
        body: { data: "test", items: [1, 2, 3] },
      });

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const result = await client.get<{ data: string; items: number[] }>("/test");

      expect(result).toEqual({ data: "test", items: [1, 2, 3] });
    });

    it("should return undefined for non-JSON response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers({ "content-type": "text/plain" }),
        json: vi.fn(),
      });

      globalThis.fetch = mockFetch;

      const client = new ServerHttpClient({ apiKey: "test-key" });
      const result = await client.delete("/test");

      expect(result).toBeUndefined();
    });
  });
});
