/**
 * Streamable HTTP Transport for MCP
 *
 * Posts JSON-RPC to a single endpoint (POST /mcp). This is the transport
 * Divinci's remote MCP server supports after the legacy HTTP+SSE path
 * (/sse + /message) was retired 2026-08-07 (HTTP 410).
 *
 * Compatible surface with {@link SseTransport} so {@link ToolClient} and
 * {@link McpClient} can swap transports without API changes.
 */

import type {
  McpRequest,
  McpResponse,
  McpNotification,
  McpConnectionState,
  McpError,
} from "../types.js";

/**
 * Streamable HTTP transport event handlers
 */
export interface StreamableHttpTransportEvents {
  onStateChange?: (state: McpConnectionState) => void;
  onMessage?: (message: McpResponse | McpNotification) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * Streamable HTTP transport options
 */
export interface StreamableHttpTransportOptions {
  /** Streamable HTTP endpoint URL (e.g. https://mcp.divinci.app/mcp) */
  mcpUrl: string;
  /** Request timeout (ms) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Streamable HTTP transport — request/response over POST /mcp.
 *
 * Unlike SSE, there is no long-lived connection. `connect()` marks the
 * client ready; each `request()` / `notify()` is an independent HTTP call.
 */
export class StreamableHttpTransport {
  private readonly options: Required<StreamableHttpTransportOptions>;
  private state: McpConnectionState = "disconnected";
  private events: StreamableHttpTransportEvents = {};
  private authToken: string | null = null;

  constructor(options: StreamableHttpTransportOptions) {
    this.options = {
      timeout: 30000,
      debug: false,
      ...options,
    };
  }

  on(events: StreamableHttpTransportEvents): void {
    this.events = { ...this.events, ...events };
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  getState(): McpConnectionState {
    return this.state;
  }

  /**
   * No server-side session for streamable HTTP (stateless Workers).
   * Always null; kept for SseTransport API compatibility.
   */
  getSessionId(): string | null {
    return null;
  }

  /**
   * Mark ready. Streamable HTTP has no handshake socket — the first
   * `initialize` request from McpClient is the real handshake.
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }
    this.setState("connecting");
    // Stateless: nothing to open. Auth is attached per-request.
    this.setState("connected");
    this.log("Streamable HTTP transport ready:", this.options.mcpUrl);
  }

  disconnect(): void {
    this.setState("disconnected");
    this.events.onClose?.();
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.state !== "connected" && this.state !== "authenticated") {
      throw new Error(`Cannot send request in state: ${this.state}`);
    }

    const id = this.generateId();
    const body: McpRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const response = await this.postJson(body);
    this.log("Response:", response);

    if ("error" in response && response.error) {
      // postJson returns a union that includes Record<string, unknown>, so
      // narrowing on "error" leaves the value as `{}` and reading .message/.code
      // off it does not compile. Treat it as a partial McpError: the server is
      // remote, so neither field is actually guaranteed to be present, and the
      // fallbacks below already assume that.
      const error = response.error as Partial<McpError>;
      throw new Error(
        error.message || `MCP error ${error.code ?? "unknown"}`,
      );
    }

    // Fire onMessage for observers (mirrors SSE behaviour)
    this.events.onMessage?.(response as McpResponse);

    return (response as McpResponse).result as T;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const notification: McpNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    // Notifications may return 202/empty; ignore body
    await this.postJson(notification, { expectResult: false });
  }

  private async postJson(
    message: McpRequest | McpNotification,
    opts: { expectResult?: boolean } = {},
  ): Promise<McpResponse | McpNotification | Record<string, unknown>> {
    const { expectResult = true } = opts;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // MCP Streamable HTTP requires both (server may stream or return JSON)
      Accept: "application/json, text/event-stream",
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeout);

    let response: Response;
    try {
      response = await fetch(this.options.mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Request timeout after ${this.options.timeout}ms: ${
            "method" in message ? message.method : "notify"
          }`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 410) {
      throw new Error(
        "MCP endpoint returned 410 Gone. If you are still targeting /sse, " +
          "switch to Streamable HTTP at /mcp (legacy SSE was retired 2026-08-07).",
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP ${response.status}: ${errorText.slice(0, 500)}`,
      );
    }

    // 202 Accepted / empty body — fine for notifications
    if (response.status === 202 || response.status === 204) {
      return {};
    }

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!text) {
      if (!expectResult) return {};
      throw new Error("Empty response from MCP server");
    }

    // Prefer JSON. If the server streams SSE for a result, take the last
    // `data:` payload that looks like JSON-RPC.
    if (contentType.includes("text/event-stream") || text.startsWith("event:")) {
      const parsed = this.parseSseJsonPayload(text);
      if (parsed) return parsed;
      if (!expectResult) return {};
      throw new Error("Could not parse SSE payload from MCP response");
    }

    try {
      return JSON.parse(text) as McpResponse;
    } catch {
      throw new Error(
        `Failed to parse MCP response as JSON: ${text.slice(0, 200)}`,
      );
    }
  }

  private parseSseJsonPayload(
    text: string,
  ): McpResponse | McpNotification | null {
    const lines = text.split("\n");
    let lastData: string | null = null;
    for (const line of lines) {
      if (line.startsWith("data:")) {
        lastData = line.slice(5).trim();
      }
    }
    if (!lastData) return null;
    try {
      return JSON.parse(lastData) as McpResponse;
    } catch {
      return null;
    }
  }

  private setState(state: McpConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.events.onStateChange?.(state);
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      // Prefer warn — console.log is disallowed by repo lint conventions
      console.warn("[MCP StreamableHTTP]", ...args);
    }
  }
}
