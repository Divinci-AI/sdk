/**
 * FineTuneNamespace tests
 *
 * Tests for fine-tuning jobs and training file operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FineTuneNamespace,
  FineTuneFilesNamespace,
  type FineTuneDoc,
  type FineTuneFileDoc,
  type FineTuneFileEntry,
} from "../../src/namespaces/fine-tune/index.js";
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
const sampleFineTuneDoc: FineTuneDoc = {
  _id: "ft_123",
  whitelabelId: "ws_456",
  title: "Customer Support Model",
  description: "Fine-tuned for support queries",
  finetuneTool: "openai",
  status: "completed",
  baseModel: "gpt-3.5-turbo",
  hyperparameters: {
    epochs: 3,
    batchSize: 4,
    learningRateMultiplier: 1.0,
  },
  trainingFileIds: ["file_1", "file_2"],
  resultModelId: "ft:gpt-3.5-turbo:acme:custom:123",
  metrics: {
    trainingLoss: 0.05,
    validationLoss: 0.08,
  },
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-15T00:00:00Z",
};

const sampleFineTuneFile: FineTuneFileDoc = {
  _id: "file_123",
  whitelabelId: "ws_456",
  name: "training-data.jsonl",
  description: "Support ticket training data",
  format: "jsonl",
  size: 1024000,
  rowCount: 1500,
  status: "ready",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const sampleFileEntry: FineTuneFileEntry = {
  prompt: "How do I reset my password?",
  completion: "You can reset your password by...",
  metadata: { category: "account" },
};

describe("FineTuneFilesNamespace", () => {
  let mockHttpClient: HttpClient;
  let filesNamespace: FineTuneFilesNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    filesNamespace = new FineTuneFilesNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("upload", () => {
    it("should POST FormData with file", async () => {
      vi.mocked(mockHttpClient.postFormData).mockResolvedValue(sampleFineTuneFile);
      const mockFile = new Blob(["training data"], { type: "application/jsonl" });

      await filesNamespace.upload(
        { workspaceId: "ws-123" },
        { file: mockFile, name: "training.jsonl" }
      );

      expect(mockHttpClient.postFormData).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/files",
        expect.any(FormData)
      );
    });

    it("should include name and optional description", async () => {
      vi.mocked(mockHttpClient.postFormData).mockResolvedValue(sampleFineTuneFile);
      const mockFile = new Blob(["training data"], { type: "application/jsonl" });

      await filesNamespace.upload(
        { workspaceId: "ws-123" },
        { file: mockFile, name: "data.jsonl", description: "Training set" }
      );

      const call = vi.mocked(mockHttpClient.postFormData).mock.calls[0];
      const formData = call[1] as FormData;
      expect(formData.get("name")).toBe("data.jsonl");
      expect(formData.get("description")).toBe("Training set");
    });
  });

  describe("list", () => {
    it("should GET training files", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleFineTuneFile]);

      await filesNamespace.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/files"
      );
    });
  });

  describe("get", () => {
    it("should GET single file", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleFineTuneFile);

      await filesNamespace.get({ workspaceId: "ws-123", fileId: "file-456" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/files/file-456"
      );
    });
  });

  describe("getContents", () => {
    it("should GET file contents", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleFileEntry]);

      await filesNamespace.getContents({
        workspaceId: "ws-123",
        fileId: "file-456",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/files/file-456/contents"
      );
    });

    it("should return array of FineTuneFileEntry", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleFileEntry]);

      const result = await filesNamespace.getContents({
        workspaceId: "ws-123",
        fileId: "file-456",
      });

      expect(result).toEqual([sampleFileEntry]);
    });
  });

  describe("delete", () => {
    it("should DELETE file", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(undefined);

      await filesNamespace.delete({ workspaceId: "ws-123", fileId: "file-456" });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/files/file-456"
      );
    });
  });
});

describe("FineTuneNamespace", () => {
  let mockHttpClient: HttpClient;
  let fineTuneNamespace: FineTuneNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    fineTuneNamespace = new FineTuneNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("files", () => {
    it("should lazily initialize FineTuneFilesNamespace", () => {
      const files = fineTuneNamespace.files;
      expect(files).toBeInstanceOf(FineTuneFilesNamespace);
    });

    it("should reuse same instance", () => {
      const f1 = fineTuneNamespace.files;
      const f2 = fineTuneNamespace.files;
      expect(f1).toBe(f2);
    });
  });

  describe("create", () => {
    it("should POST fine-tune job", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleFineTuneDoc);

      await fineTuneNamespace.create(
        { workspaceId: "ws-123" },
        {
          title: "New Model",
          finetuneTool: "openai",
          trainingFileIds: ["file_1"],
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune",
        {
          title: "New Model",
          finetuneTool: "openai",
          trainingFileIds: ["file_1"],
        }
      );
    });

    it("should include all optional parameters", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleFineTuneDoc);

      await fineTuneNamespace.create(
        { workspaceId: "ws-123" },
        {
          title: "Full Model",
          description: "With all options",
          finetuneTool: "openai",
          baseModel: "gpt-4",
          hyperparameters: { epochs: 5, batchSize: 8 },
          trainingFileIds: ["file_1"],
          validationFileIds: ["file_2"],
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          hyperparameters: { epochs: 5, batchSize: 8 },
          validationFileIds: ["file_2"],
        })
      );
    });
  });

  describe("list", () => {
    it("should GET fine-tune jobs", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleFineTuneDoc]);

      await fineTuneNamespace.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune"
      );
    });
  });

  describe("get", () => {
    it("should GET single job", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleFineTuneDoc);

      await fineTuneNamespace.get({ workspaceId: "ws-123", jobId: "ft-456" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/ft-456"
      );
    });
  });

  describe("fork", () => {
    it("should POST fork", async () => {
      const forkedDoc = { ...sampleFineTuneDoc, _id: "ft_forked" };
      vi.mocked(mockHttpClient.post).mockResolvedValue(forkedDoc);

      await fineTuneNamespace.fork(
        { workspaceId: "ws-123", jobId: "ft-456" },
        { title: "Forked Model" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/ft-456/fork",
        { title: "Forked Model" }
      );
    });
  });

  describe("delete", () => {
    it("should DELETE job", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(undefined);

      await fineTuneNamespace.delete({ workspaceId: "ws-123", jobId: "ft-456" });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/ft-456"
      );
    });
  });

  describe("start", () => {
    it("should POST to start endpoint", async () => {
      const startedDoc = { ...sampleFineTuneDoc, status: "processing" as const };
      vi.mocked(mockHttpClient.post).mockResolvedValue(startedDoc);

      await fineTuneNamespace.start({ workspaceId: "ws-123", jobId: "ft-456" });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/ft-456/start",
        {}
      );
    });
  });

  describe("cancel", () => {
    it("should POST to cancel endpoint", async () => {
      const cancelledDoc = { ...sampleFineTuneDoc, status: "failed" as const };
      vi.mocked(mockHttpClient.post).mockResolvedValue(cancelledDoc);

      await fineTuneNamespace.cancel({ workspaceId: "ws-123", jobId: "ft-456" });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune/ft-456/cancel",
        {}
      );
    });
  });

  describe("withWorkspace", () => {
    it("should return scoped namespace", () => {
      const scoped = fineTuneNamespace.withWorkspace("ws-123");

      expect(scoped).toBeInstanceOf(FineTuneNamespace);
      expect(scoped).not.toBe(fineTuneNamespace);
    });

    it("should inherit workspaceId for operations", async () => {
      const scoped = fineTuneNamespace.withWorkspace("ws-123");
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleFineTuneDoc]);

      await scoped.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/fine-tune"
      );
    });
  });
});
