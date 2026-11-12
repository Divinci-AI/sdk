/**
 * ConfigClient tests
 *
 * Tests for workspace configuration operations
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigClient } from "../src/config/index.js";
import { ServerHttpClient } from "../src/http-client.js";

// Mock ServerHttpClient
function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

describe("ConfigClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("get", () => {
    it("should get workspace configuration", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        workspaceId: "ws-123",
        title: "My Workspace",
        description: "A test workspace",
      });

      const client = new ConfigClient(mockHttpClient);
      const result = await client.get("ws-123");

      expect(result.workspaceId).toBe("ws-123");
      expect(result.title).toBe("My Workspace");
      expect(result.description).toBe("A test workspace");
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/config",
        {
          workspaceId: "ws-123",
        }
      );
    });

    it("should return config with additional fields", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        workspaceId: "ws-123",
        title: "My Workspace",
        customField: "custom-value",
        nestedConfig: { key: "value" },
      });

      const client = new ConfigClient(mockHttpClient);
      const result = await client.get("ws-123");

      expect(result.workspaceId).toBe("ws-123");
      expect(result["customField"]).toBe("custom-value");
    });
  });

  describe("updateTitle", () => {
    it("should update workspace title", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.patch = vi.fn().mockResolvedValue({
        workspaceId: "ws-123",
        title: "Updated Title",
        description: "A test workspace",
      });

      const client = new ConfigClient(mockHttpClient);
      const result = await client.updateTitle("ws-123", "Updated Title");

      expect(result.title).toBe("Updated Title");
      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/api/v1/config/title",
        {
          workspaceId: "ws-123",
          title: "Updated Title",
        }
      );
    });

    it("should handle empty title", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.patch = vi.fn().mockResolvedValue({
        workspaceId: "ws-123",
        title: "",
      });

      const client = new ConfigClient(mockHttpClient);
      const result = await client.updateTitle("ws-123", "");

      expect(result.title).toBe("");
      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/api/v1/config/title",
        {
          workspaceId: "ws-123",
          title: "",
        }
      );
    });
  });

  describe("updateDescription", () => {
    it("should update workspace description", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.patch = vi.fn().mockResolvedValue({
        workspaceId: "ws-123",
        title: "My Workspace",
        description: "Updated description",
      });

      const client = new ConfigClient(mockHttpClient);
      const result = await client.updateDescription("ws-123", "Updated description");

      expect(result.description).toBe("Updated description");
      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/api/v1/config/description",
        {
          workspaceId: "ws-123",
          description: "Updated description",
        }
      );
    });

    it("should handle long descriptions", async () => {
      const mockHttpClient = createMockHttpClient();
      const longDescription = "A".repeat(1000);
      mockHttpClient.patch = vi.fn().mockResolvedValue({
        workspaceId: "ws-123",
        description: longDescription,
      });

      const client = new ConfigClient(mockHttpClient);
      const result = await client.updateDescription("ws-123", longDescription);

      expect(result.description).toBe(longDescription);
      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/api/v1/config/description",
        {
          workspaceId: "ws-123",
          description: longDescription,
        }
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from httpClient on get", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockRejectedValue(new Error("Not found"));

      const client = new ConfigClient(mockHttpClient);

      await expect(client.get("nonexistent")).rejects.toThrow("Not found");
    });

    it("should propagate errors from httpClient on updateTitle", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.patch = vi.fn().mockRejectedValue(new Error("Forbidden"));

      const client = new ConfigClient(mockHttpClient);

      await expect(client.updateTitle("ws-123", "New Title")).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from httpClient on updateDescription", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.patch = vi.fn().mockRejectedValue(new Error("Server error"));

      const client = new ConfigClient(mockHttpClient);

      await expect(client.updateDescription("ws-123", "New Desc")).rejects.toThrow("Server error");
    });
  });
});
