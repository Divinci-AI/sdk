/**
 * ManagedWebSocket
 *
 * A WebSocket wrapper with automatic reconnection, message queuing,
 * and event handling. Based on the RecoveringWebsocket pattern.
 */

/**
 * WebSocket ready states
 */
export type WebSocketState = "connecting" | "open" | "closing" | "closed" | "reconnecting";

/**
 * WebSocket connection options
 */
export interface WebSocketOptions {
  /** Delay between reconnection attempts in ms (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnection attempts (default: 10, 0 = infinite) */
  maxReconnectAttempts?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Event emitter for WebSocket events
 */
export class EventEmitter<T> {
  private listeners: Array<(data: T) => void> = [];

  /**
   * Subscribe to events
   */
  subscribe(listener: (data: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Emit an event to all listeners
   */
  emit(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (error) {
        console.error("[ManagedWebSocket] Error in event listener:", error);
      }
    }
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners = [];
  }
}

/**
 * Reconnection error codes that should trigger a reconnect
 */
const RECONNECT_CODES = [
  1006, // Abnormal closure (no close frame received)
  1011, // Server error
  1012, // Service restart
  1013, // Try again later
  1014, // Bad gateway
];

/**
 * ManagedWebSocket class
 *
 * Provides automatic reconnection, message queuing, and event handling
 * for WebSocket connections.
 *
 * @example
 * ```typescript
 * const ws = new ManagedWebSocket("wss://example.com/ws");
 *
 * ws.onMessage.subscribe((event) => {
 *   console.log("Message:", event.data);
 * });
 *
 * ws.onStateChange.subscribe((state) => {
 *   console.log("State:", state);
 * });
 *
 * ws.send(JSON.stringify({ type: "hello" }));
 * ```
 */
export class ManagedWebSocket {
  private ws: WebSocket | null = null;
  private readonly url: string | URL;
  private readonly protocols?: string | string[];
  private readonly options: Required<WebSocketOptions>;

  private messageQueue: Array<string | ArrayBuffer | Blob> = [];
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private isPermanentlyClosed = false;

  /** Emitted when a message is received */
  readonly onMessage = new EventEmitter<MessageEvent>();
  /** Emitted when the connection state changes */
  readonly onStateChange = new EventEmitter<WebSocketState>();
  /** Emitted when an error occurs */
  readonly onError = new EventEmitter<Event>();
  /** Emitted when reconnection is attempted */
  readonly onReconnecting = new EventEmitter<number>();
  /** Emitted when the connection permanently fails */
  readonly onFail = new EventEmitter<{ code: number; reason: string }>();

  constructor(
    url: string | URL,
    options?: WebSocketOptions,
    protocols?: string | string[]
  ) {
    this.url = url;
    this.protocols = protocols;
    this.options = {
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      debug: false,
      ...options,
    };

    this.connect();
  }

  /**
   * Get current connection state
   */
  get state(): WebSocketState {
    if (this.isPermanentlyClosed) {
      return "closed";
    }
    if (this.isReconnecting) {
      return "reconnecting";
    }
    if (!this.ws) {
      return "closed";
    }

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "open";
      case WebSocket.CLOSING:
        return "closing";
      case WebSocket.CLOSED:
        return "closed";
      default:
        return "closed";
    }
  }

  /**
   * Check if the connection is open
   */
  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the WebSocket server
   */
  private connect(): void {
    if (this.isPermanentlyClosed) return;

    try {
      this.ws = this.protocols
        ? new WebSocket(this.url, this.protocols)
        : new WebSocket(this.url);

      this.setupEventHandlers();
      this.onStateChange.emit("connecting");

      if (this.options.debug) {
        console.log("[ManagedWebSocket] Connecting to:", this.url);
      }
    } catch (error) {
      if (this.options.debug) {
        console.error("[ManagedWebSocket] Connection error:", error);
      }
      this.scheduleReconnect();
    }
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.onStateChange.emit("open");
      this.flushQueue();

      if (this.options.debug) {
        console.log("[ManagedWebSocket] Connected");
      }
    };

    this.ws.onmessage = (event) => {
      this.onMessage.emit(event);
    };

    this.ws.onclose = (event) => {
      if (this.isPermanentlyClosed) {
        this.onStateChange.emit("closed");
        return;
      }

      // Check if we should reconnect
      if (!event.wasClean || RECONNECT_CODES.includes(event.code)) {
        if (this.options.debug) {
          console.log(
            `[ManagedWebSocket] Connection closed (code: ${event.code}), reconnecting...`
          );
        }
        this.scheduleReconnect();
        return;
      }

      // Permanent close
      this.isPermanentlyClosed = true;
      this.onStateChange.emit("closed");
      this.onFail.emit({ code: event.code, reason: event.reason });

      if (this.options.debug) {
        console.log(
          `[ManagedWebSocket] Permanently closed (code: ${event.code}, reason: ${event.reason})`
        );
      }
    };

    this.ws.onerror = (event) => {
      this.onError.emit(event);
      // The close event will handle reconnection
    };
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isPermanentlyClosed || this.isReconnecting) return;

    const maxAttempts = this.options.maxReconnectAttempts;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.isPermanentlyClosed = true;
      this.onStateChange.emit("closed");
      this.onFail.emit({
        code: 1006,
        reason: `Max reconnection attempts (${maxAttempts}) exceeded`,
      });
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.onStateChange.emit("reconnecting");
    this.onReconnecting.emit(this.reconnectAttempts);

    if (this.options.debug) {
      console.log(
        `[ManagedWebSocket] Reconnecting in ${this.options.reconnectDelay}ms (attempt ${this.reconnectAttempts})`
      );
    }

    setTimeout(() => {
      if (!this.isPermanentlyClosed) {
        this.isReconnecting = false;
        this.connect();
      }
    }, this.options.reconnectDelay);
  }

  /**
   * Flush queued messages
   */
  private flushQueue(): void {
    if (!this.isOpen) return;

    for (const message of this.messageQueue) {
      this.ws?.send(message);
    }
    this.messageQueue = [];
  }

  /**
   * Send a message through the WebSocket
   *
   * If the connection is not open, the message will be queued and sent
   * when the connection is established.
   */
  send(data: string | ArrayBuffer | Blob): void {
    if (this.isPermanentlyClosed) {
      throw new Error("WebSocket is permanently closed");
    }

    if (this.isOpen) {
      this.ws?.send(data);
    } else {
      this.messageQueue.push(data);
    }
  }

  /**
   * Send a JSON message
   */
  sendJson(data: unknown): void {
    this.send(JSON.stringify(data));
  }

  /**
   * Close the WebSocket connection
   */
  close(code?: number, reason?: string): void {
    if (this.isPermanentlyClosed) return;

    this.isPermanentlyClosed = true;

    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close(code, reason);
    }

    this.onStateChange.emit("closed");
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.close();
    this.onMessage.clear();
    this.onStateChange.clear();
    this.onError.clear();
    this.onReconnecting.clear();
    this.onFail.clear();
    this.messageQueue = [];
  }
}
