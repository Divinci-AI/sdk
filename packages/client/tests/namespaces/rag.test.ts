/**
 * RagNamespace tests
 *
 * Tests for RAG vector index operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RagNamespace,
  VectorIndexNamespace,
  type RagVectorDoc,
} from "../../src/namespaces/rag/index.js";
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

// Sample vector document
const sampleVector: RagVectorDoc = {
  _id: "rag-123",
  title: "Test Vector",
  description: "Test description",
  vectorIndexTool: "qdrant",
  whitelabelId: "ws-456",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  fileCount: 10,
  status: "ready",
};

describe("VectorIndexNamespace", () => {
  let mockHttpClient: HttpClient;
  let vectorIndex: VectorIndexNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    vectorIndex = new VectorIndexNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should POST to /white-label/:workspaceId/rag-vector", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      const body = {
        title: "New Vector",
        description: "Description",
        vectorIndexTool: "qdrant",
      };

      await vectorIndex.create({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector",
        body
      );
    });

    it("should use workspaceId from params", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      await vectorIndex.create(
        { workspaceId: "params-ws" },
        { title: "Test", description: "Test", vectorIndexTool: "qdrant" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/params-ws/rag-vector",
        expect.any(Object)
      );
    });

    it("should use workspaceId from context when not in params", async () => {
      const contextVectorIndex = new VectorIndexNamespace(mockHttpClient, {
        workspaceId: "context-ws",
      });
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      await contextVectorIndex.create(
        {},
        { title: "Test", description: "Test", vectorIndexTool: "qdrant" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/context-ws/rag-vector",
        expect.any(Object)
      );
    });

    it("should throw when no workspaceId available", async () => {
      await expect(
        vectorIndex.create(
          {},
          { title: "Test", description: "Test", vectorIndexTool: "qdrant" }
        )
      ).rejects.toThrow("workspaceId is required");
    });

    it("should send title, description, vectorIndexTool in body", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      await vectorIndex.create(
        { workspaceId: "ws-123" },
        {
          title: "My Docs",
          description: "Documentation index",
          vectorIndexTool: "pinecone",
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          title: "My Docs",
          description: "Documentation index",
          vectorIndexTool: "pinecone",
        }
      );
    });

    it("should return RagVectorDoc", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      const result = await vectorIndex.create(
        { workspaceId: "ws-123" },
        { title: "Test", description: "Test", vectorIndexTool: "qdrant" }
      );

      expect(result).toEqual(sampleVector);
    });
  });

  describe("list", () => {
    it("should GET from /white-label/:workspaceId/rag-vector", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleVector]);

      await vectorIndex.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector"
      );
    });

    it("should return array of RagVectorDoc", async () => {
      const vectors = [sampleVector, { ...sampleVector, _id: "rag-456" }];
      vi.mocked(mockHttpClient.get).mockResolvedValue(vectors);

      const result = await vectorIndex.list({ workspaceId: "ws-123" });

      expect(result).toEqual(vectors);
      expect(result).toHaveLength(2);
    });

    it("should use workspaceId from context", async () => {
      const contextVectorIndex = new VectorIndexNamespace(mockHttpClient, {
        workspaceId: "context-ws",
      });
      vi.mocked(mockHttpClient.get).mockResolvedValue([]);

      await contextVectorIndex.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/context-ws/rag-vector"
      );
    });
  });

  describe("get", () => {
    it("should GET from /white-label/:workspaceId/rag-vector/:ragId", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleVector);

      await vectorIndex.get({ workspaceId: "ws-123", ragId: "rag-456" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector/rag-456"
      );
    });

    it("should return RagVectorDoc", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleVector);

      const result = await vectorIndex.get({
        workspaceId: "ws-123",
        ragId: "rag-456",
      });

      expect(result).toEqual(sampleVector);
    });

    it("should use workspaceId from context", async () => {
      const contextVectorIndex = new VectorIndexNamespace(mockHttpClient, {
        workspaceId: "context-ws",
      });
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleVector);

      await contextVectorIndex.get({ ragId: "rag-456" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/context-ws/rag-vector/rag-456"
      );
    });
  });

  describe("update", () => {
    it("should POST to /white-label/:workspaceId/rag-vector/:ragId/user-info", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      await vectorIndex.update(
        { workspaceId: "ws-123", ragId: "rag-456" },
        { title: "Updated", description: "Updated desc" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector/rag-456/user-info",
        { title: "Updated", description: "Updated desc" }
      );
    });

    it("should send title and description in body", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleVector);

      await vectorIndex.update(
        { workspaceId: "ws-123", ragId: "rag-456" },
        { title: "New Title", description: "New Description" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        { title: "New Title", description: "New Description" }
      );
    });
  });

  describe("fork", () => {
    it("should POST to fork endpoint", async () => {
      const forkedVector = { ...sampleVector, _id: "rag-789", title: "Forked" };
      vi.mocked(mockHttpClient.post).mockResolvedValue(forkedVector);

      await vectorIndex.fork(
        { workspaceId: "ws-123", ragId: "rag-456" },
        { title: "Forked Index" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector/rag-456/fork",
        { title: "Forked Index" }
      );
    });

    it("should return new RagVectorDoc", async () => {
      const forkedVector = { ...sampleVector, _id: "rag-789", title: "Forked" };
      vi.mocked(mockHttpClient.post).mockResolvedValue(forkedVector);

      const result = await vectorIndex.fork(
        { workspaceId: "ws-123", ragId: "rag-456" },
        { title: "Forked Index" }
      );

      expect(result._id).toBe("rag-789");
      expect(result.title).toBe("Forked");
    });
  });

  describe("delete", () => {
    it("should DELETE from /white-label/:workspaceId/rag-vector/:ragId", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(sampleVector);

      await vectorIndex.delete({ workspaceId: "ws-123", ragId: "rag-456" });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector/rag-456"
      );
    });

    it("should return deleted RagVectorDoc", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(sampleVector);

      const result = await vectorIndex.delete({
        workspaceId: "ws-123",
        ragId: "rag-456",
      });

      expect(result).toEqual(sampleVector);
    });
  });
});

describe("RagNamespace", () => {
  let mockHttpClient: HttpClient;
  let ragNamespace: RagNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    ragNamespace = new RagNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("vectorIndex", () => {
    it("should lazily initialize VectorIndexNamespace", () => {
      const vectorIndex = ragNamespace.vectorIndex;

      expect(vectorIndex).toBeInstanceOf(VectorIndexNamespace);
    });

    it("should reuse same VectorIndexNamespace on multiple accesses", () => {
      const vectorIndex1 = ragNamespace.vectorIndex;
      const vectorIndex2 = ragNamespace.vectorIndex;

      expect(vectorIndex1).toBe(vectorIndex2);
    });
  });

  describe("withWorkspace", () => {
    it("should return new RagNamespace with workspaceId set", () => {
      const scopedRag = ragNamespace.withWorkspace("ws-123");

      expect(scopedRag).toBeInstanceOf(RagNamespace);
      expect(scopedRag).not.toBe(ragNamespace);
    });

    it("should inherit workspaceId to vectorIndex", async () => {
      const scopedRag = ragNamespace.withWorkspace("ws-123");
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleVector]);

      await scopedRag.vectorIndex.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/rag-vector"
      );
    });

    it("should allow params to override context workspaceId", async () => {
      const scopedRag = ragNamespace.withWorkspace("context-ws");
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleVector]);

      await scopedRag.vectorIndex.list({ workspaceId: "override-ws" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/override-ws/rag-vector"
      );
    });
  });
});
