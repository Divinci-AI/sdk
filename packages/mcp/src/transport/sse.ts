/**
 * SSE Transport for MCP (legacy HTTP+SSE)
 *
 * @deprecated Divinci's remote server (`mcp.divinci.app`) retired `/sse` and
 * `/message` on 2026-08-07 (HTTP 410). Use {@link StreamableHttpTransport}
 * via `POST /mcp` instead. This class remains for third-party MCP servers that
 * still speak the legacy transport.
 */

import type {
  McpRequest,
  McpResponse,
  McpNotification,
  McpConnectionState,
} from "../types.js";

/**
 * SSE Transport event handlers
 */
export interface SseTransportEvents {
  /** Connection state changed */
  onStateChange?: (state: McpConnectionState) => void;
  /** Message received */
  onMessage?: (message: McpResponse | McpNotification) => void;
  /** Error occurred */
  onError?: (error: Error) => void;
  /** Connection closed */
  onClose?: () => void;
}

/**
 * SSE Transport options
 */
export interface SseTransportOptions {
  /** SSE endpoint URL */
  sseUrl: string;
  /** Message endpoint URL */
  messageUrl: string;
  /** Connection timeout (ms) */
  timeout?: number;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Reconnect delay (ms) */
  reconnectDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * SSE Transport class
 */
export class SseTransport {
  private readonly options: Required<SseTransportOptions>;
  private eventSource: EventSource | null = null;
  private state: McpConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: McpResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private sessionId: string | null = null;
  private events: SseTransportEvents = {};
  private authToken: string | null = null;

  constructor(options: SseTransportOptions) {
    this.options = {
      timeout: 30000,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      debug: false,
      ...options,
    };
  }

  /**
   * Set event handlers
   */
  on(events: SseTransportEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Get current connection state
   */
  getState(): McpConnectionState {
    return this.state;
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.setState("connecting");

    // Fast-fail if pointed at a retired Divinci /sse endpoint so the error is
    // actionable rather than a hanging EventSource.
    if (/\/sse(\?|$)/.test(this.options.sseUrl) &&
        /mcp\.(stage\.)?divinci\.app/.test(this.options.sseUrl)) {
      this.setState("error");
      throw new Error(
        "SseTransport cannot connect to Divinci MCP: /sse was retired 2026-08-07 (HTTP 410). " +
          "Use StreamableHttpTransport with https://mcp.divinci.app/mcp (default in McpClient).",
      );
    }

    return new Promise((resolve, reject) => {
      try {
        // Build SSE URL with auth token if available
        let url = this.options.sseUrl;
        if (this.authToken) {
          const separator = url.includes("?") ? "&" : "?";
          url = `${url}${separator}token=${encodeURIComponent(this.authToken)}`;
        }

        this.eventSource = new EventSource(url);

        // Set up timeout
        const timeoutId = setTimeout(() => {
          this.eventSource?.close();
          this.setState("error");
          reject(new Error("Connection timeout"));
        }, this.options.timeout);

        // Handle open
        this.eventSource.onopen = () => {
          clearTimeout(timeoutId);
          this.reconnectAttempts = 0;
          this.setState("connected");
          this.log("SSE connection opened");
          resolve();
        };

        // Handle messages
        this.eventSource.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        // Handle specific event types
        this.eventSource.addEventListener("endpoint", (event: MessageEvent) => {
          // Server sends the message endpoint URL
          const data = JSON.parse(event.data);
          this.sessionId = data.sessionId;
          this.log("Received session ID:", this.sessionId);
        });

        // Handle errors
        this.eventSource.onerror = (event) => {
          clearTimeout(timeoutId);
          this.log("SSE error:", event);

          if (this.state === "connecting") {
            this.setState("error");
            reject(new Error("Connection failed"));
          } else if (this.options.autoReconnect) {
            this.handleReconnect();
          } else {
            this.setState("disconnected");
            this.events.onClose?.();
          }
        };
      } catch (error) {
        this.setState("error");
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Reject all pending requests
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();

    this.sessionId = null;
    this.setState("disconnected");
    this.events.onClose?.();
  }

  /**
   * Send a request and wait for response
   */
  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.state !== "connected" && this.state !== "authenticated") {
      throw new Error(`Cannot send request in state: ${this.state}`);
    }

    const id = this.generateId();
    const request: McpRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.options.timeout);

      // Store pending request
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result as T);
          }
        },
        reject,
        timeout,
      });

      // Send request
      this.sendMessage(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  /**
   * Send a notification (no response expected)
   */
  async notify(method: string, params?: unknown): Promise<void> {
    const notification: McpNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    await this.sendMessage(notification);
  }

  /**
   * Send a message to the server
   */
  private async sendMessage(message: McpRequest | McpNotification): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No session ID - not connected");
    }

    const url = `${this.options.messageUrl}?sessionId=${encodeURIComponent(this.sessionId)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as McpResponse | McpNotification;
      this.log("Received:", message);

      // Check if it's a response to a pending request
      if ("id" in message && message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          pending.resolve(message as McpResponse);
          return;
        }
      }

      // Otherwise it's a notification
      this.events.onMessage?.(message);
    } catch (error) {
      this.log("Failed to parse message:", data, error);
    }
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.log("Max reconnect attempts reached");
      this.setState("error");
      this.events.onError?.(new Error("Max reconnect attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        this.log("Reconnect failed:", error);
        this.events.onError?.(error);
      });
    }, delay);
  }

  /**
   * Set connection state
   */
  private setState(state: McpConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.events.onStateChange?.(state);
    }
  }

  /**
   * Generate unique request ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log("[MCP SSE]", ...args);
    }
  }
}
