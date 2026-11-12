/**
 * RagClient tests
 *
 * Tests the published RagClient surface against the REAL /api/v1/rag/* routes
 * (targets / files / context). The earlier /api/v1/whitelabel/:ws/rag-vector
 * paths never existed on the server; the client was rewritten to the verified
 * contract and these tests assert that contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RagClient } from "../src/rag/index.js";
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

describe("RagClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("listCollections", () => {
    it("should list collections from /api/v1/rag/targets", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        targets: [
          { id: "col-1", title: "Collection 1" },
          { id: "col-2", title: "Collection 2" },
        ],
        total: 2,
      });

      const client = new RagClient(mockHttpClient);
      const result = await client.listCollections("ws-123", { limit: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("col-1");
      expect(result.data[0].name).toBe("Collection 1");
      expect(result.total).toBe(2);
      expect(mockHttpClient.get).toHaveBeenCalledWith("/api/v1/rag/targets");
    });
  });

  describe("getCollection", () => {
    it("should resolve a collection by ID from the targets list", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        targets: [
          { id: "col-123", title: "Test Collection" },
          { id: "col-999", title: "Other" },
        ],
      });

      const client = new RagClient(mockHttpClient);
      const result = await client.getCollection("ws-123", "col-123");

      expect(result.id).toBe("col-123");
      expect(result.name).toBe("Test Collection");
      expect(mockHttpClient.get).toHaveBeenCalledWith("/api/v1/rag/targets");
    });

    it("should throw when the collection is not found", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({ targets: [] });

      const client = new RagClient(mockHttpClient);
      await expect(client.getCollection("ws-123", "missing")).rejects.toThrow(
        "RAG collection missing not found"
      );
    });
  });

  describe("createCollection", () => {
    it("should POST to /api/v1/rag/targets with a vectorIndexTool default", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        id: "col-new",
        title: "New Collection",
      });

      const client = new RagClient(mockHttpClient);
      const result = await client.createCollection({
        workspaceId: "ws-123",
        name: "New Collection",
        description: "Test collection",
        settings: { maxChunksPerQuery: 8, similarityThreshold: 0.7 },
      });

      expect(result.id).toBe("col-new");
      expect(mockHttpClient.post).toHaveBeenCalledWith("/api/v1/rag/targets", {
        title: "New Collection",
        vectorIndexTool: "vectorize",
        minimumSimilarity: 0.7,
        contextPerMessage: 8,
      });
    });
  });

  describe("uploadDocument", () => {
    it("should upload to /api/v1/rag/files with the collection assignment fields", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.upload = vi.fn().mockResolvedValue({
        _id: "doc-123",
        status: "pending",
      });

      const client = new RagClient(mockHttpClient);
      const fileBuffer = Buffer.from("test content");

      const result = await client.uploadDocument(
        "ws-123",
        "col-456",
        fileBuffer,
        "test.pdf"
      );

      expect(result.id).toBe("doc-123");
      expect(mockHttpClient.upload).toHaveBeenCalledWith(
        "/api/v1/rag/files",
        fileBuffer,
        "test.pdf",
        {
          ragVectorIds: JSON.stringify(["col-456"]),
          title: "test.pdf",
          description: "",
          chunkingTool: "langextract",
          chunkingToolConfig: JSON.stringify({ langextract: { chapterAware: false } }),
        }
      );
    });

    it("should serialize metadata as JSON", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.upload = vi.fn().mockResolvedValue({
        _id: "doc-123",
        status: "pending",
      });

      const client = new RagClient(mockHttpClient);
      const fileBuffer = Buffer.from("test content");

      await client.uploadDocument("ws-123", "col-456", fileBuffer, "test.pdf", {
        metadata: { source: "test", tags: ["important"] },
      });

      expect(mockHttpClient.upload).toHaveBeenCalledWith(
        "/api/v1/rag/files",
        fileBuffer,
        "test.pdf",
        expect.objectContaining({
          metadata: JSON.stringify({ source: "test", tags: ["important"] }),
        })
      );
    });

    it("should tolerate an array response (multi-file create endpoint)", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.upload = vi.fn().mockResolvedValue([
        { _id: "doc-arr", status: "pending" },
      ]);

      const client = new RagClient(mockHttpClient);
      const result = await client.uploadDocument(
        "ws-123",
        "col-456",
        Buffer.from("x"),
        "a.pdf"
      );

      expect(result.id).toBe("doc-arr");
    });
  });

  describe("getDocument", () => {
    it("should get a document from /api/v1/rag/files/:id", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        _id: "doc-123",
        status: "completed",
        chunksCount: 5,
      });

      const client = new RagClient(mockHttpClient);
      const result = await client.getDocument("ws-123", "col-456", "doc-123");

      expect(result.status).toBe("completed");
      expect(result.chunkCount).toBe(5);
      expect(mockHttpClient.get).toHaveBeenCalledWith("/api/v1/rag/files/doc-123");
    });
  });

  describe("search", () => {
    it("should POST to /api/v1/rag/context with the query and collection", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        chunks: [
          { content: "Result 1", score: 0.95, source: "a.pdf", fileId: "f1", vectorId: "v1" },
          { content: "Result 2", score: 0.85, source: "b.pdf", fileId: "f2", vectorId: "v2" },
        ],
      });

      const client = new RagClient(mockHttpClient);
      const results = await client.search("ws-123", "col-456", "test query", {
        limit: 5,
        minScore: 0.7,
      });

      expect(results).toHaveLength(2);
      expect(results[0].chunk.content).toBe("Result 1");
      expect(mockHttpClient.post).toHaveBeenCalledWith("/api/v1/rag/context", {
        query: "test query",
        collectionId: "col-456",
        topK: 5,
      });
    });

    it("should apply minScore client-side", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue({
        chunks: [
          { content: "High", score: 0.95, source: null, fileId: null, vectorId: null },
          { content: "Low", score: 0.4, source: null, fileId: null, vectorId: null },
        ],
      });

      const client = new RagClient(mockHttpClient);
      const results = await client.search("ws-123", "col-456", "q", { minScore: 0.7 });

      expect(results).toHaveLength(1);
      expect(results[0].chunk.content).toBe("High");
    });
  });

  describe("searchMultiple", () => {
    it("should fan out one /context call per collection and merge by score", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi
        .fn()
        .mockResolvedValueOnce({
          chunks: [{ content: "From col-1", score: 0.85, source: null, fileId: null, vectorId: null }],
        })
        .mockResolvedValueOnce({
          chunks: [{ content: "From col-2", score: 0.9, source: null, fileId: null, vectorId: null }],
        });

      const client = new RagClient(mockHttpClient);
      const results = await client.searchMultiple(
        "ws-123",
        ["col-1", "col-2"],
        "test query"
      );

      expect(results).toHaveLength(2);
      // Merged by descending score: col-2 (0.9) before col-1 (0.85)
      expect(results[0].chunk.content).toBe("From col-2");
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.post).toHaveBeenCalledWith("/api/v1/rag/context", {
        query: "test query",
        collectionId: "col-1",
      });
    });
  });

  describe("uploadDocuments", () => {
    it("should upload multiple documents sequentially", async () => {
      const mockHttpClient = createMockHttpClient();
      let uploadCount = 0;
      mockHttpClient.upload = vi.fn().mockImplementation(() => {
        uploadCount++;
        return Promise.resolve({
          _id: `doc-${uploadCount}`,
          status: "pending",
        });
      });

      const client = new RagClient(mockHttpClient);
      const files = [
        { file: Buffer.from("content 1"), fileName: "file1.pdf" },
        { file: Buffer.from("content 2"), fileName: "file2.pdf" },
        { file: Buffer.from("content 3"), fileName: "file3.pdf" },
      ];

      const results = await client.uploadDocuments("ws-123", "col-456", files);

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("doc-1");
      expect(results[2].id).toBe("doc-3");
      expect(mockHttpClient.upload).toHaveBeenCalledTimes(3);
    });
  });

  describe("waitForProcessing", () => {
    it("should poll until status is completed", async () => {
      const mockHttpClient = createMockHttpClient();
      let pollCount = 0;
      mockHttpClient.get = vi.fn().mockImplementation(() => {
        pollCount++;
        return Promise.resolve({
          _id: "doc-123",
          status: pollCount < 3 ? "processing" : "completed",
          chunksCount: pollCount < 3 ? 0 : 5,
        });
      });

      const client = new RagClient(mockHttpClient);

      const resultPromise = client.waitForProcessing("ws-123", "col-456", "doc-123", {
        pollInterval: 1000,
      });

      // Advance timers for polling
      await vi.advanceTimersByTimeAsync(1000); // First poll
      await vi.advanceTimersByTimeAsync(1000); // Second poll
      await vi.advanceTimersByTimeAsync(1000); // Third poll (completed)

      const result = await resultPromise;

      expect(result.status).toBe("completed");
      expect(result.chunkCount).toBe(5);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(3);
    });

    it("should return immediately if status is error", async () => {
      const mockHttpClient = createMockHttpClient();
      let pollCount = 0;
      mockHttpClient.get = vi.fn().mockImplementation(() => {
        pollCount++;
        return Promise.resolve({
          _id: "doc-123",
          status: pollCount < 2 ? "processing" : "failed",
          failureReason: "Failed to parse document",
        });
      });

      const client = new RagClient(mockHttpClient);

      const resultPromise = client.waitForProcessing("ws-123", "col-456", "doc-123", {
        pollInterval: 500,
      });

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);

      const result = await resultPromise;

      expect(result.status).toBe("error");
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });

    it("should throw after timeout", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        _id: "doc-123",
        status: "processing",
      });

      const client = new RagClient(mockHttpClient);

      const resultPromise = client.waitForProcessing("ws-123", "col-456", "doc-123", {
        timeout: 5000,
        pollInterval: 1000,
      });

      // Suppress unhandled rejection warning
      resultPromise.catch(() => {});

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(6000);

      await expect(resultPromise).rejects.toThrow("timed out");
    });

    it("should respect custom pollInterval", async () => {
      const mockHttpClient = createMockHttpClient();
      let pollCount = 0;
      mockHttpClient.get = vi.fn().mockImplementation(() => {
        pollCount++;
        return Promise.resolve({
          _id: "doc-123",
          status: pollCount < 2 ? "processing" : "completed",
        });
      });

      const client = new RagClient(mockHttpClient);

      const resultPromise = client.waitForProcessing("ws-123", "col-456", "doc-123", {
        pollInterval: 500,
      });

      // With 500ms interval, should poll twice in 600ms
      await vi.advanceTimersByTimeAsync(600);

      await resultPromise;

      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });

    it("should use default timeout of 300000ms", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue({
        _id: "doc-123",
        status: "processing",
      });

      const client = new RagClient(mockHttpClient);

      const resultPromise = client.waitForProcessing("ws-123", "col-456", "doc-123");

      // Suppress unhandled rejection warning
      resultPromise.catch(() => {});

      // Advance just under default timeout (5 minutes)
      await vi.advanceTimersByTimeAsync(299000);

      // Should still be pending
      expect(mockHttpClient.get).toHaveBeenCalled();

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(2000);

      await expect(resultPromise).rejects.toThrow("timed out after 300000ms");
    });
  });

  describe("deleteDocument", () => {
    it("should delete via /api/v1/rag/files/:id", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.delete = vi.fn().mockResolvedValue(undefined);

      const client = new RagClient(mockHttpClient);
      await client.deleteDocument("ws-123", "col-456", "doc-789");

      expect(mockHttpClient.delete).toHaveBeenCalledWith("/api/v1/rag/files/doc-789");
    });
  });

  describe("reprocessDocument", () => {
    it("should trigger reindex then re-read the document", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.post = vi.fn().mockResolvedValue(undefined);
      mockHttpClient.get = vi.fn().mockResolvedValue({
        _id: "doc-123",
        status: "pending",
      });

      const client = new RagClient(mockHttpClient);
      const result = await client.reprocessDocument("ws-123", "col-456", "doc-123");

      expect(result.status).toBe("pending");
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/rag/files/doc-123/reindex"
      );
      expect(mockHttpClient.get).toHaveBeenCalledWith("/api/v1/rag/files/doc-123");
    });
  });

  describe("listDocuments", () => {
    it("should list files, filtering by collection membership and status", async () => {
      const mockHttpClient = createMockHttpClient();
      mockHttpClient.get = vi.fn().mockResolvedValue([
        { _id: "doc-1", status: "completed", ragVectors: [{ _id: "col-456" }] },
        { _id: "doc-2", status: "completed", ragVectors: [{ _id: "other" }] },
        { _id: "doc-3", status: "pending", ragVectors: [{ _id: "col-456" }] },
      ]);

      const client = new RagClient(mockHttpClient);
      const result = await client.listDocuments("ws-123", "col-456", {
        status: "completed",
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("doc-1");
      expect(mockHttpClient.get).toHaveBeenCalledWith("/api/v1/rag/files", {
        page: 1,
        limit: 20,
      });
    });
  });
});
