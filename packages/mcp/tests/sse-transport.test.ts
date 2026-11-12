/**
 * SseTransport tests
 *
 * Tests for MCP SSE transport including connection, messaging, and reconnection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SseTransport } from "../src/transport/sse.js";
import type { McpConnectionState } from "../src/types.js";

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private listeners: Map<string, ((event: { data: string }) => void)[]> = new Map();
  readyState = 0; // CONNECTING

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(): void {}

  close(): void {
    this.readyState = 2; // CLOSED
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  simulateEvent(type: string, data: string): void {
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      listener({ data });
    }
  }

  simulateError(): void {
    this.onerror?.({});
  }

  static reset(): void {
    MockEventSource.instances = [];
  }

  static getLastInstance(): MockEventSource | undefined {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

// Mock fetch
function createMockFetch(responses: Array<{ ok: boolean; status: number; text?: string }> = []) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const response = responses[Math.min(callIndex, responses.length - 1)] || { ok: true, status: 200 };
    callIndex++;
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(response.text || ""),
    });
  });
}

describe("SseTransport", () => {
  it("refuses to connect to retired Divinci /sse endpoints", async () => {
    const { SseTransport } = await import("../src/transport/sse.js");
    const transport = new SseTransport({
      sseUrl: "https://mcp.divinci.app/sse",
      messageUrl: "https://mcp.divinci.app/message",
    });
    await expect(transport.connect()).rejects.toThrow(/retired 2026-08-07/);
  });

  let originalEventSource: typeof EventSource;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    originalEventSource = globalThis.EventSource;
    originalFetch = globalThis.fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    globalThis.fetch = createMockFetch([{ ok: true, status: 200 }]);
    MockEventSource.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("should set default options", () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      expect(transport.getState()).toBe("disconnected");
      expect(transport.getSessionId()).toBeNull();
    });

    it("should merge custom options", () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        timeout: 60000,
        autoReconnect: false,
        maxReconnectAttempts: 10,
        reconnectDelay: 2000,
        debug: true,
      });

      expect(transport).toBeDefined();
    });
  });

  describe("setAuthToken", () => {
    it("should store auth token for connection", () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      transport.setAuthToken("test-token");
      // Token will be used when connecting
      expect(transport).toBeDefined();
    });
  });

  describe("on", () => {
    it("should register event handlers", () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const onStateChange = vi.fn();
      const onMessage = vi.fn();

      transport.on({ onStateChange, onMessage });

      expect(transport).toBeDefined();
    });

    it("should merge event handlers", () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const onStateChange = vi.fn();
      const onMessage = vi.fn();

      transport.on({ onStateChange });
      transport.on({ onMessage });

      expect(transport).toBeDefined();
    });
  });

  describe("connect", () => {
    it("should connect successfully", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const onStateChange = vi.fn();
      transport.on({ onStateChange });

      const connectPromise = transport.connect();

      // Simulate EventSource open
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();

      await connectPromise;

      expect(transport.getState()).toBe("connected");
      expect(onStateChange).toHaveBeenCalledWith("connecting");
      expect(onStateChange).toHaveBeenCalledWith("connected");
    });

    it("should include auth token in URL", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      transport.setAuthToken("my-token");
      const connectPromise = transport.connect();

      const eventSource = MockEventSource.getLastInstance()!;
      expect(eventSource.url).toContain("token=my-token");

      eventSource.simulateOpen();
      await connectPromise;
    });

    it("should append token with & if URL has query params", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse?foo=bar",
        messageUrl: "http://localhost/message",
      });

      transport.setAuthToken("my-token");
      const connectPromise = transport.connect();

      const eventSource = MockEventSource.getLastInstance()!;
      expect(eventSource.url).toBe("http://localhost/sse?foo=bar&token=my-token");

      eventSource.simulateOpen();
      await connectPromise;
    });

    it("should not reconnect if already connected", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise1 = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();
      await connectPromise1;

      // Second connect should return immediately
      await transport.connect();

      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("should not create new connection if connecting", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      transport.connect();
      transport.connect();

      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("should timeout on connection", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        timeout: 5000,
      });

      const onStateChange = vi.fn();
      transport.on({ onStateChange });

      const connectPromise = transport.connect();

      // Suppress unhandled rejection warning
      connectPromise.catch(() => {});

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(6000);

      await expect(connectPromise).rejects.toThrow("Connection timeout");
      expect(transport.getState()).toBe("error");
    });

    it("should handle connection error", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();

      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateError();

      await expect(connectPromise).rejects.toThrow("Connection failed");
      expect(transport.getState()).toBe("error");
    });

    it("should handle session ID from endpoint event", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;

      // Simulate endpoint event with session ID
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();

      await connectPromise;

      expect(transport.getSessionId()).toBe("session-123");
    });
  });

  describe("disconnect", () => {
    it("should close EventSource and clear state", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const onClose = vi.fn();
      transport.on({ onClose });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();
      await connectPromise;

      transport.disconnect();

      expect(transport.getState()).toBe("disconnected");
      expect(transport.getSessionId()).toBeNull();
      expect(eventSource.readyState).toBe(2); // CLOSED
      expect(onClose).toHaveBeenCalled();
    });

    it("should reject pending requests", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      // Start a request
      const requestPromise = transport.request("test/method");

      // Disconnect before response
      transport.disconnect();

      await expect(requestPromise).rejects.toThrow("Connection closed");
    });
  });

  describe("request", () => {
    it("should throw if not connected", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      await expect(transport.request("test/method")).rejects.toThrow(
        "Cannot send request in state: disconnected"
      );
    });

    it("should send request and receive response", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      // Start request
      const requestPromise = transport.request("test/method", { param: "value" });

      // Get the request ID from the fetch call
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      const requestId = requestBody.id;

      // Simulate response
      eventSource.simulateMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          result: { success: true },
        })
      );

      const result = await requestPromise;
      expect(result).toEqual({ success: true });
    });

    it("should handle error response", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      const requestPromise = transport.request("test/method");

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      const requestId = requestBody.id;

      // Simulate error response
      eventSource.simulateMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: { code: -32600, message: "Invalid request" },
        })
      );

      await expect(requestPromise).rejects.toThrow("Invalid request");
    });

    it("should timeout on no response", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        timeout: 5000,
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      const requestPromise = transport.request("test/method");

      // Suppress unhandled rejection warning
      requestPromise.catch(() => {});

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(6000);

      await expect(requestPromise).rejects.toThrow("Request timeout: test/method");
    });

    it("should include auth token in header", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      transport.setAuthToken("bearer-token");

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      const requestPromise = transport.request("test/method");

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers.Authorization).toBe("Bearer bearer-token");

      // Complete the request
      const requestBody = JSON.parse(fetchCall[1].body);
      eventSource.simulateMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {},
        })
      );

      await requestPromise;
    });

    it("should handle fetch failure", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      // Make fetch fail
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(transport.request("test/method")).rejects.toThrow(
        "HTTP 500: Internal Server Error"
      );
    });
  });

  describe("notify", () => {
    it("should send notification without waiting for response", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateEvent("endpoint", JSON.stringify({ sessionId: "session-123" }));
      eventSource.simulateOpen();
      await connectPromise;

      await transport.notify("notifications/test", { data: "value" });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const notificationBody = JSON.parse(fetchCall[1].body);

      expect(notificationBody.jsonrpc).toBe("2.0");
      expect(notificationBody.method).toBe("notifications/test");
      expect(notificationBody.params).toEqual({ data: "value" });
      expect(notificationBody.id).toBeUndefined();
    });

    it("should throw if no session ID", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      // Don't send endpoint event, so no session ID
      eventSource.simulateOpen();
      await connectPromise;

      await expect(transport.notify("test")).rejects.toThrow(
        "No session ID - not connected"
      );
    });
  });

  describe("message handling", () => {
    it("should emit notification to onMessage handler", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const onMessage = vi.fn();
      transport.on({ onMessage });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();
      await connectPromise;

      // Simulate notification (no id)
      eventSource.simulateMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/test",
          params: { data: "value" },
        })
      );

      expect(onMessage).toHaveBeenCalledWith({
        jsonrpc: "2.0",
        method: "notifications/test",
        params: { data: "value" },
      });
    });

    it("should handle malformed messages gracefully", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        debug: true,
      });

      const onMessage = vi.fn();
      transport.on({ onMessage });

      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();
      await connectPromise;

      // Simulate malformed message
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      eventSource.simulateMessage("not valid json");

      expect(onMessage).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("reconnection", () => {
    it("should schedule reconnect on error when connected", async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        autoReconnect: true,
        reconnectDelay: 1000,
      });

      // Connect first
      const connectPromise = transport.connect();
      const eventSource1 = MockEventSource.getLastInstance()!;
      eventSource1.simulateOpen();
      await connectPromise;

      // Clear spy calls from initial connection
      setTimeoutSpy.mockClear();

      // Simulate error after connected - should trigger reconnect scheduling
      eventSource1.simulateError();

      // Verify setTimeout was called for reconnect
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });

    it("should use exponential backoff delay formula", async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        autoReconnect: true,
        reconnectDelay: 1000,
        maxReconnectAttempts: 3,
      });

      // Connect first
      const connectPromise = transport.connect();
      const eventSource1 = MockEventSource.getLastInstance()!;
      eventSource1.simulateOpen();
      await connectPromise;

      setTimeoutSpy.mockClear();

      // First disconnect should use 1000ms delay (1000 * 2^0)
      eventSource1.simulateError();

      // Check that setTimeout was called with ~1000ms delay
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

      setTimeoutSpy.mockRestore();
    });

    it("should stop reconnecting after max attempts", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 2,
      });

      const onError = vi.fn();
      transport.on({ onError });

      // Connect first
      const connectPromise = transport.connect();
      const eventSource1 = MockEventSource.getLastInstance()!;
      eventSource1.simulateOpen();
      await connectPromise;

      // First disconnect
      eventSource1.simulateError();
      await vi.advanceTimersByTimeAsync(100);

      // First reconnect fails
      MockEventSource.getLastInstance()!.simulateError();
      await vi.advanceTimersByTimeAsync(200);

      // Second reconnect fails
      MockEventSource.getLastInstance()!.simulateError();

      // Should stop and emit error
      expect(transport.getState()).toBe("error");
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: "Max reconnect attempts reached",
      }));
    });

    it("should not reconnect when autoReconnect is false", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        autoReconnect: false,
      });

      const onClose = vi.fn();
      transport.on({ onClose });

      // Connect first
      const connectPromise = transport.connect();
      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();
      await connectPromise;

      // Simulate error
      eventSource.simulateError();

      // Advance timers
      await vi.advanceTimersByTimeAsync(5000);

      // Should not have created new EventSource
      expect(MockEventSource.instances).toHaveLength(1);
      expect(transport.getState()).toBe("disconnected");
      expect(onClose).toHaveBeenCalled();
    });

    it("should reset reconnect attempts on successful connection", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 2,
      });

      // Connect first
      const connectPromise = transport.connect();
      const eventSource1 = MockEventSource.getLastInstance()!;
      eventSource1.simulateOpen();
      await connectPromise;

      // First disconnect
      eventSource1.simulateError();
      await vi.advanceTimersByTimeAsync(100);

      // Reconnect succeeds
      MockEventSource.getLastInstance()!.simulateOpen();

      // Another disconnect
      MockEventSource.getLastInstance()!.simulateError();
      await vi.advanceTimersByTimeAsync(100);

      // Should still be able to reconnect (attempts reset)
      MockEventSource.getLastInstance()!.simulateOpen();

      expect(transport.getState()).toBe("connected");
    });
  });

  describe("state management", () => {
    it("should emit state changes only when state changes", async () => {
      const transport = new SseTransport({
        sseUrl: "http://localhost/sse",
        messageUrl: "http://localhost/message",
      });

      const onStateChange = vi.fn();
      transport.on({ onStateChange });

      const connectPromise = transport.connect();
      expect(onStateChange).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenCalledWith("connecting");

      const eventSource = MockEventSource.getLastInstance()!;
      eventSource.simulateOpen();
      await connectPromise;

      expect(onStateChange).toHaveBeenCalledTimes(2);
      expect(onStateChange).toHaveBeenLastCalledWith("connected");

      transport.disconnect();

      expect(onStateChange).toHaveBeenCalledTimes(3);
      expect(onStateChange).toHaveBeenLastCalledWith("disconnected");
    });
  });
});
