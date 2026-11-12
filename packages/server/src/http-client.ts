/**
 * Server HTTP Client for Divinci API
 *
 * Node.js HTTP client with API key authentication
 */

import type { DivinciServerConfig, X402PaymentDetails } from "@divinci-ai/types";
import { validate, DivinciValidationError } from "@divinci-ai/types";
import type { ZodSchema } from "zod";
import { X402_PAYMENT_HEADER, extractPaymentDetails } from "./x402/header.js";

/**
 * Hook the HTTP client calls on a 402 to obtain an X-Payment header value
 * (or null to give up and surface the 402). Wired by DivinciServer to the
 * X402Client's auto-pay path; kept as a plain callback so the HTTP client
 * has no dependency on the x402 client (avoids a cycle).
 */
export type X402PayHook = (details: X402PaymentDetails) => Promise<string | null>;

/**
 * Idempotent HTTP methods that are safe to retry
 *
 * Per RFC 7231, idempotent methods can be safely retried because
 * making multiple identical requests has the same effect as a single request.
 *
 * - GET: Read-only, always safe to retry
 * - HEAD: Like GET but no body, safe to retry
 * - PUT: Replaces entire resource, idempotent by definition
 * - DELETE: Deleting twice has same effect as once
 * - OPTIONS: Preflight/info request, safe to retry
 *
 * NON-idempotent (NOT safe to retry):
 * - POST: Creates new resources - retry could create duplicates
 * - PATCH: Partial update - retry could apply partial changes twice
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

/**
 * Check if an HTTP method is idempotent (safe to retry)
 */
function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

/**
 * Divinci servers wrap error bodies as `{ error: { code, message, details } }`.
 * Unwrap to the inner object so code/message/details populate correctly; falls
 * back to the body itself for already-flat shapes. Without this, every wrapped
 * error surfaced as a generic "API request failed" and `details` (e.g. x402
 * payment requirements) was dropped.
 */
function unwrapErrorBody(errorData: Record<string, unknown>): Record<string, unknown> {
  const inner = errorData.error;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }

  // The API speaks THREE error shapes, not one. The wrapped
  // `{ error: { code, message } }` above is the v1 convention; the
  // tenant-scoped routes (`/white-label/:id/...`) answer with a flat
  // `{ error: "A sync job is already in progress", jobId }`, and the SSRF
  // pre-gates answer `{ status: "denied", reason: "private ip literal" }`.
  //
  // Neither of the latter two carries `message`, and three of this file's four
  // throw sites fall straight through to the literal "API request failed" when
  // it is absent — so every tenant-route failure reached the CLI with the
  // server's actual explanation discarded. Seen dogfooding on 2026-08-11:
  // `divinci connectors sync <id>` printed "API error (409): API request
  // failed" while the body said exactly which job was already running.
  //
  // Map both onto `message` so the server's own words survive. The original
  // body is still attached as `body` for callers that want the extra fields.
  if (typeof inner === "string" && inner.trim()) {
    return { ...errorData, message: inner };
  }
  if (typeof errorData.reason === "string" && errorData.reason.trim()) {
    return { ...errorData, message: errorData.reason };
  }
  return errorData;
}

/**
 * HTTP request options
 */
export interface RequestOptions<T = unknown> {
  /** HTTP method */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: unknown;
  /** Query parameters */
  params?: Record<string, string | number | boolean | undefined>;
  /** Request timeout in ms (overrides config) */
  timeout?: number;
  /** Skip retry logic */
  skipRetry?: boolean;
  /** Abort signal */
  signal?: AbortSignal;
  /** Zod schema for response validation */
  responseSchema?: ZodSchema<T>;
  /** Skip response validation (for performance-critical paths) */
  skipValidation?: boolean;
  /** @internal X-Payment header value injected on an x402 paid retry. */
  _x402PaymentHeader?: string;
  /** @internal Guard so an x402 retry happens at most once. */
  _x402Retried?: boolean;
}

/**
 * Streaming response: an async generator of content strings
 * with a `metadata` promise that resolves when the stream completes.
 */
export type StreamResponse = AsyncGenerator<string> & {
  metadata: Promise<Record<string, unknown>>;
};

/**
 * Server error class
 */
export class ServerApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  /** Raw parsed error body — carries canonical x402 `accepts[]` on a 402. */
  readonly body?: unknown;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      details?: Record<string, unknown>;
      requestId?: string;
      body?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "ServerApiError";
    this.code = options.code ?? "UNKNOWN_ERROR";
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

/**
 * Server HTTP Client class
 */
export class ServerHttpClient {
  /**
   * True when requests authenticate with an API key rather than a bearer
   * token. Route families differ by mode: `/api/v1/*` is mounted behind
   * `requireAPIKey()` and rejects a JWT, while `/white-label/:id/*` takes the
   * JWT. Header selection below prefers accessToken, so this must match it.
   */
  get usesApiKey(): boolean {
    return !this.config.accessToken && Boolean(this.config.apiKey);
  }

  private readonly config: Required<
    Pick<DivinciServerConfig, "baseUrl" | "timeout" | "maxRetries" | "debug" | "apiKey">
  > &
    DivinciServerConfig;

  /** Optional auto-pay hook invoked on a 402 (set by DivinciServer). */
  private x402PayHook?: X402PayHook;

  constructor(config: DivinciServerConfig) {
    if (!config.apiKey && !config.accessToken) {
      throw new Error("API key or access token is required for server SDK");
    }

    this.config = {
      baseUrl: "https://api.divinci.app",
      timeout: 30000,
      maxRetries: 3,
      debug: false,
      ...config,
    };
  }

  /**
   * Register the x402 auto-pay hook. When set, a 402 response triggers the
   * hook to produce an X-Payment header and the request is retried once.
   */
  setX402PayHook(hook: X402PayHook): void {
    this.x402PayHook = hook;
  }

  /**
   * Make an HTTP request
   */
  async request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const {
      method = "GET",
      headers = {},
      body,
      params,
      timeout = this.config.timeout,
      skipRetry = false,
      signal,
      responseSchema,
      skipValidation = false,
    } = options;

    const url = this.buildUrl(path, params);
    const requestHeaders = this.buildHeaders({
      ...headers,
      // On a paid retry, attach the proof. Set last so it can't be overridden.
      ...(options._x402PaymentHeader ? { [X402_PAYMENT_HEADER]: options._x402PaymentHeader } : {}),
    });

    const init: RequestInit = {
      method,
      headers: requestHeaders,
      signal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: T;
    try {
      response = await this.executeWithRetry<T>(url, init, {
        timeout,
        skipRetry,
        retryCount: 0,
        method,
      });
    } catch (err) {
      // x402: a 402 with auto-pay configured → pay once and retry. The guard
      // (_x402Retried) prevents loops if the retried call also 402s.
      if (
        err instanceof ServerApiError &&
        err.status === 402 &&
        this.x402PayHook &&
        !options._x402Retried
      ) {
        const details = extractPaymentDetails(err.body);
        if (details) {
          const paymentHeader = await this.x402PayHook(details);
          if (paymentHeader) {
            return this.request<T>(path, {
              ...options,
              _x402Retried: true,
              _x402PaymentHeader: paymentHeader,
            });
          }
        }
      }
      throw err;
    }

    // Validate response if schema provided and validation not skipped
    if (responseSchema && !skipValidation) {
      const validationResult = validate(responseSchema as any, response);
      if (!validationResult.success) {
        if (this.config.debug) {
          console.warn("[Divinci Server] Response validation failed:", validationResult.errors);
        }
        throw new DivinciValidationError(
          validationResult.errors,
          `Response from ${method} ${path}`,
          validationResult.zodError
        );
      }
      return validationResult.data as T;
    }

    return response;
  }

  /**
   * Make a GET request
   */
  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    // `timeout`/`skipRetry`/`signal` are forwarded to request() (which already
    // honors them) so callers can override the 30s default per call — e.g. the
    // slow `rag chunks`/all-chunks audit endpoint on v8 D1-backed vectors.
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation" | "timeout" | "skipRetry" | "signal">
  ): Promise<T> {
    return this.request<T>(path, { method: "GET", params, ...options });
  }

  /**
   * GET request returning the raw response body as text (no JSON parse).
   * `request()`/`handleResponse()` discard non-JSON bodies (return undefined),
   * so endpoints that emit YAML (e.g. the config export) need this raw path.
   */
  async getText(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<string> {
    const url = this.buildUrl(path, params);
    const headers = this.buildHeaders({});
    const response = await fetch(url, { method: "GET", headers });
    const text = await response.text();
    if (!response.ok) {
      let errorData: Record<string, unknown> = {
        code: "UNKNOWN_ERROR",
        message: response.statusText || "Unknown error",
      };
      try {
        errorData = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // non-JSON error body — keep the default + raw text below
      }
      const e = unwrapErrorBody(errorData);
      throw new ServerApiError((e.message as string) ?? text.substring(0, 200) ?? "API request failed", {
        code: (e.code as string) ?? "API_ERROR",
        status: response.status,
        details: e.details as Record<string, unknown>,
        requestId: response.headers.get("x-request-id") ?? undefined,
        body: errorData,
      });
    }
    return text;
  }

  /**
   * Make a POST request
   */
  async post<T>(
    path: string,
    body?: unknown,
    // `timeout` is forwarded like it is on get(): a POST that reaches a
    // cold-starting GPU service needs longer than the 30s default, and a POST
    // that times out has usually still committed.
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation" | "timeout" | "skipRetry" | "signal">
  ): Promise<T> {
    return this.request<T>(path, { method: "POST", body, ...options });
  }

  /**
   * Make a PUT request
   */
  async put<T>(
    path: string,
    body?: unknown,
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation">
  ): Promise<T> {
    return this.request<T>(path, { method: "PUT", body, ...options });
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(
    path: string,
    body?: unknown,
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation">
  ): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body, ...options });
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(
    path: string,
    body?: unknown,
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation">
  ): Promise<T> {
    return this.request<T>(path, { method: "DELETE", body, ...options });
  }

  /**
   * Stream an SSE (Server-Sent Events) response as an async iterable of content strings.
   *
   * Sends a request and parses the SSE stream, yielding each chunk's content.
   * The stream ends when a `data: [DONE]` sentinel is received or the response body closes.
   *
   * The final SSE event may contain metadata (e.g. transcriptId) as JSON with a `done` flag.
   * That metadata is not yielded but can be retrieved from the returned generator's `metadata` property
   * via the wrapper object.
   *
   * @returns An async generator that yields content strings plus a `metadata` promise.
   */
  stream(
    path: string,
    options: RequestOptions = {}
  ): StreamResponse {
    const {
      method = "POST",
      headers = {},
      body,
      params,
      timeout = this.config.timeout,
      signal,
    } = options;

    const url = this.buildUrl(path, params);
    const requestHeaders = this.buildHeaders({
      ...headers,
      "Accept": "text/event-stream",
    });

    const init: RequestInit = {
      method,
      headers: requestHeaders,
      signal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    // Metadata will be resolved when the stream completes, or rejected on error.
    // The resolve/reject functions are captured synchronously inside the Promise constructor,
    // so they are guaranteed to be assigned before `generate()` runs.
    let resolveMetadata: (value: Record<string, unknown>) => void = () => {};
    let rejectMetadata: (error: unknown) => void = () => {};
    const metadataPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      resolveMetadata = resolve;
      rejectMetadata = reject;
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    async function* generate(): AsyncGenerator<string> {
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorData: Record<string, unknown> = {
            code: "UNKNOWN_ERROR",
            message: response.statusText || "Unknown error",
          };
          try {
            const errorText = await response.text();
            errorData = JSON.parse(errorText) as Record<string, unknown>;
          } catch {
            // Keep default error data
          }
          const e = unwrapErrorBody(errorData);
          throw new ServerApiError(
            (e.message as string) ?? "API request failed",
            {
              code: (e.code as string) ?? "API_ERROR",
              status: response.status,
              details: e.details as Record<string, unknown>,
              requestId: response.headers.get("x-request-id") ?? undefined,
            }
          );
        }

        // Check for transcript ID in headers
        const headerTranscriptId = response.headers.get("x-transcript-id");
        if (headerTranscriptId) {
          resolveMetadata!({ transcriptId: headerTranscriptId });
        }

        if (!response.body) {
          resolveMetadata!({});
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let metadataResolved = !!headerTranscriptId;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events (separated by double newlines)
            const events = buffer.split("\n\n");
            // Keep the last (potentially incomplete) chunk in the buffer
            buffer = events.pop() ?? "";

            for (const event of events) {
              const lines = event.split("\n");
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;

                const data = line.slice(6); // Remove "data: " prefix

                // Check for [DONE] sentinel
                if (data === "[DONE]") {
                  if (!metadataResolved) {
                    resolveMetadata!({});
                  }
                  return;
                }

                // Try to parse as JSON
                try {
                  const parsed = JSON.parse(data) as Record<string, unknown>;

                  // Check if this is a final metadata event
                  if (parsed.done === true) {
                    if (!metadataResolved) {
                      metadataResolved = true;
                      resolveMetadata!(parsed);
                    }
                    return;
                  }

                  // Yield content if present
                  if (typeof parsed.content === "string") {
                    yield parsed.content;
                  }
                } catch {
                  // If not valid JSON, yield the raw data as content
                  yield data;
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        // Ensure metadata is always resolved
        if (!metadataResolved) {
          resolveMetadata!({});
        }
      } catch (error) {
        clearTimeout(timeoutId);

        let wrappedError = error;

        if (error instanceof DOMException && error.name === "AbortError") {
          wrappedError = new ServerApiError(`Stream request timed out after ${timeout}ms`, {
            code: "TIMEOUT",
          });
        } else if (error instanceof TypeError && error.message.includes("fetch")) {
          wrappedError = new ServerApiError(`Network error: ${error.message}`, {
            code: "NETWORK_ERROR",
          });
        }

        // Reject metadata promise so callers awaiting it don't hang
        rejectMetadata(wrappedError);
        throw wrappedError;
      }
    }

    const generator = generate();
    return Object.assign(generator, { metadata: metadataPromise });
  }

  /**
   * Upload a file (multipart/form-data)
   */
  async upload<T>(
    path: string,
    file: Buffer | Blob,
    fileName: string,
    additionalFields?: Record<string, string>
  ): Promise<T> {
    const url = this.buildUrl(path);

    const formData = new FormData();

    // Add file
    const blob = file instanceof Blob ? file : new Blob([file]);
    formData.append("file", blob, fileName);

    // Add additional fields
    if (additionalFields) {
      Object.entries(additionalFields).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const headers: Record<string, string> = {};

    // Use Bearer token for OAuth, X-API-Key for API key auth
    if (this.config.accessToken) {
      headers["Authorization"] = `Bearer ${this.config.accessToken}`;
    } else if (this.config.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    }

    if (this.config.apiVersion) {
      headers["X-API-Version"] = this.config.apiVersion;
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    return this.handleResponse<T>(response);
  }

  /**
   * Build full URL with query parameters
   */
  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(path, this.config.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Build request headers
   */
  private buildHeaders(customHeaders: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      ...customHeaders,
    };

    // Use Bearer token for OAuth, X-API-Key for API key auth
    if (this.config.accessToken) {
      headers["Authorization"] = `Bearer ${this.config.accessToken}`;
    } else if (this.config.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    }

    if (this.config.apiVersion) {
      headers["X-API-Version"] = this.config.apiVersion;
    }

    return headers;
  }

  /**
   * Execute request with retry logic
   *
   * IMPORTANT: Only idempotent methods (GET, HEAD, PUT, DELETE, OPTIONS) are
   * automatically retried. POST and PATCH requests are NOT retried to prevent
   * duplicate resource creation or unintended side effects.
   */
  private async executeWithRetry<T>(
    url: string,
    init: RequestInit,
    options: {
      timeout: number;
      skipRetry: boolean;
      retryCount: number;
      method: string;
    }
  ): Promise<T> {
    const { timeout, skipRetry, retryCount, method } = options;

    // Check if method is safe to retry
    const canRetry = isIdempotentMethod(method) && !skipRetry;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      if (init.signal) {
        init.signal.addEventListener("abort", () => controller.abort());
      }

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        return await this.handleResponseWithRetry<T>(response, url, init, options);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ServerApiError(`Request timed out after ${timeout}ms`, {
          code: "TIMEOUT",
        });
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes("fetch")) {
        // Only retry network errors for idempotent methods
        if (canRetry && retryCount < this.config.maxRetries) {
          if (this.config.debug) {
            console.warn(
              `[Divinci Server] Retrying ${method} request (${retryCount + 1}/${this.config.maxRetries})`
            );
          }
          await this.delay(this.getRetryDelay(retryCount));
          return this.executeWithRetry<T>(url, init, {
            ...options,
            retryCount: retryCount + 1,
          });
        }

        // Log if we're not retrying a non-idempotent method
        if (!isIdempotentMethod(method) && this.config.debug) {
          console.warn(
            `[Divinci Server] Not retrying ${method} request (non-idempotent method)`
          );
        }

        throw new ServerApiError(`Network error: ${error.message}`, {
          code: "NETWORK_ERROR",
        });
      }

      throw error;
    }
  }

  /**
   * Handle HTTP response with retry logic
   *
   * IMPORTANT: Retry logic respects HTTP method idempotency.
   * Non-idempotent methods (POST, PATCH) are NOT automatically retried
   * for transient errors to prevent duplicate side effects.
   */
  private async handleResponseWithRetry<T>(
    response: Response,
    url: string,
    init: RequestInit,
    options: {
      timeout: number;
      skipRetry: boolean;
      retryCount: number;
      method: string;
    }
  ): Promise<T> {
    const { skipRetry, retryCount, method } = options;

    // Check if method is safe to retry
    const canRetry = isIdempotentMethod(method) && !skipRetry;

    if (response.ok) {
      return this.handleResponse<T>(response);
    }

    // Handle 429 - rate limit with retry-after
    // Rate limits mean the request was rejected BEFORE processing,
    // so it's safe to retry even for non-idempotent methods
    if (response.status === 429 && !skipRetry) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter && retryCount < this.config.maxRetries) {
        const delayMs = parseInt(retryAfter, 10) * 1000;
        if (this.config.debug) {
          console.warn(`[Divinci Server] Rate limited, retrying ${method} after ${delayMs}ms`);
        }
        await this.delay(delayMs);
        return this.executeWithRetry<T>(url, init, {
          ...options,
          retryCount: retryCount + 1,
        });
      }
    }

    // Handle 5xx - server errors with retry
    // IMPORTANT: Only retry idempotent methods for 5xx errors!
    // The server may have partially processed the request before failing,
    // so retrying POST/PATCH could cause duplicate resource creation.
    if (
      response.status >= 500 &&
      canRetry &&
      retryCount < this.config.maxRetries
    ) {
      if (this.config.debug) {
        console.warn(
          `[Divinci Server] Server error, retrying ${method} (${retryCount + 1}/${this.config.maxRetries})`
        );
      }
      await this.delay(this.getRetryDelay(retryCount));
      return this.executeWithRetry<T>(url, init, {
        ...options,
        retryCount: retryCount + 1,
      });
    }

    // Log when we're not retrying a non-idempotent method on 5xx
    if (response.status >= 500 && !canRetry && !skipRetry && this.config.debug) {
      console.warn(
        `[Divinci Server] Not retrying ${method} request on ${response.status} error (non-idempotent method)`
      );
    }

    // Parse and throw error
    let errorData: Record<string, unknown> = {
      code: "UNKNOWN_ERROR",
      message: response.statusText || "Unknown error",
    };
    try {
      const errorText = await response.text();
      errorData = JSON.parse(errorText) as Record<string, unknown>;
    } catch {
      // Keep default error data
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;

    const e = unwrapErrorBody(errorData);
    throw new ServerApiError((e.message as string) ?? "API request failed", {
      code: (e.code as string) ?? "API_ERROR",
      status: response.status,
      details: e.details as Record<string, unknown>,
      requestId,
      body: errorData,
    });
  }

  /**
   * Handle successful response
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        return undefined as T;
      }
      const responseText = await response.text();
      try {
        return JSON.parse(responseText) as T;
      } catch {
        throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${responseText.substring(0, 200)}`);
      }
    }

    let errorData: Record<string, unknown> = {
      code: "UNKNOWN_ERROR",
      message: response.statusText || "Unknown error",
    };
    try {
      const errorText = await response.text();
      errorData = JSON.parse(errorText) as Record<string, unknown>;
    } catch {
      // Keep default error data
    }

    const e = unwrapErrorBody(errorData);
    throw new ServerApiError((e.message as string) ?? "API request failed", {
      code: (e.code as string) ?? "API_ERROR",
      status: response.status,
      details: e.details as Record<string, unknown>,
      requestId: response.headers.get("x-request-id") ?? undefined,
      body: errorData,
    });
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private getRetryDelay(retryCount: number): number {
    const baseDelay = 1000 * Math.pow(2, retryCount);
    const jitter = Math.random() * 500;
    return Math.min(baseDelay + jitter, 30000);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
