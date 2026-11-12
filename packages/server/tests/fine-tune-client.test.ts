/**
 * FineTuneClient tests
 *
 * Tests for fine-tuning job management operations
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FineTuneClient } from "../src/fine-tune/index.js";
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

describe("FineTuneClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("list", () => {
    it("should list fine-tune jobs with workspace ID", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        data: [
          { _id: "ft-1", workspaceId: "ws-123", name: "Job 1", status: "completed" },
          { _id: "ft-2", workspaceId: "ws-123", name: "Job 2", status: "running" },
        ],
        hasMore: false,
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.list("ws-123");

      expect(result.data).toHaveLength(2);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs",
        {
          workspaceId: "ws-123",
          limit: undefined,
          cursor: undefined,
        }
      );
    });

    it("should list fine-tune jobs with pagination options", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        data: [{ _id: "ft-3", workspaceId: "ws-123", name: "Job 3", status: "pending" }],
        hasMore: true,
        cursor: "cursor-next",
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.list("ws-123", { limit: 5, cursor: "cursor-start" });

      expect(result.data).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs",
        {
          workspaceId: "ws-123",
          limit: 5,
          cursor: "cursor-start",
        }
      );
    });
  });

  describe("get", () => {
    it("should get a fine-tune job by ID", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        _id: "ft-123",
        workspaceId: "ws-456",
        name: "My Fine-Tune",
        baseModel: "llama-3.3-70b",
        status: "completed",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.get("ft-123");

      expect(result._id).toBe("ft-123");
      expect(result.name).toBe("My Fine-Tune");
      expect(result.baseModel).toBe("llama-3.3-70b");
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs/ft-123"
      );
    });
  });

  describe("create", () => {
    it("should create a fine-tune job", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        _id: "ft-new",
        workspaceId: "ws-123",
        name: "New Fine-Tune",
        baseModel: "llama-3.3-70b",
        status: "pending",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const trainingData = [
        { input: "What is AI?", output: "Artificial Intelligence..." },
      ];

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.create({
        workspaceId: "ws-123",
        name: "New Fine-Tune",
        baseModel: "llama-3.3-70b",
        trainingData,
      });

      expect(result._id).toBe("ft-new");
      expect(result.status).toBe("pending");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs",
        {
          workspaceId: "ws-123",
          name: "New Fine-Tune",
          baseModel: "llama-3.3-70b",
          trainingData,
        }
      );
    });
  });

  describe("delete", () => {
    it("should delete a fine-tune job", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.delete = vi.fn().mockResolvedValue(undefined);

      const client = new FineTuneClient(mockHttpClient);
      await client.delete("ft-123");

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs/ft-123"
      );
    });
  });

  describe("start", () => {
    it("should start a fine-tune job", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        _id: "ft-123",
        workspaceId: "ws-456",
        name: "My Fine-Tune",
        baseModel: "llama-3.3-70b",
        status: "running",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T01:00:00Z",
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.start("ft-123");

      expect(result.status).toBe("running");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs/ft-123/start"
      );
    });
  });

  describe("status", () => {
    it("should get the status of a fine-tune job", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        jobId: "ft-123",
        status: "running",
        progress: 45,
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.status("ft-123");

      expect(result.jobId).toBe("ft-123");
      expect(result.status).toBe("running");
      expect(result.progress).toBe(45);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs/ft-123/status"
      );
    });

    it("should return error status with error message", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        jobId: "ft-456",
        status: "failed",
        error: "Insufficient training data",
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.status("ft-456");

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Insufficient training data");
    });
  });

  describe("cancel", () => {
    it("should cancel a running fine-tune job", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        _id: "ft-123",
        workspaceId: "ws-456",
        name: "My Fine-Tune",
        baseModel: "llama-3.3-70b",
        status: "cancelled",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T02:00:00Z",
      });

      const client = new FineTuneClient(mockHttpClient);
      const result = await client.cancel("ft-123");

      expect(result.status).toBe("cancelled");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/fine-tune/jobs/ft-123/cancel"
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from httpClient", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockRejectedValue(new Error("Not found"));

      const client = new FineTuneClient(mockHttpClient);

      await expect(client.get("nonexistent")).rejects.toThrow("Not found");
    });

    it("should propagate errors on start", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockRejectedValue(new Error("Job already running"));

      const client = new FineTuneClient(mockHttpClient);

      await expect(client.start("ft-123")).rejects.toThrow("Job already running");
    });

    it("should propagate errors on cancel", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockRejectedValue(new Error("Job not running"));

      const client = new FineTuneClient(mockHttpClient);

      await expect(client.cancel("ft-123")).rejects.toThrow("Job not running");
    });
  });
});
