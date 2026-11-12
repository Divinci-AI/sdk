import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockConfigGet,
  mockConfigUpdateTitle,
  mockConfigUpdateDescription,
} = vi.hoisted(() => ({
  mockConfigGet: vi.fn(),
  mockConfigUpdateTitle: vi.fn(),
  mockConfigUpdateDescription: vi.fn(),
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
    config: {
      get: mockConfigGet,
      updateTitle: mockConfigUpdateTitle,
      updateDescription: mockConfigUpdateDescription,
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
import { registerConfigGetCommand } from "../../../../src/commands/config/get.js";
import { registerConfigSetTitleCommand } from "../../../../src/commands/config/set-title.js";
import { registerConfigSetDescriptionCommand } from "../../../../src/commands/config/set-description.js";
import { output } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

describe("config commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("config get", () => {
    function createParentCommand(): Command {
      const parent = new Command("config");
      registerConfigGetCommand(parent);
      return parent;
    }

    it("should get workspace configuration", async () => {
      const configData = { title: "My Workspace", description: "A test workspace" };
      mockConfigGet.mockResolvedValue(configData);

      const parent = createParentCommand();
      await parent.parseAsync(["get"], { from: "user" });

      expect(mockConfigGet).toHaveBeenCalledWith("ws-123");
      expect(output).toHaveBeenCalledWith(configData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("API fail");
      mockConfigGet.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["get"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("config set-title", () => {
    function createParentCommand(): Command {
      const parent = new Command("config");
      registerConfigSetTitleCommand(parent);
      return parent;
    }

    it("should set workspace title", async () => {
      const updatedData = { title: "New Title", description: "A test workspace" };
      mockConfigUpdateTitle.mockResolvedValue(updatedData);

      const parent = createParentCommand();
      await parent.parseAsync(["set-title", "New Title"], { from: "user" });

      expect(mockConfigUpdateTitle).toHaveBeenCalledWith("ws-123", "New Title");
      expect(output).toHaveBeenCalledWith(updatedData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Update fail");
      mockConfigUpdateTitle.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["set-title", "Title"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("config set-description", () => {
    function createParentCommand(): Command {
      const parent = new Command("config");
      registerConfigSetDescriptionCommand(parent);
      return parent;
    }

    it("should set workspace description", async () => {
      const updatedData = { title: "My Workspace", description: "Updated description" };
      mockConfigUpdateDescription.mockResolvedValue(updatedData);

      const parent = createParentCommand();
      await parent.parseAsync(["set-description", "Updated description"], { from: "user" });

      expect(mockConfigUpdateDescription).toHaveBeenCalledWith("ws-123", "Updated description");
      expect(output).toHaveBeenCalledWith(updatedData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Update fail");
      mockConfigUpdateDescription.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["set-description", "Desc"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });
});
