/**
 * AudioClient tests
 *
 * Tests for audio transcript management operations
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioClient } from "../src/audio/index.js";
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

describe("AudioClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("list", () => {
    it("should list audio transcripts with workspace ID", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        data: [
          { _id: "audio-1", workspaceId: "ws-123", status: "completed" },
          { _id: "audio-2", workspaceId: "ws-123", status: "processing" },
        ],
        hasMore: false,
      });

      const client = new AudioClient(mockHttpClient);
      const result = await client.list("ws-123");

      expect(result.data).toHaveLength(2);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/audio-transcripts",
        {
          workspaceId: "ws-123",
          limit: undefined,
          cursor: undefined,
        }
      );
    });

    it("should list audio transcripts with pagination options", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        data: [{ _id: "audio-3", workspaceId: "ws-123", status: "completed" }],
        hasMore: true,
        cursor: "cursor-next",
      });

      const client = new AudioClient(mockHttpClient);
      const result = await client.list("ws-123", { limit: 5, cursor: "cursor-start" });

      expect(result.data).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/audio-transcripts",
        {
          workspaceId: "ws-123",
          limit: 5,
          cursor: "cursor-start",
        }
      );
    });
  });

  describe("get", () => {
    it("should get an audio transcript by ID", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        _id: "audio-123",
        workspaceId: "ws-456",
        url: "https://example.com/audio.mp3",
        status: "completed",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const client = new AudioClient(mockHttpClient);
      const result = await client.get("audio-123");

      expect(result._id).toBe("audio-123");
      expect(result.status).toBe("completed");
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/audio-transcripts/audio-123"
      );
    });
  });

  describe("uploadFromUrl", () => {
    it("should upload an audio file from a URL", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        _id: "audio-new",
        workspaceId: "ws-123",
        url: "https://example.com/podcast.mp3",
        status: "processing",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const client = new AudioClient(mockHttpClient);
      const result = await client.uploadFromUrl("ws-123", "https://example.com/podcast.mp3");

      expect(result._id).toBe("audio-new");
      expect(result.status).toBe("processing");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/audio-transcripts/url",
        {
          workspaceId: "ws-123",
          url: "https://example.com/podcast.mp3",
        }
      );
    });
  });

  describe("delete", () => {
    it("should delete an audio transcript", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.delete = vi.fn().mockResolvedValue(undefined);

      const client = new AudioClient(mockHttpClient);
      await client.delete("audio-123");

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/api/v1/audio-transcripts/audio-123"
      );
    });
  });

  describe("generateRag", () => {
    it("should generate RAG data from an audio transcript", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        success: true,
        message: "RAG generation initiated",
      });

      const client = new AudioClient(mockHttpClient);
      const result = await client.generateRag("audio-123");

      expect(result.success).toBe(true);
      expect(result.message).toBe("RAG generation initiated");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/audio-transcripts/audio-123/generate-rag"
      );
    });

    it("should handle failed RAG generation", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        success: false,
        message: "Audio transcript not ready",
      });

      const client = new AudioClient(mockHttpClient);
      const result = await client.generateRag("audio-456");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Audio transcript not ready");
    });
  });

  describe("error handling", () => {
    it("should propagate errors from httpClient", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockRejectedValue(new Error("Not found"));

      const client = new AudioClient(mockHttpClient);

      await expect(client.get("nonexistent")).rejects.toThrow("Not found");
    });

    it("should propagate errors on delete", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.delete = vi.fn().mockRejectedValue(new Error("Forbidden"));

      const client = new AudioClient(mockHttpClient);

      await expect(client.delete("audio-123")).rejects.toThrow("Forbidden");
    });
  });
});
