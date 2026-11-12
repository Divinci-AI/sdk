import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAudioList,
  mockAudioGet,
  mockAudioUploadFromUrl,
  mockAudioDelete,
  mockAudioGenerateRag,
} = vi.hoisted(() => ({
  mockAudioList: vi.fn(),
  mockAudioGet: vi.fn(),
  mockAudioUploadFromUrl: vi.fn(),
  mockAudioDelete: vi.fn(),
  mockAudioGenerateRag: vi.fn(),
}));

// Mock all dependencies before imports
vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key",
    apiUrl: "https://api.divinci.app",
    workspaceId: "ws-123",
    profile: "default",
    source: "env",
  }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-123"),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));

vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    audio: {
      list: mockAudioList,
      get: mockAudioGet,
      uploadFromUrl: mockAudioUploadFromUrl,
      delete: mockAudioDelete,
      generateRag: mockAudioGenerateRag,
    },
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: vi.fn(),
  isJsonMode: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    greenBold: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
}));

import { Command } from "commander";
import { registerAudioListCommand } from "../../../../src/commands/audio/list.js";
import { registerAudioGetCommand } from "../../../../src/commands/audio/get.js";
import { registerAudioUploadUrlCommand } from "../../../../src/commands/audio/upload-url.js";
import { registerAudioDeleteCommand } from "../../../../src/commands/audio/delete.js";
import { registerAudioGenerateRagCommand } from "../../../../src/commands/audio/generate-rag.js";
import { output } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

describe("audio commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("audio list", () => {
    function createParentCommand(): Command {
      const parent = new Command("audio");
      registerAudioListCommand(parent);
      return parent;
    }

    it("should list audio transcripts with default limit", async () => {
      mockAudioList.mockResolvedValue({ data: [{ id: "a-1", name: "Test Audio" }] });

      const parent = createParentCommand();
      await parent.parseAsync(["list"], { from: "user" });

      expect(mockAudioList).toHaveBeenCalledWith("ws-123", { limit: 20 });
      expect(output).toHaveBeenCalledWith(
        [{ id: "a-1", name: "Test Audio" }],
        expect.objectContaining({ table: expect.any(Object) })
      );
    });

    it("should accept --limit option", async () => {
      mockAudioList.mockResolvedValue({ data: [] });

      const parent = createParentCommand();
      await parent.parseAsync(["list", "--limit", "5"], { from: "user" });

      expect(mockAudioList).toHaveBeenCalledWith("ws-123", { limit: 5 });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("API fail");
      mockAudioList.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["list"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("audio get", () => {
    function createParentCommand(): Command {
      const parent = new Command("audio");
      registerAudioGetCommand(parent);
      return parent;
    }

    it("should get audio transcript by ID", async () => {
      const audioData = { id: "a-1", name: "Test Audio", status: "ready" };
      mockAudioGet.mockResolvedValue(audioData);

      const parent = createParentCommand();
      await parent.parseAsync(["get", "a-1"], { from: "user" });

      expect(mockAudioGet).toHaveBeenCalledWith("a-1");
      expect(output).toHaveBeenCalledWith(audioData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Not found");
      mockAudioGet.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["get", "a-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("audio upload-url", () => {
    function createParentCommand(): Command {
      const parent = new Command("audio");
      registerAudioUploadUrlCommand(parent);
      return parent;
    }

    it("should upload audio from URL", async () => {
      const uploadData = { id: "a-2", status: "processing" };
      mockAudioUploadFromUrl.mockResolvedValue(uploadData);

      const parent = createParentCommand();
      await parent.parseAsync(["upload-url", "https://example.com/audio.mp3"], { from: "user" });

      expect(mockAudioUploadFromUrl).toHaveBeenCalledWith("ws-123", "https://example.com/audio.mp3");
      expect(output).toHaveBeenCalledWith(uploadData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Upload fail");
      mockAudioUploadFromUrl.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["upload-url", "https://example.com/audio.mp3"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("audio delete", () => {
    function createParentCommand(): Command {
      const parent = new Command("audio");
      registerAudioDeleteCommand(parent);
      return parent;
    }

    it("should delete audio transcript by ID", async () => {
      mockAudioDelete.mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const parent = createParentCommand();
      await parent.parseAsync(["delete", "a-1"], { from: "user" });

      expect(mockAudioDelete).toHaveBeenCalledWith("a-1");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("a-1"));
      consoleSpy.mockRestore();
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Delete fail");
      mockAudioDelete.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["delete", "a-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("audio generate-rag", () => {
    function createParentCommand(): Command {
      const parent = new Command("audio");
      registerAudioGenerateRagCommand(parent);
      return parent;
    }

    it("should generate RAG content from audio transcript", async () => {
      const ragData = { id: "a-1", ragStatus: "processing" };
      mockAudioGenerateRag.mockResolvedValue(ragData);

      const parent = createParentCommand();
      await parent.parseAsync(["generate-rag", "a-1"], { from: "user" });

      expect(mockAudioGenerateRag).toHaveBeenCalledWith("a-1");
      expect(output).toHaveBeenCalledWith(ragData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("RAG fail");
      mockAudioGenerateRag.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["generate-rag", "a-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });
});
