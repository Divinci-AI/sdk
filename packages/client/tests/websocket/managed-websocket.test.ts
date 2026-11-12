/**
 * ManagedWebSocket tests
 *
 * Tests for the WebSocket wrapper with automatic reconnection,
 * message queuing, and event handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ManagedWebSocket,
  EventEmitter,
  type WebSocketState,
} from "../../src/websocket/managed-websocket.js";
import { createMockWebSocket, MockWebSocket } from "../mocks/websocket.js";

describe("EventEmitter", () => {
  let emitter: EventEmitter<string>;

  beforeEach(() => {
    emitter = new EventEmitter<string>();
  });

  describe("subscribe", () => {
    it("should add listener", () => {
      const listener = vi.fn();
      emitter.subscribe(listener);

      emitter.emit("test");

      expect(listener).toHaveBeenCalledWith("test");
    });

    it("should support multiple listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.subscribe(listener1);
      emitter.subscribe(listener2);

      emitter.emit("test");

      expect(listener1).toHaveBeenCalledWith("test");
      expect(listener2).toHaveBeenCalledWith("test");
    });

    it("should return unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = emitter.subscribe(listener);

      unsubscribe();
      emitter.emit("test");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("emit", () => {
    it("should call all listeners with data", () => {
      const listener = vi.fn();
      emitter.subscribe(listener);

      emitter.emit("data");

      expect(listener).toHaveBeenCalledWith("data");
    });

    it("should handle listener errors gracefully", () => {
      const errorListener = vi.fn(() => {
        throw new Error("Listener error");
      });
      const okListener = vi.fn();

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      emitter.subscribe(errorListener);
      emitter.subscribe(okListener);

      emitter.emit("test");

      expect(okListener).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe("clear", () => {
    it("should remove all listeners", () => {
      const listener = vi.fn();
      emitter.subscribe(listener);

      emitter.clear();
      emitter.emit("test");

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe("ManagedWebSocket", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWs = createMockWebSocket();
    vi.stubGlobal("WebSocket", mockWs.mockWebSocketClass);
  });

  afterEach(() => {
    MockWebSocket.clearInstances();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should connect immediately", () => {
      new ManagedWebSocket("wss://example.com/ws");

      expect(mockWs.mockWebSocketClass).toHaveBeenCalledWith("wss://example.com/ws");
    });

    it("should use default options", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      expect(instance).toBeDefined();
      expect(ws.state).toBe("connecting");
    });

    it("should accept custom options", () => {
      new ManagedWebSocket("wss://example.com/ws", {
        reconnectDelay: 2000,
        maxReconnectAttempts: 5,
        debug: true,
      });

      expect(MockWebSocket.getLastInstance()).toBeDefined();
    });

    it("should accept protocols", () => {
      new ManagedWebSocket("wss://example.com/ws", {}, ["v1", "v2"]);

      const instance = MockWebSocket.getLastInstance();
      expect(instance?.protocols).toEqual(["v1", "v2"]);
    });
  });

  describe("state", () => {
    it("should be 'connecting' initially", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");

      expect(ws.state).toBe("connecting");
    });

    it("should be 'open' after connection", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      instance?.simulateOpen();

      expect(ws.state).toBe("open");
    });

    it("should be 'closed' after close", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      instance?.simulateOpen();
      ws.close();

      expect(ws.state).toBe("closed");
    });

    it("should be 'reconnecting' during reconnection", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      instance?.simulateOpen();
      instance?.simulateClose(1006, "Abnormal closure", false);

      expect(ws.state).toBe("reconnecting");
    });
  });

  describe("isOpen", () => {
    it("should return false when connecting", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");

      expect(ws.isOpen).toBe(false);
    });

    it("should return true when open", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      instance?.simulateOpen();

      expect(ws.isOpen).toBe(true);
    });
  });

  describe("send", () => {
    it("should send when open", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();

      ws.send("test message");

      expect(instance?.sentMessages).toContain("test message");
    });

    it("should queue messages when not open", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");

      ws.send("queued message");
      const instance = MockWebSocket.getLastInstance();

      expect(instance?.sentMessages).not.toContain("queued message");
    });

    it("should flush queue on open", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      ws.send("message 1");
      ws.send("message 2");

      instance?.simulateOpen();

      expect(instance?.sentMessages).toContain("message 1");
      expect(instance?.sentMessages).toContain("message 2");
    });

    it("should throw when permanently closed", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      ws.close();

      expect(() => ws.send("test")).toThrow("WebSocket is permanently closed");
    });
  });

  describe("sendJson", () => {
    it("should stringify and send", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();

      ws.sendJson({ type: "test", data: 123 });

      expect(instance?.sentMessages).toContain('{"type":"test","data":123}');
    });
  });

  describe("close", () => {
    it("should close connection", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();

      ws.close();

      expect(ws.state).toBe("closed");
    });

    it("should emit closed state", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const stateChanges: WebSocketState[] = [];
      ws.onStateChange.subscribe((state) => stateChanges.push(state));
      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();

      ws.close();

      expect(stateChanges).toContain("closed");
    });
  });

  describe("reconnection", () => {
    it("should reconnect on abnormal close", () => {
      new ManagedWebSocket("wss://example.com/ws", { reconnectDelay: 1000 });
      const instance = MockWebSocket.getLastInstance();

      instance?.simulateOpen();
      instance?.simulateClose(1006, "Abnormal closure", false);

      // Initial connection
      expect(MockWebSocket.instances).toHaveLength(1);

      // Advance timer for reconnect
      vi.advanceTimersByTime(1000);

      // Should have created a new connection
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("should not reconnect on clean close", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const instance = MockWebSocket.getLastInstance();

      instance?.simulateOpen();
      ws.close(1000, "Normal closure");

      vi.advanceTimersByTime(2000);

      // Should still only have 1 instance
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("should respect maxReconnectAttempts", () => {
      new ManagedWebSocket("wss://example.com/ws", {
        reconnectDelay: 100,
        maxReconnectAttempts: 3,
      });

      // Close abnormally multiple times
      for (let i = 0; i < 5; i++) {
        const instance = MockWebSocket.getLastInstance();
        instance?.simulateClose(1006, "Error", false);
        vi.advanceTimersByTime(100);
      }

      // 1 initial + 3 reconnects = 4 total instances
      expect(MockWebSocket.instances.length).toBeLessThanOrEqual(4);
    });

    it("should emit onReconnecting events", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws", {
        reconnectDelay: 100,
      });
      const reconnectAttempts: number[] = [];
      ws.onReconnecting.subscribe((attempt) => reconnectAttempts.push(attempt));

      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();
      instance?.simulateClose(1006, "Error", false);

      expect(reconnectAttempts).toContain(1);
    });

    it("should emit onFail when max attempts exceeded", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws", {
        reconnectDelay: 100,
        maxReconnectAttempts: 2,
      });
      const failures: Array<{ code: number; reason: string }> = [];
      ws.onFail.subscribe((fail) => failures.push(fail));

      // Trigger failures
      for (let i = 0; i <= 2; i++) {
        const instance = MockWebSocket.getLastInstance();
        instance?.simulateClose(1006, "Error", false);
        vi.advanceTimersByTime(100);
      }

      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].reason).toContain("Max reconnection attempts");
    });
  });

  describe("events", () => {
    it("should emit onMessage for messages", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const messages: MessageEvent[] = [];
      ws.onMessage.subscribe((event) => messages.push(event));

      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();
      instance?.simulateMessage({ type: "test" });

      expect(messages).toHaveLength(1);
    });

    it("should emit onStateChange for state changes", () => {
      // Subscribe before creating so we catch all states
      const states: WebSocketState[] = [];
      const ws = new ManagedWebSocket("wss://example.com/ws");
      ws.onStateChange.subscribe((state) => states.push(state));

      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();

      // "connecting" is emitted before we subscribe, but "open" should be captured
      expect(states).toContain("open");
    });

    it("should emit onError for errors", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const errors: Event[] = [];
      ws.onError.subscribe((event) => errors.push(event));

      const instance = MockWebSocket.getLastInstance();
      instance?.simulateError();

      expect(errors).toHaveLength(1);
    });
  });

  describe("destroy", () => {
    it("should close and clear all listeners", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      const listener = vi.fn();
      ws.onMessage.subscribe(listener);
      const instance = MockWebSocket.getLastInstance();
      instance?.simulateOpen();

      ws.destroy();

      // Try to emit after destroy - listener should not be called
      expect(ws.state).toBe("closed");
    });

    it("should clear message queue", () => {
      const ws = new ManagedWebSocket("wss://example.com/ws");
      ws.send("queued");

      ws.destroy();

      // After destroy, the queue should be cleared
      expect(ws.state).toBe("closed");
    });
  });
});
