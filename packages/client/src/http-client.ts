/**
 * HTTP Client for Divinci API
 *
 * Handles authentication, retries, error mapping, and request/response processing
 */

import type { DivinciClientConfig } from "@divinci-ai/types";
import { validate, DivinciValidationError } from "@divinci-ai/types";
import type { ZodSchema } from "zod";
import { DivinciError, NetworkError, TimeoutError } from "./errors.js";

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
  /** Signal for abort controller */
  signal?: AbortSignal;
  /** Zod schema for response validation */
  responseSchema?: ZodSchema<T>;
  /** Skip response validation (for performance-critical paths) */
  skipValidation?: boolean;
}

/**
 * Token storage interface
 */
export interface TokenStorage {
  getToken(): Promise<string | null>;
  setToken(token: string, expiresAt?: number): Promise<void>;
  clearToken(): Promise<void>;
  getRefreshToken?(): Promise<string | null>;
  setRefreshToken?(token: string): Promise<void>;
}

/**
 * Default in-memory token storage
 */
class MemoryTokenStorage implements TokenStorage {
  private token: string | null = null;
  private refreshToken: string | null = null;

  async getToken(): Promise<string | null> {
    return this.token;
  }

  async setToken(token: string): Promise<void> {
    this.token = token;
  }

  async clearToken(): Promise<void> {
    this.token = null;
    this.refreshToken = null;
  }

  async getRefreshToken(): Promise<string | null> {
    return this.refreshToken;
  }

  async setRefreshToken(token: string): Promise<void> {
    this.refreshToken = token;
  }
}

/**
 * Simple token storage that holds a token string directly.
 * Used when userToken is passed to SDK config.
 * Does not support token refresh (for simple use cases).
 *
 * @example
 * ```typescript
 * const sdk = new DivinciClient({
 *   userToken: "eyJhbG...",  // Creates SimpleTokenStorage internally
 *   releaseId: "release-123"
 * });
 * ```
 */
export class SimpleTokenStorage implements TokenStorage {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async getToken(): Promise<string | null> {
    return this.token || null;
  }

  async setToken(token: string): Promise<void> {
    this.token = token;
  }

  async clearToken(): Promise<void> {
    this.token = "";
  }

  // Refresh not supported in simple mode
  async getRefreshToken(): Promise<string | null> {
    return null;
  }

  async setRefreshToken(_token: string): Promise<void> {
    // No-op - refresh not supported in simple mode
  }
}

/**
 * HTTP Client class
 */
export class HttpClient {
  private readonly config: Required<
    Pick<DivinciClientConfig, "baseUrl" | "timeout" | "maxRetries" | "debug">
  > &
    DivinciClientConfig;
  private readonly tokenStorage: TokenStorage;
  private refreshPromise: Promise<boolean> | null = null;

  /**
   * True when this client authenticates with an API key.
   *
   * Namespaces need this because the two auth modes reach different route
   * families: `/api/v1/*` is mounted behind `requireAPIKey()` and rejects a
   * bearer token outright, while the `/white-label/:id/*` routes take the
   * OAuth JWT. A namespace that hard-codes one family 401s for every caller
   * using the other.
   */
  get hasApiKey(): boolean {
    return Boolean(this.config.apiKey);
  }

  constructor(config: DivinciClientConfig, tokenStorage?: TokenStorage) {
    this.config = {
      baseUrl: "https://api.divinci.app",
      timeout: 30000,
      maxRetries: 3,
      debug: false,
      ...config,
    };
    this.tokenStorage = tokenStorage ?? new MemoryTokenStorage();
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

    // Build URL with query params
    const url = this.buildUrl(path, params);

    // Build headers
    const requestHeaders = await this.buildHeaders(headers);

    // Build request init
    const init: RequestInit = {
      method,
      headers: requestHeaders,
      signal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    // Execute with retry logic
    const response = await this.executeWithRetry<T>(url, init, {
      timeout,
      skipRetry,
      retryCount: 0,
      method,
    });

    // Validate response if schema provided and validation not skipped
    if (responseSchema && !skipValidation) {
      const validationResult = validate(responseSchema, response);
      if (!validationResult.success) {
        if (this.config.debug) {
          console.warn("[Divinci] Response validation failed:", validationResult.errors);
        }
        throw new DivinciValidationError(
          validationResult.errors,
          `Response from ${method} ${path}`,
          validationResult.zodError
        );
      }
      return validationResult.data;
    }

    return response;
  }

  /**
   * Make a GET request
   */
  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation" | "timeout">
  ): Promise<T> {
    return this.request<T>(path, { method: "GET", params, ...options });
  }

  /**
   * Make a GET request returning the raw response body as text (no JSON parse).
   * Used for endpoints that emit non-JSON payloads, e.g. the YAML config export.
   */
  async getText(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<string> {
    const url = this.buildUrl(path, params);
    const headers = await this.buildHeaders({});
    const response = await fetch(url, { method: "GET", headers });
    const text = await response.text();
    if (!response.ok) {
      let errorData: { code?: string; message?: string; details?: Record<string, unknown> } = {};
      try {
        errorData = JSON.parse(text) as typeof errorData;
      } catch {
        // non-JSON error body — fall through with raw text
      }
      throw DivinciError.fromResponse({
        code: errorData.code || "REQUEST_ERROR",
        message: errorData.message || text.substring(0, 200) || response.statusText,
        status: response.status,
        details: errorData.details,
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
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation" | "signal" | "timeout">
  ): Promise<T> {
    return this.request<T>(path, { method: "POST", body, ...options });
  }

  /**
   * Make a POST request with FormData (for file uploads)
   * FormData is sent without JSON serialization
   */
  async postFormData<T>(path: string, formData: FormData): Promise<T> {
    const url = this.buildUrl(path);

    // Build headers without Content-Type (browser sets it for FormData)
    const token = await this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (this.config.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = {};
      }
      throw DivinciError.fromResponse({
        code: errorData.code || "REQUEST_ERROR",
        message: errorData.message || response.statusText,
        status: response.status,
        details: errorData.details,
      });
    }

    const responseText = await response.text();
    try {
      return JSON.parse(responseText);
    } catch {
      throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${responseText.substring(0, 200)}`);
    }
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
    options?: Pick<RequestOptions<T>, "responseSchema" | "skipValidation">
  ): Promise<T> {
    return this.request<T>(path, { method: "DELETE", ...options });
  }

  /**
   * Set authentication token
   */
  async setToken(token: string, expiresAt?: number): Promise<void> {
    await this.tokenStorage.setToken(token, expiresAt);
  }

  /**
   * Set refresh token
   */
  async setRefreshToken(token: string): Promise<void> {
    if (this.tokenStorage.setRefreshToken) {
      await this.tokenStorage.setRefreshToken(token);
    }
  }

  /**
   * Clear all tokens
   */
  async clearTokens(): Promise<void> {
    await this.tokenStorage.clearToken();
  }

  /**
   * Get current token (for debugging)
   */
  async getToken(): Promise<string | null> {
    return this.tokenStorage.getToken();
  }

  /**
   * Get the base URL for the API
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
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
  private async buildHeaders(
    customHeaders: Record<string, string>
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      ...customHeaders,
    };

    // Add API key if configured
    if (this.config.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    }

    // Add bearer token if available
    const token = await this.tokenStorage.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Add API version
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
      // Create timeout abort controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Merge signals if provided
      if (init.signal) {
        init.signal.addEventListener("abort", () => controller.abort());
      }

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle response
        return await this.handleResponse<T>(response, url, init, {
          ...options,
          retryCount,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      // Handle abort/timeout
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${timeout}ms`);
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes("fetch")) {
        const networkError = new NetworkError(
          `Network error: ${error.message}`
        );

        // Only retry network errors for idempotent methods
        if (canRetry && retryCount < this.config.maxRetries) {
          if (this.config.debug) {
            console.warn(
              `[Divinci] Retrying ${method} request (${retryCount + 1}/${this.config.maxRetries})`
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
            `[Divinci] Not retrying ${method} request (non-idempotent method)`
          );
        }

        throw networkError;
      }

      throw error;
    }
  }

  /**
   * Handle HTTP response
   *
   * IMPORTANT: Retry logic respects HTTP method idempotency.
   * Non-idempotent methods (POST, PATCH) are NOT automatically retried
   * for transient errors to prevent duplicate side effects.
   */
  private async handleResponse<T>(
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

    // Success
    if (response.ok) {
      // Handle empty responses
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        return undefined as T;
      }

      const responseText = await response.text();
      try {
        const data = JSON.parse(responseText);
        return data as T;
      } catch {
        throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${responseText.substring(0, 200)}`);
      }
    }

    // Parse error response
    let errorData: Record<string, unknown>;
    const errorText = await response.text();
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = {
        code: "UNKNOWN_ERROR",
        message: response.statusText || "Unknown error",
      };
    }

    // Add request ID from headers
    const requestId = response.headers.get("x-request-id") ?? undefined;

    // Handle 401 - try token refresh
    if (response.status === 401 && !skipRetry && retryCount === 0) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        // Retry with new token
        const newInit = { ...init };
        const headers = newInit.headers as Record<string, string>;
        const newToken = await this.tokenStorage.getToken();
        if (newToken) {
          headers["Authorization"] = `Bearer ${newToken}`;
        }
        return this.executeWithRetry<T>(url, newInit, {
          ...options,
          retryCount: retryCount + 1,
        });
      }
    }

    // Handle 429 - rate limit with retry-after
    // Rate limits mean the request was rejected BEFORE processing,
    // so it's safe to retry even for non-idempotent methods
    if (response.status === 429 && !skipRetry) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter && retryCount < this.config.maxRetries) {
        const delayMs = parseInt(retryAfter, 10) * 1000;
        if (this.config.debug) {
          console.warn(`[Divinci] Rate limited, retrying ${method} after ${delayMs}ms`);
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
          `[Divinci] Server error, retrying ${method} (${retryCount + 1}/${this.config.maxRetries})`
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
        `[Divinci] Not retrying ${method} request on ${response.status} error (non-idempotent method)`
      );
    }

    // Throw mapped error
    throw DivinciError.fromResponse({
      code: (errorData.code as string) ?? "API_ERROR",
      message: (errorData.message as string) ?? "API request failed",
      status: response.status,
      details: errorData.details as Record<string, unknown>,
      requestId,
    });
  }

  /**
   * Try to refresh the access token
   */
  private async tryRefreshToken(): Promise<boolean> {
    // Prevent concurrent refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = await this.tokenStorage.getRefreshToken?.();
    if (!refreshToken) {
      return false;
    }

    this.refreshPromise = this.doRefreshToken(refreshToken);

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform token refresh via POST /embed/validate-login.
   *
   * There is no /api/v1/auth/refresh route server-side — the embed login
   * flow's validate-login endpoint is the actual token-exchange mechanism,
   * and it requires the calling origin (checked against the API key's
   * allowedOrigins) in addition to the refresh token and release ID.
   */
  private async doRefreshToken(refreshToken: string): Promise<boolean> {
    if (!this.config.origin) {
      console.warn(
        "[Divinci] Token refresh skipped: `origin` is not configured on the client. " +
        "Set `origin` in DivinciClientConfig to enable automatic token refresh via /embed/validate-login."
      );
      await this.tokenStorage.clearToken();
      return false;
    }

    try {
      const response = await fetch(
        `${this.config.baseUrl}/embed/validate-login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            refreshToken,
            origin: this.config.origin,
            releaseId: this.config.releaseId,
          }),
        }
      );

      const responseText = await response.text();
      let data: {
        valid: boolean;
        accessToken?: string;
      };
      try {
        data = JSON.parse(responseText) as typeof data;
      } catch {
        throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${responseText.substring(0, 200)}`);
      }

      if (!response.ok || !data.valid || !data.accessToken) {
        console.warn(
          `[Divinci] Token refresh failed (status: ${response.status}, valid: ${String(data.valid)}). Clearing stored token.`
        );
        await this.tokenStorage.clearToken();
        return false;
      }

      // /embed/validate-login access tokens have a fixed 30-minute lifetime
      // and are not accompanied by an expiresIn field or a rotated refresh
      // token (the original refresh token remains valid for its own 7-day
      // window — see authentication.mdx "Headless external-user login").
      await this.tokenStorage.setToken(
        data.accessToken,
        Date.now() + 30 * 60 * 1000
      );

      return true;
    } catch (error) {
      console.warn("[Divinci] Token refresh failed:", error);
      await this.tokenStorage.clearToken();
      return false;
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private getRetryDelay(retryCount: number): number {
    // Exponential backoff: 1s, 2s, 4s, etc. with jitter
    const baseDelay = 1000 * Math.pow(2, retryCount);
    const jitter = Math.random() * 500;
    return Math.min(baseDelay + jitter, 30000); // Max 30s
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
