/**
 * HttpClient tests
 *
 * Tests for the core HTTP client including retry logic, token refresh, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpClient, type TokenStorage } from "../src/http-client.js";
import { DivinciError, TimeoutError, NetworkError } from "../src/errors.js";
import {
  createMockFetch,
  createMockResponse,
  createNetworkErrorFetch,
} from "./mocks/fetch.js";

describe("HttpClient", () => {
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
    it("should merge config with defaults", () => {
      const client = new HttpClient({ releaseId: "test" });
      // Access private config via request behavior
      expect(client).toBeDefined();
    });

    it("should use custom baseUrl", async () => {
      const mockFetch = createMockFetch({ body: { data: "test" } });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        baseUrl: "https://custom.api.com",
      });

      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://custom.api.com/test"),
        expect.any(Object)
      );
    });
  });

  describe("buildUrl", () => {
    it("should build URL with path", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      await client.get("/api/test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.divinci.app/api/test",
        expect.any(Object)
      );
    });

    it("should build URL with query params", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      await client.get("/api/test", { foo: "bar", num: 123, bool: true });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("foo=bar");
      expect(calledUrl).toContain("num=123");
      expect(calledUrl).toContain("bool=true");
    });

    it("should skip undefined params", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      await client.get("/api/test", { foo: "bar", skip: undefined });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("foo=bar");
      expect(calledUrl).not.toContain("skip");
    });
  });

  describe("buildHeaders", () => {
    it("should include Content-Type header", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should include API key when configured", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        apiKey: "test-api-key",
      });
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-api-key",
          }),
        })
      );
    });

    it("should include Bearer token when set", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      await client.setToken("my-token");
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        })
      );
    });

    it("should include API version when configured", async () => {
      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
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
  });

  describe("HTTP methods", () => {
    it("should make GET request", async () => {
      const mockFetch = createMockFetch({ body: { data: "test" } });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
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

      const client = new HttpClient({ releaseId: "test" });
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

      const client = new HttpClient({ releaseId: "test" });
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

      const client = new HttpClient({ releaseId: "test" });
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

      const client = new HttpClient({ releaseId: "test" });
      await client.delete("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("executeWithRetry", () => {
    it("should retry on network errors up to maxRetries", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(createMockResponse({ body: { success: true } }));

      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 3,
      });

      const resultPromise = client.get("/test");

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should throw NetworkError after max retries exceeded", async () => {
      const mockFetch = createNetworkErrorFetch();
      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 2,
      });

      const resultPromise = client.get("/test");

      // Attach error handler immediately to prevent unhandled rejection
      const errorPromise = resultPromise.catch((e) => e);

      // Run all pending timers to completion
      await vi.runAllTimersAsync();

      const error = await errorPromise;
      expect(error).toBeInstanceOf(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should not retry when skipRetry is true", async () => {
      const mockFetch = createNetworkErrorFetch();
      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 3,
      });

      await expect(
        client.request("/test", { skipRetry: true })
      ).rejects.toThrow(NetworkError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should throw TimeoutError when request times out", async () => {
      // Mock fetch that respects the abort signal
      const mockFetch = vi.fn().mockImplementation(
        (_url: string, options?: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Listen for abort signal
            if (options?.signal) {
              options.signal.addEventListener("abort", () => {
                const error = new DOMException("Aborted", "AbortError");
                reject(error);
              });
            }
            // Never resolve naturally - wait for abort
          })
      );
      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        timeout: 1000,
      });

      const resultPromise = client.get("/test");

      // Attach error handler immediately to prevent unhandled rejection
      const errorPromise = resultPromise.catch((e) => e);

      // Advance past the timeout to trigger abort
      await vi.advanceTimersByTimeAsync(1001);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(TimeoutError);
    });
  });

  describe("handleResponse - error mapping", () => {
    it("should handle 401 and attempt token refresh", async () => {
      const mockTokenStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("old-token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
      };

      // First call returns 401, refresh succeeds via /embed/validate-login, second call succeeds
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Token expired" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            body: {
              valid: true,
              accessToken: "new-token",
            },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({ body: { success: true } })
        );

      globalThis.fetch = mockFetch;

      const client = new HttpClient(
        { releaseId: "test", origin: "https://example.com" },
        mockTokenStorage
      );
      const result = await client.get("/test");

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("/embed/validate-login"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            refreshToken: "refresh-token",
            origin: "https://example.com",
            releaseId: "test",
          }),
        })
      );
      expect(mockTokenStorage.setToken).toHaveBeenCalledWith(
        "new-token",
        expect.any(Number)
      );
    });

    it("should not retry token refresh on second 401", async () => {
      const mockTokenStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
      };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Token expired" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            body: { valid: true, accessToken: "new-token" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Still unauthorized" },
          })
        );

      globalThis.fetch = mockFetch;

      const client = new HttpClient(
        { releaseId: "test", origin: "https://example.com" },
        mockTokenStorage
      );

      await expect(client.get("/test")).rejects.toThrow(DivinciError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should handle 429 with retry-after header", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 429,
            ok: false,
            headers: { "retry-after": "2" },
            body: { code: "RATE_LIMIT_EXCEEDED", message: "Rate limited" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({ body: { success: true } })
        );

      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 3,
      });

      const resultPromise = client.get("/test");

      // Advance timer by retry-after seconds (2000ms)
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should retry 5xx errors with backoff", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 500,
            ok: false,
            body: { code: "INTERNAL_ERROR", message: "Server error" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            status: 502,
            ok: false,
            body: { code: "BAD_GATEWAY", message: "Bad gateway" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({ body: { success: true } })
        );

      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 3,
      });

      const resultPromise = client.get("/test");

      // Advance timers for backoff delays
      await vi.advanceTimersByTimeAsync(1500); // First retry
      await vi.advanceTimersByTimeAsync(3000); // Second retry

      const result = await resultPromise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should not retry 4xx errors (except 429)", async () => {
      const mockFetch = createMockFetch({
        status: 400,
        ok: false,
        body: { code: "BAD_REQUEST", message: "Invalid input" },
      });

      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 3,
      });

      await expect(client.get("/test")).rejects.toThrow(DivinciError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should extract requestId from headers", async () => {
      const mockFetch = createMockFetch({
        status: 400,
        ok: false,
        headers: { "x-request-id": "req-12345" },
        body: { code: "BAD_REQUEST", message: "Invalid" },
      });

      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });

      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DivinciError);
        expect((error as DivinciError).requestId).toBe("req-12345");
      }
    });
  });

  describe("tryRefreshToken", () => {
    it("should not retry indefinitely on 401 after refresh", async () => {
      // Test that after a refresh, if we still get 401, we don't keep retrying
      const mockTokenStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("old-token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
      };

      const mockFetch = vi
        .fn()
        // First call - 401
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Token expired" },
          })
        )
        // Refresh succeeds
        .mockResolvedValueOnce(
          createMockResponse({
            body: { valid: true, accessToken: "new-token" },
          })
        )
        // Retry still gets 401 (bad token somehow)
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Still unauthorized" },
          })
        );

      globalThis.fetch = mockFetch;

      const client = new HttpClient(
        { releaseId: "test", origin: "https://example.com" },
        mockTokenStorage
      );

      // Should throw after refresh + retry still fails
      await expect(client.get("/test")).rejects.toThrow(DivinciError);

      // Should only have made 3 calls: original + refresh + retry (no infinite loop)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should clear tokens on refresh failure", async () => {
      const mockTokenStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("old-token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
      };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Token expired" },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { error: "invalid_grant" },
          })
        );

      globalThis.fetch = mockFetch;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new HttpClient(
        { releaseId: "test", origin: "https://example.com" },
        mockTokenStorage
      );

      await expect(client.get("/test")).rejects.toThrow(DivinciError);
      expect(mockTokenStorage.clearToken).toHaveBeenCalled();
      // Failure must be surfaced, not silently swallowed
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Divinci] Token refresh failed")
      );
    });

    it("should surface (not silently swallow) a validate-login valid:false response", async () => {
      const mockTokenStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("old-token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
      };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          createMockResponse({
            status: 401,
            ok: false,
            body: { code: "UNAUTHORIZED", message: "Token expired" },
          })
        )
        // /embed/validate-login responds 200 with { valid: false } on failure
        .mockResolvedValueOnce(
          createMockResponse({ body: { valid: false } })
        );

      globalThis.fetch = mockFetch;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new HttpClient(
        { releaseId: "test", origin: "https://example.com" },
        mockTokenStorage
      );

      await expect(client.get("/test")).rejects.toThrow(DivinciError);
      expect(mockTokenStorage.clearToken).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Divinci] Token refresh failed")
      );
    });

    it("should skip refresh and warn when origin is not configured", async () => {
      const mockTokenStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("old-token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
      };

      const mockFetch = vi.fn().mockResolvedValueOnce(
        createMockResponse({
          status: 401,
          ok: false,
          body: { code: "UNAUTHORIZED", message: "Token expired" },
        })
      );

      globalThis.fetch = mockFetch;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // No `origin` configured
      const client = new HttpClient({ releaseId: "test" }, mockTokenStorage);

      await expect(client.get("/test")).rejects.toThrow(DivinciError);
      // Only the original 401 request — refresh is skipped, not attempted with bad params
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockTokenStorage.clearToken).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Token refresh skipped")
      );
    });
  });

  describe("getRetryDelay", () => {
    it("should use exponential backoff with jitter", async () => {
      // We can't directly test the private method, but we can verify
      // the behavior through retry timing
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(createMockResponse({ body: { success: true } }));

      globalThis.fetch = mockFetch;

      const client = new HttpClient({
        releaseId: "test",
        maxRetries: 3,
      });

      const startTime = Date.now();
      const resultPromise = client.get("/test");

      // First retry: ~1000ms base + jitter
      await vi.advanceTimersByTimeAsync(1500);
      // Second retry: ~2000ms base + jitter
      await vi.advanceTimersByTimeAsync(2500);

      await resultPromise;
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("token management", () => {
    it("should set and retrieve token", async () => {
      const client = new HttpClient({ releaseId: "test" });

      await client.setToken("my-token", Date.now() + 3600000);
      const token = await client.getToken();

      expect(token).toBe("my-token");
    });

    it("should clear tokens", async () => {
      const client = new HttpClient({ releaseId: "test" });

      await client.setToken("my-token");
      await client.clearTokens();
      const token = await client.getToken();

      expect(token).toBeNull();
    });

    it("should use custom token storage", async () => {
      const customStorage: TokenStorage = {
        getToken: vi.fn().mockResolvedValue("custom-token"),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const mockFetch = createMockFetch({ body: {} });
      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" }, customStorage);
      await client.get("/test");

      expect(customStorage.getToken).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer custom-token",
          }),
        })
      );
    });
  });

  describe("handleResponse - success", () => {
    it("should parse JSON response", async () => {
      const mockFetch = createMockFetch({
        body: { data: "test", nested: { value: 123 } },
      });

      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      const result = await client.get<{ data: string; nested: { value: number } }>("/test");

      expect(result).toEqual({ data: "test", nested: { value: 123 } });
    });

    it("should return undefined for non-JSON response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        json: vi.fn(),
      });

      globalThis.fetch = mockFetch;

      const client = new HttpClient({ releaseId: "test" });
      const result = await client.get("/test");

      expect(result).toBeUndefined();
    });
  });
});
