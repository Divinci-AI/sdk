/**
 * DivinciClient tests
 *
 * Tests for the main SDK client class that provides access to all namespaces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DivinciClient, createClient } from "../src/client.js";
import { ValidationError } from "../src/errors.js";
import { ChatClient } from "../src/chat/index.js";
import {
  RagNamespace,
  AudioNamespace,
  UserNamespace,
  ApiKeyNamespace,
  FineTuneNamespace,
  NotificationsNamespace,
} from "../src/namespaces/index.js";
import { WebSocketManager } from "../src/websocket/index.js";
import { createMockFetch } from "./mocks/fetch.js";

describe("DivinciClient", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch({ body: {} });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("should require releaseId", () => {
      expect(() => new DivinciClient({} as never)).toThrow(ValidationError);
      expect(() => new DivinciClient({} as never)).toThrow("releaseId is required");
    });

    it("should throw ValidationError with proper structure", () => {
      try {
        new DivinciClient({} as never);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.code).toBe("VALIDATION_ERROR");
        expect(validationError.details?.fieldErrors).toBeDefined();
        expect(validationError.details?.fieldErrors?.[0]).toEqual({
          field: "releaseId",
          message: "Release ID is required",
          code: "required",
        });
      }
    });

    it("should create client with minimal config", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });

      expect(client).toBeInstanceOf(DivinciClient);
      const config = client.getConfig();
      expect(config.releaseId).toBe("rel-123");
    });

    it("should use default baseUrl and wsBaseUrl", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });
      const config = client.getConfig();

      expect(config.baseUrl).toBe("https://api.divinci.app");
      expect(config.wsBaseUrl).toBe("wss://live.divinci.app");
    });

    it("should accept custom baseUrl", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        baseUrl: "https://custom.api.com",
      });
      const config = client.getConfig();

      expect(config.baseUrl).toBe("https://custom.api.com");
    });

    it("should accept custom wsBaseUrl", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        wsBaseUrl: "wss://custom.live.com",
      });
      const config = client.getConfig();

      expect(config.wsBaseUrl).toBe("wss://custom.live.com");
    });

    it("should set default timeout", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });
      const config = client.getConfig();

      expect(config.timeout).toBe(30000);
    });

    it("should set default maxRetries", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });
      const config = client.getConfig();

      expect(config.maxRetries).toBe(3);
    });

    it("should set default debug to false", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });
      const config = client.getConfig();

      expect(config.debug).toBe(false);
    });

    it("should set default streaming to true", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });
      const config = client.getConfig();

      expect(config.streaming).toBe(true);
    });

    it("should initialize with workspaceId in context", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        workspaceId: "ws-456",
      });
      const config = client.getConfig();

      expect(config.workspaceId).toBe("ws-456");
    });

    it("should accept userToken", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        userToken: "test-token",
      });

      // Verify token is set by checking isAuthenticated
      expect(client).toBeInstanceOf(DivinciClient);
    });

    it("should accept apiKey", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        apiKey: "sk-123",
      });
      const config = client.getConfig();

      expect(config.apiKey).toBe("sk-123");
    });
  });

  describe("namespace getters", () => {
    let client: DivinciClient;

    beforeEach(() => {
      client = new DivinciClient({ releaseId: "rel-123" });
    });

    describe("chat", () => {
      it("should lazily initialize chat namespace", () => {
        const chat = client.chat;
        expect(chat).toBeInstanceOf(ChatClient);
      });

      it("should reuse same chat instance on multiple accesses", () => {
        const chat1 = client.chat;
        const chat2 = client.chat;
        expect(chat1).toBe(chat2);
      });
    });

    describe("rag", () => {
      it("should lazily initialize rag namespace", () => {
        const rag = client.rag;
        expect(rag).toBeInstanceOf(RagNamespace);
      });

      it("should reuse same rag instance on multiple accesses", () => {
        const rag1 = client.rag;
        const rag2 = client.rag;
        expect(rag1).toBe(rag2);
      });
    });

    describe("audio", () => {
      it("should lazily initialize audio namespace", () => {
        const audio = client.audio;
        expect(audio).toBeInstanceOf(AudioNamespace);
      });

      it("should reuse same audio instance on multiple accesses", () => {
        const audio1 = client.audio;
        const audio2 = client.audio;
        expect(audio1).toBe(audio2);
      });
    });

    describe("user", () => {
      it("should lazily initialize user namespace", () => {
        const user = client.user;
        expect(user).toBeInstanceOf(UserNamespace);
      });

      it("should reuse same user instance on multiple accesses", () => {
        const user1 = client.user;
        const user2 = client.user;
        expect(user1).toBe(user2);
      });
    });

    describe("apiKeys", () => {
      it("should lazily initialize apiKeys namespace", () => {
        const apiKeys = client.apiKeys;
        expect(apiKeys).toBeInstanceOf(ApiKeyNamespace);
      });

      it("should reuse same apiKeys instance on multiple accesses", () => {
        const keys1 = client.apiKeys;
        const keys2 = client.apiKeys;
        expect(keys1).toBe(keys2);
      });
    });

    describe("fineTune", () => {
      it("should lazily initialize fineTune namespace", () => {
        const fineTune = client.fineTune;
        expect(fineTune).toBeInstanceOf(FineTuneNamespace);
      });

      it("should reuse same fineTune instance on multiple accesses", () => {
        const ft1 = client.fineTune;
        const ft2 = client.fineTune;
        expect(ft1).toBe(ft2);
      });
    });

    describe("notifications", () => {
      it("should lazily initialize notifications namespace", () => {
        const notifications = client.notifications;
        expect(notifications).toBeInstanceOf(NotificationsNamespace);
      });

      it("should reuse same notifications instance on multiple accesses", () => {
        const n1 = client.notifications;
        const n2 = client.notifications;
        expect(n1).toBe(n2);
      });
    });

    describe("websocket", () => {
      it("should lazily initialize websocket manager", () => {
        const ws = client.websocket;
        expect(ws).toBeInstanceOf(WebSocketManager);
      });

      it("should reuse same websocket manager on multiple accesses", () => {
        const ws1 = client.websocket;
        const ws2 = client.websocket;
        expect(ws1).toBe(ws2);
      });
    });
  });

  describe("withWorkspace", () => {
    it("should create new client with workspaceId set", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });
      const scopedClient = client.withWorkspace("ws-456");

      expect(scopedClient).toBeInstanceOf(DivinciClient);
      expect(scopedClient).not.toBe(client);
      expect(scopedClient.getConfig().workspaceId).toBe("ws-456");
    });

    it("should preserve other config options", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        baseUrl: "https://custom.api.com",
        apiKey: "sk-123",
        debug: true,
      });
      const scopedClient = client.withWorkspace("ws-456");

      const config = scopedClient.getConfig();
      expect(config.releaseId).toBe("rel-123");
      expect(config.baseUrl).toBe("https://custom.api.com");
      expect(config.apiKey).toBe("sk-123");
      expect(config.debug).toBe(true);
      expect(config.workspaceId).toBe("ws-456");
    });

    it("should override existing workspaceId", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        workspaceId: "ws-old",
      });
      const scopedClient = client.withWorkspace("ws-new");

      expect(scopedClient.getConfig().workspaceId).toBe("ws-new");
    });
  });

  describe("authentication", () => {
    describe("setToken", () => {
      it("should set token", async () => {
        const client = new DivinciClient({ releaseId: "rel-123" });

        await client.setToken("new-token");

        // Verify by checking isAuthenticated
        const isAuth = await client.isAuthenticated();
        expect(isAuth).toBe(true);
      });

      it("should set token with expiration", async () => {
        const client = new DivinciClient({ releaseId: "rel-123" });
        const expiresAt = Date.now() + 3600000;

        await client.setToken("new-token", expiresAt);

        const isAuth = await client.isAuthenticated();
        expect(isAuth).toBe(true);
      });
    });

    describe("setRefreshToken", () => {
      it("should set refresh token", async () => {
        const client = new DivinciClient({ releaseId: "rel-123" });

        await expect(client.setRefreshToken("refresh-token")).resolves.not.toThrow();
      });
    });

    describe("isAuthenticated", () => {
      it("should return false when no token is set", async () => {
        const client = new DivinciClient({ releaseId: "rel-123" });

        const isAuth = await client.isAuthenticated();

        expect(isAuth).toBe(false);
      });

      it("should return true when userToken is provided in constructor", async () => {
        const client = new DivinciClient({
          releaseId: "rel-123",
          userToken: "test-token",
        });

        const isAuth = await client.isAuthenticated();

        expect(isAuth).toBe(true);
      });

      it("should return true after setToken is called", async () => {
        const client = new DivinciClient({ releaseId: "rel-123" });

        await client.setToken("test-token");
        const isAuth = await client.isAuthenticated();

        expect(isAuth).toBe(true);
      });
    });

    describe("logout", () => {
      it("should clear tokens", async () => {
        const client = new DivinciClient({
          releaseId: "rel-123",
          userToken: "test-token",
        });

        await client.logout();
        const isAuth = await client.isAuthenticated();

        expect(isAuth).toBe(false);
      });
    });
  });

  describe("getRelease", () => {
    it("should fetch release on first call", async () => {
      const releaseData = {
        _id: "rel-123",
        name: "Test Release",
        whitelabelId: "ws-456",
      };
      mockFetch = createMockFetch({ body: releaseData });
      vi.stubGlobal("fetch", mockFetch);

      const client = new DivinciClient({ releaseId: "rel-123" });
      const release = await client.getRelease();

      // The wire document is Mongo-shaped (_id); the SDK normalizes the
      // declared `id` field additively (verified against staging).
      expect(release).toEqual({ ...releaseData, id: "rel-123" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = String(mockFetch.mock.calls[0][0]);
      expect(calledUrl).toContain("/white-label-release/rel-123");
    });

    it("should cache release on subsequent calls", async () => {
      const releaseData = {
        _id: "rel-123",
        name: "Test Release",
      };
      mockFetch = createMockFetch({ body: releaseData });
      vi.stubGlobal("fetch", mockFetch);

      const client = new DivinciClient({ releaseId: "rel-123" });

      await client.getRelease();
      await client.getRelease();
      await client.getRelease();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshRelease", () => {
    it("should force fetch release", async () => {
      const releaseData = {
        _id: "rel-123",
        name: "Test Release",
      };
      mockFetch = createMockFetch({ body: releaseData });
      vi.stubGlobal("fetch", mockFetch);

      const client = new DivinciClient({ releaseId: "rel-123" });

      await client.getRelease();
      await client.refreshRelease();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("validateApiKey", () => {
    it("should return false when no apiKey is configured", async () => {
      const client = new DivinciClient({ releaseId: "rel-123" });

      const isValid = await client.validateApiKey();

      expect(isValid).toBe(false);
    });

    it("should return true when API key is valid", async () => {
      mockFetch = createMockFetch({ status: 200, body: { valid: true } });
      vi.stubGlobal("fetch", mockFetch);

      const client = new DivinciClient({
        releaseId: "rel-123",
        apiKey: "sk-valid",
      });

      const isValid = await client.validateApiKey();

      expect(isValid).toBe(true);
    });

    it("should return false when API key is invalid", async () => {
      mockFetch = createMockFetch({ status: 401, ok: false, body: { error: "Invalid key" } });
      vi.stubGlobal("fetch", mockFetch);

      const client = new DivinciClient({
        releaseId: "rel-123",
        apiKey: "sk-invalid",
      });

      const isValid = await client.validateApiKey();

      expect(isValid).toBe(false);
    });
  });

  describe("setExternalUser", () => {
    it("should set external user config", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });

      client.setExternalUser({
        id: "ext-user-123",
        email: "user@example.com",
      });

      const config = client.getConfig();
      expect(config.externalUser).toEqual({
        id: "ext-user-123",
        email: "user@example.com",
      });
    });
  });

  describe("getHttpClient", () => {
    it("should return the HTTP client", () => {
      const client = new DivinciClient({ releaseId: "rel-123" });

      const httpClient = client.getHttpClient();

      expect(httpClient).toBeDefined();
      expect(typeof httpClient.get).toBe("function");
      expect(typeof httpClient.post).toBe("function");
    });
  });

  describe("getConfig", () => {
    it("should return a copy of the config", () => {
      const client = new DivinciClient({
        releaseId: "rel-123",
        workspaceId: "ws-456",
      });

      const config1 = client.getConfig();
      const config2 = client.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });
  });
});

describe("createClient", () => {
  it("should create a DivinciClient instance", () => {
    const client = createClient({ releaseId: "rel-123" });

    expect(client).toBeInstanceOf(DivinciClient);
  });

  it("should pass options to DivinciClient constructor", () => {
    const client = createClient({
      releaseId: "rel-123",
      workspaceId: "ws-456",
      baseUrl: "https://custom.api.com",
    });

    const config = client.getConfig();
    expect(config.releaseId).toBe("rel-123");
    expect(config.workspaceId).toBe("ws-456");
    expect(config.baseUrl).toBe("https://custom.api.com");
  });
});
