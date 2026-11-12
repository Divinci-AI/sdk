/**
 * WebSocket mock utilities for testing
 */

import { vi } from "vitest";

// Node (vitest "node" environment) exposes Event/MessageEvent as globals but
// NOT CloseEvent, so `new CloseEvent(...)` throws ReferenceError. Fall back to a
// minimal shim carrying the fields ManagedWebSocket reads (code/reason/wasClean).
const CloseEventCtor: typeof CloseEvent =
  (globalThis as { CloseEvent?: typeof CloseEvent }).CloseEvent ??
  (class CloseEvent extends Event {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
    constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
      super(type);
      this.code = init.code ?? 0;
      this.reason = init.reason ?? "";
      this.wasClean = init.wasClean ?? false;
    }
  } as unknown as typeof CloseEvent);

/**
 * Mock WebSocket class for testing
 *
 * Simulates WebSocket behavior for unit tests without requiring
 * an actual network connection.
 *
 * @example
 * ```typescript
 * const { MockWebSocket, mockWebSocketClass } = createMockWebSocket();
 *
 * // Replace global WebSocket
 * vi.stubGlobal("WebSocket", mockWebSocketClass);
 *
 * // Get the instance after it's created
 * const ws = MockWebSocket.instances[0];
 *
 * // Simulate events
 * ws.simulateOpen();
 * ws.simulateMessage({ type: "update", data: "test" });
 * ws.simulateClose(1000, "Normal closure", true);
 * ```
 */
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  /** All created instances (for test access) */
  static instances: MockWebSocket[] = [];

  /** WebSocket ready state */
  readyState: number = MockWebSocket.CONNECTING;

  /** Event handlers */
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  /** Sent messages (for test assertions) */
  sentMessages: Array<string | ArrayBuffer | Blob> = [];

  /** Connection URL */
  readonly url: string;
  /** Subprotocols */
  readonly protocols?: string | string[];

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = url.toString();
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  /**
   * Clear all instances (call in afterEach)
   */
  static clearInstances(): void {
    MockWebSocket.instances = [];
  }

  /**
   * Get the most recently created instance
   */
  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  /**
   * Simulate the WebSocket opening
   */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  /**
   * Simulate receiving a message
   */
  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      const stringData = typeof data === "string" ? data : JSON.stringify(data);
      this.onmessage(new MessageEvent("message", { data: stringData }));
    }
  }

  /**
   * Simulate receiving a raw message (string only)
   */
  simulateRawMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }

  /**
   * Simulate WebSocket close
   */
  simulateClose(code: number = 1000, reason: string = "", wasClean: boolean = true): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      const event = new CloseEventCtor("close", { code, reason, wasClean });
      this.onclose(event);
    }
  }

  /**
   * Simulate WebSocket error
   */
  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  /**
   * Send a message through the WebSocket
   */
  send(data: string | ArrayBuffer | Blob): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  /**
   * Close the WebSocket connection
   */
  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }
    this.readyState = MockWebSocket.CLOSING;
    // Simulate async close
    setTimeout(() => {
      this.simulateClose(code ?? 1000, reason ?? "", true);
    }, 0);
  }

  /**
   * Get all sent messages as parsed JSON
   */
  getSentMessagesAsJson(): unknown[] {
    return this.sentMessages.map((msg) => {
      if (typeof msg === "string") {
        try {
          return JSON.parse(msg);
        } catch {
          return msg;
        }
      }
      return msg;
    });
  }
}

/**
 * Create a mock WebSocket class and utilities
 *
 * @example
 * ```typescript
 * let mockWs: ReturnType<typeof createMockWebSocket>;
 *
 * beforeEach(() => {
 *   mockWs = createMockWebSocket();
 *   vi.stubGlobal("WebSocket", mockWs.mockWebSocketClass);
 * });
 *
 * afterEach(() => {
 *   mockWs.MockWebSocket.clearInstances();
 *   vi.unstubAllGlobals();
 * });
 *
 * it("should connect", () => {
 *   const ws = new WebSocket("wss://example.com");
 *   const instance = mockWs.MockWebSocket.getLastInstance();
 *   instance?.simulateOpen();
 *   // ...
 * });
 * ```
 */
export function createMockWebSocket() {
  // Clear instances before creating new mock
  MockWebSocket.clearInstances();

  const mockWebSocketClass = vi.fn().mockImplementation((url: string | URL, protocols?: string | string[]) => {
    return new MockWebSocket(url, protocols);
  }) as unknown as typeof WebSocket;

  // Copy static properties
  Object.defineProperty(mockWebSocketClass, "CONNECTING", { value: 0 });
  Object.defineProperty(mockWebSocketClass, "OPEN", { value: 1 });
  Object.defineProperty(mockWebSocketClass, "CLOSING", { value: 2 });
  Object.defineProperty(mockWebSocketClass, "CLOSED", { value: 3 });

  return {
    MockWebSocket,
    mockWebSocketClass,
  };
}

/**
 * Create a mock TokenStorage for testing WebSocketManager
 */
export function createMockTokenStorage(token: string | null = "test-token") {
  return {
    getToken: vi.fn().mockResolvedValue(token),
    setToken: vi.fn().mockResolvedValue(undefined),
    getRefreshToken: vi.fn().mockResolvedValue(null),
    setRefreshToken: vi.fn().mockResolvedValue(undefined),
    clearTokens: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mock fetch for cookie exchange in WebSocketManager
 */
export function createMockCookieExchangeFetch(success: boolean = true) {
  return vi.fn().mockResolvedValue({
    ok: success,
    status: success ? 200 : 401,
    statusText: success ? "OK" : "Unauthorized",
  });
}
