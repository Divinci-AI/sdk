import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockReleasesCreate,
  mockReleasesUpdate,
  mockReleasesUpdateInWorkspace,
  mockReleasesDelete,
  mockReleasesActivate,
  mockHttpPost,
  mockHttpDelete,
  mockHttpGet,
} = vi.hoisted(() => ({
  mockReleasesCreate: vi.fn(),
  mockReleasesUpdate: vi.fn(),
  mockReleasesUpdateInWorkspace: vi.fn(),
  mockReleasesDelete: vi.fn(),
  mockReleasesActivate: vi.fn(),
  // create/delete were refactored to use the workspace-scoped OAuth routes via
  // client.getHttpClient() (NOT client.releases.*, which hits the api-key-only
  // v1 routes). Mock the http client they actually call.
  mockHttpPost: vi.fn(),
  mockHttpDelete: vi.fn(),
  mockHttpGet: vi.fn(),
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
    releases: {
      create: mockReleasesCreate,
      update: mockReleasesUpdate,
      updateInWorkspace: mockReleasesUpdateInWorkspace,
      delete: mockReleasesDelete,
      activate: mockReleasesActivate,
    },
    getHttpClient: () => ({
      post: mockHttpPost,
      delete: mockHttpDelete,
      get: mockHttpGet,
    }),
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
import { registerReleaseCreateCommand } from "../../../../src/commands/release/create.js";
import { registerReleaseUpdateCommand } from "../../../../src/commands/release/update.js";
import { registerReleaseDeleteCommand } from "../../../../src/commands/release/delete.js";
import { registerReleasePublishCommand } from "../../../../src/commands/release/publish.js";
import { output } from "../../../../src/output/formatter.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

describe("release commands (new)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("release create", () => {
    function createParentCommand(): Command {
      const parent = new Command("release");
      registerReleaseCreateCommand(parent);
      return parent;
    }

    it("should create a release with required name", async () => {
      // --assistant-id avoids the defaultAssistant workspace fetch.
      const releaseData = { _id: "rel-1", title: "v1.0", status: "draft" };
      mockHttpPost.mockResolvedValue(releaseData);

      const parent = createParentCommand();
      await parent.parseAsync(["create", "--name", "v1.0", "--assistant-id", "gemini-3.5-flash"], { from: "user" });

      // POSTs to the workspace-scoped OAuth route (createReleaseDraft), not client.releases.create().
      expect(mockHttpPost).toHaveBeenCalledWith(
        "/white-label/ws-123/release",
        expect.objectContaining({
          title: "v1.0",
          assistant: { id: "gemini-3.5-flash", finetune: false },
        }),
      );
      expect(output).toHaveBeenCalledWith(releaseData, { keyValue: true });
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Create fail");
      mockHttpPost.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["create", "--name", "v1.0", "--assistant-id", "gemini-3.5-flash"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("release update", () => {
    function createParentCommand(): Command {
      const parent = new Command("release");
      registerReleaseUpdateCommand(parent);
      return parent;
    }

    // update.ts prefers the workspace-scoped endpoint whenever a workspaceId is
    // configured (it is here — config.workspaceId="ws-123"), so it calls
    // client.releases.updateInWorkspace(workspaceId, releaseId, updates) rather
    // than the bare update(releaseId, updates).
    it("should update a release with --name option", async () => {
      const updatedData = { id: "rel-1", name: "v1.1", status: "draft" };
      mockReleasesUpdateInWorkspace.mockResolvedValue(updatedData);

      const parent = createParentCommand();
      await parent.parseAsync(["update", "rel-1", "--name", "v1.1"], { from: "user" });

      expect(mockReleasesUpdateInWorkspace).toHaveBeenCalledWith("ws-123", "rel-1", { name: "v1.1" });
      expect(output).toHaveBeenCalledWith(updatedData, { keyValue: true });
    });

    it("should update a release with --status option", async () => {
      const updatedData = { id: "rel-1", name: "v1.0", status: "active" };
      mockReleasesUpdateInWorkspace.mockResolvedValue(updatedData);

      const parent = createParentCommand();
      await parent.parseAsync(["update", "rel-1", "--status", "active"], { from: "user" });

      expect(mockReleasesUpdateInWorkspace).toHaveBeenCalledWith("ws-123", "rel-1", { status: "active" });
      expect(output).toHaveBeenCalledWith(updatedData, { keyValue: true });
    });

    it("should update a release with both --name and --status", async () => {
      const updatedData = { id: "rel-1", name: "v2.0", status: "active" };
      mockReleasesUpdateInWorkspace.mockResolvedValue(updatedData);

      const parent = createParentCommand();
      await parent.parseAsync(["update", "rel-1", "--name", "v2.0", "--status", "active"], { from: "user" });

      expect(mockReleasesUpdateInWorkspace).toHaveBeenCalledWith("ws-123", "rel-1", { name: "v2.0", status: "active" });
      expect(output).toHaveBeenCalledWith(updatedData, { keyValue: true });
    });

    it("should send empty updates when no options provided", async () => {
      mockReleasesUpdateInWorkspace.mockResolvedValue({ id: "rel-1" });

      const parent = createParentCommand();
      await parent.parseAsync(["update", "rel-1"], { from: "user" });

      expect(mockReleasesUpdateInWorkspace).toHaveBeenCalledWith("ws-123", "rel-1", {});
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Update fail");
      mockReleasesUpdateInWorkspace.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["update", "rel-1", "--name", "v1.1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("release delete", () => {
    function createParentCommand(): Command {
      const parent = new Command("release");
      registerReleaseDeleteCommand(parent);
      return parent;
    }

    it("should delete a release by ID", async () => {
      mockHttpDelete.mockResolvedValue(undefined);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const parent = createParentCommand();
      await parent.parseAsync(["delete", "rel-1"], { from: "user" });

      // DELETEs the workspace-scoped OAuth route (deleteDraft), not client.releases.delete().
      expect(mockHttpDelete).toHaveBeenCalledWith("/white-label/ws-123/release/rel-1");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("rel-1"));
      consoleSpy.mockRestore();
    });

    it("should call handleCommandError on failure", async () => {
      const err = new Error("Delete fail");
      mockHttpDelete.mockRejectedValue(err);

      const parent = createParentCommand();
      await parent.parseAsync(["delete", "rel-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(err);
    });
  });

  describe("release publish", () => {
    // The publish command uses the workspace-scoped publish route via a direct
    // fetch (the SDK's activate() hits the v1 consumer API, which rejects OAuth
    // tokens — dogfood F15). The server exposes publish as a GET.
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function createParentCommand(): Command {
      const parent = new Command("release");
      registerReleasePublishCommand(parent);
      return parent;
    }

    it("should publish a release via the workspace publish route", async () => {
      const publishData = { id: "rel-1", status: "active" };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(publishData)),
      });
      vi.stubGlobal("fetch", fetchMock);

      const parent = createParentCommand();
      await parent.parseAsync(["publish", "rel-1"], { from: "user" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.divinci.app/white-label/ws-123/release/rel-1/release",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        })
      );
      expect(output).toHaveBeenCalledWith(publishData, { keyValue: true });
    });

    it("should call handleCommandError on a non-OK response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('{"status":"error","message":"forbidden"}'),
      });
      vi.stubGlobal("fetch", fetchMock);

      const parent = createParentCommand();
      await parent.parseAsync(["publish", "rel-1"], { from: "user" });

      expect(handleCommandError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("HTTP 403") })
      );
    });
  });
});
