/**
 * ApiKeyNamespace tests
 *
 * Tests for API key management operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiKeyNamespace,
  type ApiKeyDoc,
  type CreatedApiKeyResponse,
  type RotateApiKeyResponse,
  type ApiKeyUser,
} from "../../src/namespaces/api-keys/index.js";
import type { HttpClient } from "../../src/http-client.js";

// Mock HttpClient
function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    postFormData: vi.fn(),
    getToken: vi.fn(),
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearTokens: vi.fn(),
  } as unknown as HttpClient;
}

// Sample data
const sampleApiKey: ApiKeyDoc = {
  _id: "key_123",
  whitelabelId: "ws_456",
  name: "Production Key",
  description: "Main production API key",
  prefix: "sk_prod_",
  permissions: {
    chat: true,
    rag: true,
    audio: false,
  },
  rateLimit: {
    requestsPerMinute: 100,
    requestsPerDay: 10000,
  },
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const sampleCreatedKey: CreatedApiKeyResponse = {
  ...sampleApiKey,
  secretKey: "sk_prod_abc123xyz",
};

const sampleRotateResponse: RotateApiKeyResponse = {
  newSecretKey: "sk_prod_new123xyz",
};

const sampleApiKeyUser: ApiKeyUser = {
  id: "user_123",
  externalUserId: "ext_user_456",
  email: "user@example.com",
  name: "Test User",
  lastActiveAt: "2024-01-15T00:00:00Z",
  createdAt: "2024-01-01T00:00:00Z",
};

describe("ApiKeyNamespace", () => {
  let mockHttpClient: HttpClient;
  let apiKeyNamespace: ApiKeyNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    apiKeyNamespace = new ApiKeyNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should POST new API key", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleCreatedKey);

      await apiKeyNamespace.create(
        { workspaceId: "ws-123" },
        { name: "New Key", permissions: { chat: true } }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys",
        { name: "New Key", permissions: { chat: true } }
      );
    });

    it("should return secretKey in response", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleCreatedKey);

      const result = await apiKeyNamespace.create(
        { workspaceId: "ws-123" },
        { name: "New Key" }
      );

      expect(result.secretKey).toBe("sk_prod_abc123xyz");
    });

    it("should include all optional fields", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleCreatedKey);

      await apiKeyNamespace.create(
        { workspaceId: "ws-123" },
        {
          name: "Full Key",
          description: "With all options",
          permissions: { chat: true, rag: true, audio: true },
          rateLimit: { requestsPerMinute: 60 },
          expiresAt: "2025-12-31",
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          name: "Full Key",
          description: "With all options",
          permissions: { chat: true, rag: true, audio: true },
          rateLimit: { requestsPerMinute: 60 },
          expiresAt: "2025-12-31",
        }
      );
    });
  });

  describe("list", () => {
    it("should GET all API keys", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleApiKey]);

      await apiKeyNamespace.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys"
      );
    });

    it("should return array of ApiKeyDoc", async () => {
      const keys = [sampleApiKey, { ...sampleApiKey, _id: "key_456" }];
      vi.mocked(mockHttpClient.get).mockResolvedValue(keys);

      const result = await apiKeyNamespace.list({ workspaceId: "ws-123" });

      expect(result).toEqual(keys);
      expect(result).toHaveLength(2);
    });

    it("should use workspaceId from context", async () => {
      const scopedNamespace = new ApiKeyNamespace(mockHttpClient, {
        workspaceId: "context-ws",
      });
      vi.mocked(mockHttpClient.get).mockResolvedValue([]);

      await scopedNamespace.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/context-ws/api-keys"
      );
    });
  });

  describe("get", () => {
    it("should GET single API key by keyId", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleApiKey);

      await apiKeyNamespace.get({ workspaceId: "ws-123", keyId: "key-456" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys/key-456"
      );
    });
  });

  describe("update", () => {
    it("should PATCH API key", async () => {
      vi.mocked(mockHttpClient.patch).mockResolvedValue(sampleApiKey);

      await apiKeyNamespace.update(
        { workspaceId: "ws-123", keyId: "key-456" },
        { name: "Updated Name", permissions: { chat: false } }
      );

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys/key-456",
        { name: "Updated Name", permissions: { chat: false } }
      );
    });
  });

  describe("delete", () => {
    it("should DELETE API key", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(undefined);

      await apiKeyNamespace.delete({ workspaceId: "ws-123", keyId: "key-456" });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys/key-456"
      );
    });
  });

  describe("rotate", () => {
    it("should POST to rotate endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleRotateResponse);

      await apiKeyNamespace.rotate({ workspaceId: "ws-123", keyId: "key-456" });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys/key-456/rotate",
        {}
      );
    });

    it("should return newSecretKey", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleRotateResponse);

      const result = await apiKeyNamespace.rotate({
        workspaceId: "ws-123",
        keyId: "key-456",
      });

      expect(result.newSecretKey).toBe("sk_prod_new123xyz");
    });
  });

  describe("getUsers", () => {
    it("should GET users of API key", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleApiKeyUser]);

      await apiKeyNamespace.getUsers({
        workspaceId: "ws-123",
        keyId: "key-456",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys/key-456/users"
      );
    });

    it("should return array of ApiKeyUser", async () => {
      const users = [sampleApiKeyUser];
      vi.mocked(mockHttpClient.get).mockResolvedValue(users);

      const result = await apiKeyNamespace.getUsers({
        workspaceId: "ws-123",
        keyId: "key-456",
      });

      expect(result).toEqual(users);
    });
  });

  describe("withWorkspace", () => {
    it("should return scoped namespace", () => {
      const scoped = apiKeyNamespace.withWorkspace("ws-123");

      expect(scoped).toBeInstanceOf(ApiKeyNamespace);
      expect(scoped).not.toBe(apiKeyNamespace);
    });

    it("should inherit workspaceId for operations", async () => {
      const scoped = apiKeyNamespace.withWorkspace("ws-123");
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleApiKey]);

      await scoped.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/api-keys"
      );
    });

    it("should allow params to override context workspaceId", async () => {
      const scoped = apiKeyNamespace.withWorkspace("context-ws");
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleApiKey]);

      await scoped.list({ workspaceId: "override-ws" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/override-ws/api-keys"
      );
    });
  });
});
