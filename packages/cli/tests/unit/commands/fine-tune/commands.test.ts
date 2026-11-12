import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFineTuneList,
  mockFineTuneGet,
  mockFineTuneCreate,
  mockFineTuneDelete,
  mockFineTuneStart,
  mockFineTuneStatus,
  mockFineTuneCancel,
} = vi.hoisted(() => ({
  mockFineTuneList: vi.fn(),
  mockFineTuneGet: vi.fn(),
  mockFineTuneCreate: vi.fn(),
  mockFineTuneDelete: vi.fn(),
  mockFineTuneStart: vi.fn(),
  mockFineTuneStatus: vi.fn(),
  mockFineTuneCancel: vi.fn(),
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
    fineTune: {
      list: mockFineTuneList,
      get: mockFineTuneGet,
      create: mockFineTuneCreate,
      delete: mockFineTuneDelete,
      start: mockFineTuneStart,
      status: mockFineTuneStatus,
      cancel: mockFineTuneCancel,
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
import { registerFineTuneListCommand } from "../../../../src/commands/fine-tune/list.js";
import { registerFineTuneGetCommand } from "../../../../src/commands/fine-tune/get.js";
import { registerFineTuneCreateCommand } from "../../../../src/commands/fine-tune/create.js";
import { registerFineTuneDeleteCommand } from "../../../../src/commands/fine-tune/delete.js";
import { registerFineTuneStartCommand } from "../../../../src/commands/fine-tune/start.js";
import { registerFineTuneStatusCommand } from "../../../../src/commands/fine-tune/status.js";
import { registerFineTuneCancelCommand } from "../../../../src/commands/fine-tune/cancel.js";
import { output } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

describe("fine-tune commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fine-tune list", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneListCommand(parent);
      return parent;
    }

    it("should list fine-tuning jobs with default limit", async () => {
      mockFineTuneList.mockResolvedValue({ data: [{ id: "ft-1", name: "Job 1" }] });

      const parent = createParentCommand();
      await parent.parseAsync(["list"], { from: "user" });

      expect(mockFineTuneList).toHaveBeenCalledWith("ws-123", { limit: 20 });
      expect(output).toHaveBeenCalledWith(
        [{ id: "ft-1", name: "Job 1" }],
        expect.objectContaining({ table: expect.any(Object) })
      );
    });

    it("should accept --limit option", async () => {
      mockFineTuneList.mockResolvedValue({ data: [] });

      const parent = createParentCommand();
      await parent.parseAsync(["list", "--limit", "10"], { from: "user" });

      expect(mockFineTuneList).toHaveBeenCalledWith("ws-123", { limit: 10 });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("API fail");
      mockFineTuneList.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["list"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("fine-tune get", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneGetCommand(parent);
      return parent;
    }

    it("should get fine-tuning job by ID", async () => {
      const jobData = { id: "ft-1", name: "Job 1", status: "running" };
      mockFineTuneGet.mockResolvedValue(jobData);

      const parent = createParentCommand();
      await parent.parseAsync(["get", "ft-1"], { from: "user" });

      expect(mockFineTuneGet).toHaveBeenCalledWith("ft-1");
      expect(output).toHaveBeenCalledWith(jobData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Not found");
      mockFineTuneGet.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["get", "ft-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("fine-tune create", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneCreateCommand(parent);
      return parent;
    }

    it("should create a fine-tuning job with required options", async () => {
      const createData = { id: "ft-2", name: "New Job", status: "created" };
      mockFineTuneCreate.mockResolvedValue(createData);

      const parent = createParentCommand();
      await parent.parseAsync(["create", "--name", "New Job", "--base-model", "llama-3"], { from: "user" });

      expect(mockFineTuneCreate).toHaveBeenCalledWith({
        workspaceId: "ws-123",
        name: "New Job",
        baseModel: "llama-3",
        trainingData: undefined,
      });
      expect(output).toHaveBeenCalledWith(createData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Create fail");
      mockFineTuneCreate.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["create", "--name", "Job", "--base-model", "model"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("fine-tune delete", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneDeleteCommand(parent);
      return parent;
    }

    it("should delete fine-tuning job by ID", async () => {
      mockFineTuneDelete.mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const parent = createParentCommand();
      await parent.parseAsync(["delete", "ft-1"], { from: "user" });

      expect(mockFineTuneDelete).toHaveBeenCalledWith("ft-1");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("ft-1"));
      consoleSpy.mockRestore();
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Delete fail");
      mockFineTuneDelete.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["delete", "ft-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("fine-tune start", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneStartCommand(parent);
      return parent;
    }

    it("should start a fine-tuning job", async () => {
      const startData = { id: "ft-1", status: "running" };
      mockFineTuneStart.mockResolvedValue(startData);

      const parent = createParentCommand();
      await parent.parseAsync(["start", "ft-1"], { from: "user" });

      expect(mockFineTuneStart).toHaveBeenCalledWith("ft-1");
      expect(output).toHaveBeenCalledWith(startData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Start fail");
      mockFineTuneStart.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["start", "ft-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("fine-tune status", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneStatusCommand(parent);
      return parent;
    }

    it("should check fine-tuning job status", async () => {
      const statusData = { id: "ft-1", status: "completed", progress: 100 };
      mockFineTuneStatus.mockResolvedValue(statusData);

      const parent = createParentCommand();
      await parent.parseAsync(["status", "ft-1"], { from: "user" });

      expect(mockFineTuneStatus).toHaveBeenCalledWith("ft-1");
      expect(output).toHaveBeenCalledWith(statusData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Status fail");
      mockFineTuneStatus.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["status", "ft-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("fine-tune cancel", () => {
    function createParentCommand(): Command {
      const parent = new Command("fine-tune");
      registerFineTuneCancelCommand(parent);
      return parent;
    }

    it("should cancel a running fine-tuning job", async () => {
      const cancelData = { id: "ft-1", status: "cancelled" };
      mockFineTuneCancel.mockResolvedValue(cancelData);

      const parent = createParentCommand();
      await parent.parseAsync(["cancel", "ft-1"], { from: "user" });

      expect(mockFineTuneCancel).toHaveBeenCalledWith("ft-1");
      expect(output).toHaveBeenCalledWith(cancelData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Cancel fail");
      mockFineTuneCancel.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["cancel", "ft-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });
});
