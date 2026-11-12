/**
 * WebSocketManager tests
 *
 * Tests for the WebSocket manager with ticket-based authentication.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WebSocketManager,
  ChatWebSocket,
  TranscriptWebSocket,
} from "../../src/websocket/manager.js";
import { ManagedWebSocket } from "../../src/websocket/managed-websocket.js";
import { AuthenticationError } from "../../src/errors.js";
import {
  createMockWebSocket,
  MockWebSocket,
  createMockTokenStorage,
} from "../mocks/websocket.js";

// Mock fetch for ticket requests
const mockFetch = vi.fn();

describe("WebSocketManager", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let mockTokenStorage: ReturnType<typeof createMockTokenStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWs = createMockWebSocket();
    mockTokenStorage = createMockTokenStorage("test-token");
    vi.stubGlobal("WebSocket", mockWs.mockWebSocketClass);

    // Mock fetch for ticket endpoint
    const ticketData = {
      ticket: "wst_test-ticket-123",
      expiresIn: 30,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ticketData),
      text: () => Promise.resolve(JSON.stringify(ticketData)),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    MockWebSocket.clearInstances();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("ticket authentication", () => {
    it("should add ticket as query parameter to URL", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/test");

      const instance = MockWebSocket.getLastInstance();
      expect(instance?.url).toBe("wss://live.example.com/test?ticket=wst_test-ticket-123");
    });

    it("should call ticket endpoint with auth token", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://live.example.com/websocket/ticket",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
        })
      );
    });

    it("should throw AuthenticationError when no token", async () => {
      const noTokenStorage = createMockTokenStorage(null);
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        noTokenStorage
      );

      await expect(manager.connect("/test")).rejects.toThrow(AuthenticationError);
      await expect(manager.connect("/test")).rejects.toThrow(
        "No auth token available"
      );
    });

    it("should throw AuthenticationError when ticket request fails with 401", async () => {
      const errorData = { message: "Unauthorized" };
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve(errorData),
        text: () => Promise.resolve(JSON.stringify(errorData)),
      });

      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await expect(manager.connect("/test")).rejects.toThrow(AuthenticationError);
    });

    it("should get new ticket for each connection", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/test1");
      await manager.connect("/test2");

      // Each connection should request a new ticket
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("getTicket", () => {
    it("should return ticket response", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      const response = await manager.getTicket();

      expect(response.ticket).toBe("wst_test-ticket-123");
      expect(response.expiresIn).toBe(30);
    });

    it("should pass purpose and resourceId to ticket endpoint", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.getTicket("chat", "chat-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://live.example.com/websocket/ticket",
        expect.objectContaining({
          body: JSON.stringify({
            purpose: "chat",
            resourceId: "chat-123",
          }),
        })
      );
    });
  });

  describe("connect", () => {
    it("should build correct URL with ticket", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/ai-chat/123/transcript");

      const instance = MockWebSocket.getLastInstance();
      expect(instance?.url).toBe(
        "wss://live.example.com/ai-chat/123/transcript?ticket=wst_test-ticket-123"
      );
    });

    it("should normalize path without leading slash", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("test/path");

      const instance = MockWebSocket.getLastInstance();
      expect(instance?.url).toBe(
        "wss://live.example.com/test/path?ticket=wst_test-ticket-123"
      );
    });

    it("should track connection", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/test");

      expect(manager.connectionCount).toBe(1);
    });

    it("should clean up on close", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      const ws = await manager.connect("/test");
      const instance = MockWebSocket.getLastInstance();

      expect(manager.connectionCount).toBe(1);

      // Simulate open then close
      instance?.simulateOpen();
      ws.close();

      // State change handler should remove from map
      expect(manager.connectionCount).toBe(0);
    });

    it("should return ManagedWebSocket", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      const ws = await manager.connect("/test");

      expect(ws).toBeInstanceOf(ManagedWebSocket);
    });

    it("should pass options to ManagedWebSocket", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
          debug: true,
        },
        mockTokenStorage
      );

      await manager.connect("/test", { reconnectDelay: 2000 });

      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  describe("connectToChat", () => {
    it("should connect to /ai-chat/:chatId/transcript with ticket", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connectToChat("chat-123");

      const instance = MockWebSocket.getLastInstance();
      expect(instance?.url).toBe(
        "wss://live.example.com/ai-chat/chat-123/transcript?ticket=wst_test-ticket-123"
      );
    });

    it("should pass purpose=chat to ticket request", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connectToChat("chat-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://live.example.com/websocket/ticket",
        expect.objectContaining({
          body: JSON.stringify({
            purpose: "chat",
            resourceId: "chat-123",
          }),
        })
      );
    });

    it("should return ChatWebSocket wrapper", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      const chatWs = await manager.connectToChat("chat-123");

      expect(chatWs).toBeInstanceOf(ChatWebSocket);
    });
  });

  describe("connectToTranscript", () => {
    it("should connect to /white-label/:workspaceId/transcript/:transcriptId with ticket", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connectToTranscript("ws-123", "t-456");

      const instance = MockWebSocket.getLastInstance();
      expect(instance?.url).toBe(
        "wss://live.example.com/white-label/ws-123/transcript/t-456?ticket=wst_test-ticket-123"
      );
    });

    it("should pass purpose=transcript to ticket request", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connectToTranscript("ws-123", "t-456");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://live.example.com/websocket/ticket",
        expect.objectContaining({
          body: JSON.stringify({
            purpose: "transcript",
            resourceId: "t-456",
          }),
        })
      );
    });

    it("should return TranscriptWebSocket wrapper", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      const transcriptWs = await manager.connectToTranscript("ws-123", "t-456");

      expect(transcriptWs).toBeInstanceOf(TranscriptWebSocket);
    });
  });

  describe("closeAll", () => {
    it("should close all active connections", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/test1");
      await manager.connect("/test2");
      await manager.connect("/test3");

      expect(manager.connectionCount).toBe(3);

      manager.closeAll();

      expect(manager.connectionCount).toBe(0);
    });

    it("should clear connections map", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      await manager.connect("/test");
      expect(manager.connectionCount).toBe(1);

      manager.closeAll();

      expect(manager.connectionCount).toBe(0);
    });
  });

  describe("connectionCount", () => {
    it("should return number of active connections", async () => {
      const manager = new WebSocketManager(
        {
          wsBaseUrl: "wss://live.example.com",
          liveBaseUrl: "https://live.example.com",
        },
        mockTokenStorage
      );

      expect(manager.connectionCount).toBe(0);

      await manager.connect("/test1");
      expect(manager.connectionCount).toBe(1);

      await manager.connect("/test2");
      expect(manager.connectionCount).toBe(2);
    });
  });
});

describe("ChatWebSocket", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let mockTokenStorage: ReturnType<typeof createMockTokenStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWs = createMockWebSocket();
    mockTokenStorage = createMockTokenStorage("test-token");
    vi.stubGlobal("WebSocket", mockWs.mockWebSocketClass);

    // Mock fetch for ticket endpoint
    const ticketData = {
      ticket: "wst_test-ticket-123",
      expiresIn: 30,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ticketData),
      text: () => Promise.resolve(JSON.stringify(ticketData)),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    MockWebSocket.clearInstances();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should expose onMessage event", async () => {
    const manager = new WebSocketManager(
      {
        wsBaseUrl: "wss://live.example.com",
        liveBaseUrl: "https://live.example.com",
      },
      mockTokenStorage
    );

    const chatWs = await manager.connectToChat("chat-123");
    const messages: MessageEvent[] = [];
    chatWs.onMessage.subscribe((event) => messages.push(event));

    const instance = MockWebSocket.getLastInstance();
    instance?.simulateOpen();
    instance?.simulateMessage({ type: "message" });

    expect(messages).toHaveLength(1);
  });

  it("should expose state getter", async () => {
    const manager = new WebSocketManager(
      {
        wsBaseUrl: "wss://live.example.com",
        liveBaseUrl: "https://live.example.com",
      },
      mockTokenStorage
    );

    const chatWs = await manager.connectToChat("chat-123");

    expect(chatWs.state).toBe("connecting");

    const instance = MockWebSocket.getLastInstance();
    instance?.simulateOpen();

    expect(chatWs.state).toBe("open");
  });

  it("should expose close method", async () => {
    const manager = new WebSocketManager(
      {
        wsBaseUrl: "wss://live.example.com",
        liveBaseUrl: "https://live.example.com",
      },
      mockTokenStorage
    );

    const chatWs = await manager.connectToChat("chat-123");
    const instance = MockWebSocket.getLastInstance();
    instance?.simulateOpen();

    chatWs.close();

    expect(chatWs.state).toBe("closed");
  });
});

describe("TranscriptWebSocket", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let mockTokenStorage: ReturnType<typeof createMockTokenStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWs = createMockWebSocket();
    mockTokenStorage = createMockTokenStorage("test-token");
    vi.stubGlobal("WebSocket", mockWs.mockWebSocketClass);

    // Mock fetch for ticket endpoint
    const ticketData = {
      ticket: "wst_test-ticket-123",
      expiresIn: 30,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ticketData),
      text: () => Promise.resolve(JSON.stringify(ticketData)),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    MockWebSocket.clearInstances();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should expose onMessage event", async () => {
    const manager = new WebSocketManager(
      {
        wsBaseUrl: "wss://live.example.com",
        liveBaseUrl: "https://live.example.com",
      },
      mockTokenStorage
    );

    const transcriptWs = await manager.connectToTranscript("ws-123", "t-456");
    const messages: MessageEvent[] = [];
    transcriptWs.onMessage.subscribe((event) => messages.push(event));

    const instance = MockWebSocket.getLastInstance();
    instance?.simulateOpen();
    instance?.simulateMessage({ type: "transcript" });

    expect(messages).toHaveLength(1);
  });

  it("should expose destroy method", async () => {
    const manager = new WebSocketManager(
      {
        wsBaseUrl: "wss://live.example.com",
        liveBaseUrl: "https://live.example.com",
      },
      mockTokenStorage
    );

    const transcriptWs = await manager.connectToTranscript("ws-123", "t-456");

    transcriptWs.destroy();

    expect(transcriptWs.state).toBe("closed");
  });
});
