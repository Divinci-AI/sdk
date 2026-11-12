/**
 * AudioNamespace tests
 *
 * Tests for audio transcription, voiceprints, and bulk operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AudioNamespace,
  VoiceprintsNamespace,
  AudioBulkNamespace,
  type AudioTranscriptDoc,
  type VoiceprintDoc,
} from "../../src/namespaces/audio/index.js";
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

// Sample audio transcript
const sampleTranscript: AudioTranscriptDoc = {
  _id: "audio-123",
  whitelabelId: "ws-456",
  title: "Test Recording",
  status: "completed",
  duration: 120,
  speakers: [
    { id: "s1", name: "Speaker 1" },
    { id: "s2", name: "Speaker 2" },
  ],
  transcript: [
    { speakerId: "s1", start: 0, end: 5, text: "Hello" },
    { speakerId: "s2", start: 5, end: 10, text: "Hi there" },
  ],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

// Sample voiceprint
const sampleVoiceprint: VoiceprintDoc = {
  _id: "vp-123",
  whitelabelId: "ws-456",
  name: "John Doe",
  diarizerTool: "pyannote",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("AudioNamespace", () => {
  let mockHttpClient: HttpClient;
  let audioNamespace: AudioNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    audioNamespace = new AudioNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("upload", () => {
    it("should POST FormData to audio endpoint", async () => {
      vi.mocked(mockHttpClient.postFormData).mockResolvedValue(sampleTranscript);
      const mockFile = new Blob(["audio data"], { type: "audio/mp3" });

      await audioNamespace.upload({ workspaceId: "ws-123" }, { mediaFile: mockFile });

      expect(mockHttpClient.postFormData).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio",
        expect.any(FormData)
      );
    });

    it("should include mediaFile in FormData", async () => {
      vi.mocked(mockHttpClient.postFormData).mockResolvedValue(sampleTranscript);
      const mockFile = new Blob(["audio data"], { type: "audio/mp3" });

      await audioNamespace.upload({ workspaceId: "ws-123" }, { mediaFile: mockFile });

      const call = vi.mocked(mockHttpClient.postFormData).mock.calls[0];
      const formData = call[1] as FormData;
      const mediaFile = formData.get("mediaFile");
      expect(mediaFile).toBeDefined();
      expect(mediaFile instanceof Blob).toBe(true);
    });

    it("should include optional title, diarizerTool, transcriberTool", async () => {
      vi.mocked(mockHttpClient.postFormData).mockResolvedValue(sampleTranscript);
      const mockFile = new Blob(["audio data"], { type: "audio/mp3" });

      await audioNamespace.upload(
        { workspaceId: "ws-123" },
        {
          mediaFile: mockFile,
          title: "Meeting",
          diarizerTool: "pyannote",
          transcriberTool: "whisper",
        }
      );

      const call = vi.mocked(mockHttpClient.postFormData).mock.calls[0];
      const formData = call[1] as FormData;
      expect(formData.get("title")).toBe("Meeting");
      expect(formData.get("diarizerTool")).toBe("pyannote");
      expect(formData.get("transcriberTool")).toBe("whisper");
    });

    it("should return AudioTranscriptDoc", async () => {
      vi.mocked(mockHttpClient.postFormData).mockResolvedValue(sampleTranscript);
      const mockFile = new Blob(["audio data"], { type: "audio/mp3" });

      const result = await audioNamespace.upload(
        { workspaceId: "ws-123" },
        { mediaFile: mockFile }
      );

      expect(result).toEqual(sampleTranscript);
    });
  });

  describe("uploadFromUrl", () => {
    it("should POST JSON body with url", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleTranscript);

      await audioNamespace.uploadFromUrl(
        { workspaceId: "ws-123" },
        { url: "https://example.com/audio.mp3" }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/url",
        { url: "https://example.com/audio.mp3" }
      );
    });

    it("should include optional parameters", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleTranscript);

      await audioNamespace.uploadFromUrl(
        { workspaceId: "ws-123" },
        {
          url: "https://example.com/audio.mp3",
          title: "Remote Audio",
          diarizerTool: "pyannote",
          transcriberTool: "whisper",
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/url",
        {
          url: "https://example.com/audio.mp3",
          title: "Remote Audio",
          diarizerTool: "pyannote",
          transcriberTool: "whisper",
        }
      );
    });
  });

  describe("list", () => {
    it("should GET audio transcripts", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleTranscript]);

      await audioNamespace.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio"
      );
    });

    it("should return array of AudioTranscriptDoc", async () => {
      const transcripts = [sampleTranscript, { ...sampleTranscript, _id: "audio-456" }];
      vi.mocked(mockHttpClient.get).mockResolvedValue(transcripts);

      const result = await audioNamespace.list({ workspaceId: "ws-123" });

      expect(result).toEqual(transcripts);
      expect(result).toHaveLength(2);
    });
  });

  describe("get", () => {
    it("should GET single transcript by audioId", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleTranscript);

      await audioNamespace.get({ workspaceId: "ws-123", audioId: "audio-456" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/audio-456"
      );
    });
  });

  describe("update", () => {
    it("should PATCH with title and speakers", async () => {
      vi.mocked(mockHttpClient.patch).mockResolvedValue(sampleTranscript);

      await audioNamespace.update(
        { workspaceId: "ws-123", audioId: "audio-456" },
        {
          title: "Updated Title",
          speakers: [{ id: "s1", name: "John" }],
        }
      );

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/audio-456",
        {
          title: "Updated Title",
          speakers: [{ id: "s1", name: "John" }],
        }
      );
    });
  });

  describe("delete", () => {
    it("should DELETE transcript", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(undefined);

      await audioNamespace.delete({ workspaceId: "ws-123", audioId: "audio-456" });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/audio-456"
      );
    });
  });

  describe("generateRagFile", () => {
    it("should POST to rag-file endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleTranscript);

      await audioNamespace.generateRagFile(
        { workspaceId: "ws-123", audioId: "audio-456" },
        { ragVectors: ["rag-123"] }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/audio-456/rag-file",
        { ragVectors: ["rag-123"] }
      );
    });

    it("should include all optional parameters", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleTranscript);

      await audioNamespace.generateRagFile(
        { workspaceId: "ws-123", audioId: "audio-456" },
        {
          speakers: [{ id: "s1", name: "Speaker" }],
          chunkingTool: "semantic",
          cleaners: ["trim", "normalize"],
          ragVectors: ["rag-123", "rag-456"],
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          speakers: [{ id: "s1", name: "Speaker" }],
          chunkingTool: "semantic",
          cleaners: ["trim", "normalize"],
          ragVectors: ["rag-123", "rag-456"],
        }
      );
    });
  });

  describe("generateFineTuneFile", () => {
    it("should POST to finetune-file endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleTranscript);

      await audioNamespace.generateFineTuneFile(
        { workspaceId: "ws-123", audioId: "audio-456" },
        { prompters: ["s1"], responders: ["s2"] }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/audio-456/finetune-file",
        { prompters: ["s1"], responders: ["s2"] }
      );
    });
  });

  describe("sub-namespaces", () => {
    describe("voiceprints", () => {
      it("should lazily initialize VoiceprintsNamespace", () => {
        const voiceprints = audioNamespace.voiceprints;
        expect(voiceprints).toBeInstanceOf(VoiceprintsNamespace);
      });

      it("should reuse same instance", () => {
        const vp1 = audioNamespace.voiceprints;
        const vp2 = audioNamespace.voiceprints;
        expect(vp1).toBe(vp2);
      });
    });

    describe("bulk", () => {
      it("should lazily initialize AudioBulkNamespace", () => {
        const bulk = audioNamespace.bulk;
        expect(bulk).toBeInstanceOf(AudioBulkNamespace);
      });

      it("should reuse same instance", () => {
        const bulk1 = audioNamespace.bulk;
        const bulk2 = audioNamespace.bulk;
        expect(bulk1).toBe(bulk2);
      });
    });
  });

  describe("withWorkspace", () => {
    it("should return new AudioNamespace with workspaceId set", () => {
      const scopedAudio = audioNamespace.withWorkspace("ws-123");

      expect(scopedAudio).toBeInstanceOf(AudioNamespace);
      expect(scopedAudio).not.toBe(audioNamespace);
    });

    it("should inherit workspaceId for operations", async () => {
      const scopedAudio = audioNamespace.withWorkspace("ws-123");
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleTranscript]);

      await scopedAudio.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio"
      );
    });
  });
});

describe("VoiceprintsNamespace", () => {
  let mockHttpClient: HttpClient;
  let voiceprintsNamespace: VoiceprintsNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    voiceprintsNamespace = new VoiceprintsNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should GET voiceprints", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleVoiceprint]);

      await voiceprintsNamespace.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/voiceprints"
      );
    });

    it("should include diarizerTool query param when provided", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleVoiceprint]);

      await voiceprintsNamespace.list({
        workspaceId: "ws-123",
        diarizerTool: "pyannote",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/voiceprints?diarizerTool=pyannote"
      );
    });

    it("should URL-encode diarizerTool", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleVoiceprint]);

      await voiceprintsNamespace.list({
        workspaceId: "ws-123",
        diarizerTool: "tool with spaces",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/voiceprints?diarizerTool=tool%20with%20spaces"
      );
    });
  });

  describe("get", () => {
    it("should GET single voiceprint", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleVoiceprint);

      await voiceprintsNamespace.get({
        workspaceId: "ws-123",
        voiceprintId: "vp-456",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/voiceprints/vp-456"
      );
    });
  });

  describe("delete", () => {
    it("should DELETE voiceprint", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(undefined);

      await voiceprintsNamespace.delete({
        workspaceId: "ws-123",
        voiceprintId: "vp-456",
      });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/voiceprints/vp-456"
      );
    });
  });
});

describe("AudioBulkNamespace", () => {
  let mockHttpClient: HttpClient;
  let bulkNamespace: AudioBulkNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    bulkNamespace = new AudioBulkNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateRagFiles", () => {
    it("should POST bulk rag generation", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(undefined);

      await bulkNamespace.generateRagFiles(
        { workspaceId: "ws-123" },
        { audioIds: ["audio-1", "audio-2"] }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/bulk/rag-files",
        { audioIds: ["audio-1", "audio-2"] }
      );
    });

    it("should include optional parameters", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(undefined);

      await bulkNamespace.generateRagFiles(
        { workspaceId: "ws-123" },
        {
          audioIds: ["audio-1"],
          speakers: [{ id: "s1", name: "Speaker" }],
          chunkingTool: "semantic",
          ragVectors: ["rag-123"],
        }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          audioIds: ["audio-1"],
          speakers: [{ id: "s1", name: "Speaker" }],
          chunkingTool: "semantic",
          ragVectors: ["rag-123"],
        }
      );
    });
  });

  describe("reprocess", () => {
    it("should POST bulk reprocess", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(undefined);

      await bulkNamespace.reprocess(
        { workspaceId: "ws-123" },
        { audioIds: ["audio-1", "audio-2"] }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/bulk/reprocess",
        { audioIds: ["audio-1", "audio-2"] }
      );
    });
  });

  describe("delete", () => {
    it("should POST bulk delete", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(undefined);

      await bulkNamespace.delete(
        { workspaceId: "ws-123" },
        { audioIds: ["audio-1", "audio-2"] }
      );

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/data-source/audio/bulk/delete",
        { audioIds: ["audio-1", "audio-2"] }
      );
    });
  });
});
