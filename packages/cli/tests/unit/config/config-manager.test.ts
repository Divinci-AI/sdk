import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../../../src/config/credentials.js", () => ({
  getProfile: vi.fn(),
}));

import * as fs from "node:fs";
import { getProfile } from "../../../src/config/credentials.js";
import {
  resolveConfig,
  requireConfig,
  requireWorkspaceId,
  type ResolvedConfig,
} from "../../../src/config/config-manager.js";

describe("config-manager", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear relevant env vars
    delete process.env.DIVINCI_API_KEY;
    delete process.env.DIVINCI_API_URL;
    delete process.env.DIVINCI_WORKSPACE_ID;
    delete process.env.DIVINCI_PROFILE;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("resolveConfig", () => {
    describe("priority 1: CLI flags", () => {
      it("uses apiKey from flags with highest priority", () => {
        // Even with env var set, flags should win
        process.env.DIVINCI_API_KEY = "env-key";

        const result = resolveConfig({ apiKey: "flag-key" });

        expect(result).toBeDefined();
        expect(result!.apiKey).toBe("flag-key");
        expect(result!.source).toBe("cli-flag");
      });

      it("uses workspace from flags", () => {
        const result = resolveConfig({ apiKey: "key", workspace: "ws-flag" });

        expect(result!.workspaceId).toBe("ws-flag");
      });

      it("uses apiUrl from flags over env", () => {
        process.env.DIVINCI_API_URL = "https://env-url.com";

        const result = resolveConfig({ apiKey: "key", apiUrl: "https://flag-url.com" });

        expect(result!.apiUrl).toBe("https://flag-url.com");
      });

      it("falls back to env DIVINCI_API_URL when no flag apiUrl", () => {
        process.env.DIVINCI_API_URL = "https://custom.api";

        const result = resolveConfig({ apiKey: "key" });

        expect(result!.apiUrl).toBe("https://custom.api");
      });

      it("falls back to default apiUrl when neither flag nor env", () => {
        const result = resolveConfig({ apiKey: "key" });

        expect(result!.apiUrl).toBe("https://api.divinci.app");
      });

      it("uses workspace from env when no flag workspace", () => {
        process.env.DIVINCI_WORKSPACE_ID = "ws-env";

        const result = resolveConfig({ apiKey: "key" });

        expect(result!.workspaceId).toBe("ws-env");
      });
    });

    describe("priority 2: environment variables", () => {
      it("uses DIVINCI_API_KEY from environment", () => {
        process.env.DIVINCI_API_KEY = "env-key-123";
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = resolveConfig({});

        expect(result).toBeDefined();
        expect(result!.apiKey).toBe("env-key-123");
        expect(result!.source).toBe("env");
      });

      it("uses DIVINCI_WORKSPACE_ID from environment", () => {
        process.env.DIVINCI_API_KEY = "env-key";
        process.env.DIVINCI_WORKSPACE_ID = "ws-from-env";
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = resolveConfig({});

        expect(result!.workspaceId).toBe("ws-from-env");
      });

      it("flag workspace overrides env workspace even with env apiKey", () => {
        process.env.DIVINCI_API_KEY = "env-key";
        process.env.DIVINCI_WORKSPACE_ID = "ws-env";
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = resolveConfig({ workspace: "ws-flag" });

        expect(result!.workspaceId).toBe("ws-flag");
        expect(result!.source).toBe("env");
      });
    });

    describe("priority 3: project config", () => {
      it("uses project config when no flags or env vars", () => {
        const projectConfig = {
          apiKey: "project-key",
          apiUrl: "https://project-api.com",
          workspaceId: "ws-project",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(projectConfig));

        const result = resolveConfig({});

        expect(result).toBeDefined();
        expect(result!.apiKey).toBe("project-key");
        expect(result!.apiUrl).toBe("https://project-api.com");
        expect(result!.workspaceId).toBe("ws-project");
        expect(result!.source).toBe("project");
      });

      it("flag apiUrl overrides project apiUrl", () => {
        const projectConfig = {
          apiKey: "project-key",
          apiUrl: "https://project-api.com",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(projectConfig));

        const result = resolveConfig({ apiUrl: "https://flag-api.com" });

        expect(result!.apiUrl).toBe("https://flag-api.com");
      });

      it("flag workspace overrides project workspace", () => {
        const projectConfig = {
          apiKey: "project-key",
          workspaceId: "ws-project",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(projectConfig));

        const result = resolveConfig({ workspace: "ws-flag" });

        expect(result!.workspaceId).toBe("ws-flag");
      });

      it("falls back to default apiUrl when project has no apiUrl", () => {
        const projectConfig = { apiKey: "project-key" };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(projectConfig));

        const result = resolveConfig({});

        expect(result!.apiUrl).toBe("https://api.divinci.app");
      });

      it("skips project config with invalid JSON", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("{{bad");
        vi.mocked(getProfile).mockReturnValue(undefined);

        const result = resolveConfig({});

        expect(result).toBeUndefined();
      });
    });

    describe("priority 4: user credentials", () => {
      it("uses credentials profile as last resort", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue({
          apiKey: "cred-key",
          apiUrl: "https://cred-api.com",
          workspaceId: "ws-cred",
        });

        const result = resolveConfig({});

        expect(result).toBeDefined();
        expect(result!.apiKey).toBe("cred-key");
        expect(result!.apiUrl).toBe("https://cred-api.com");
        expect(result!.workspaceId).toBe("ws-cred");
        expect(result!.source).toBe("credentials");
      });

      it("uses specified profile name from flags", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue({
          apiKey: "staging-key",
          apiUrl: "https://api.stage.divinci.app",
        });

        resolveConfig({ profile: "staging" });

        expect(getProfile).toHaveBeenCalledWith("staging");
      });

      it("uses DIVINCI_PROFILE env var for profile name", () => {
        process.env.DIVINCI_PROFILE = "production";
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue({
          apiKey: "prod-key",
          apiUrl: "https://api.divinci.app",
        });

        const result = resolveConfig({});

        expect(result!.profile).toBe("production");
        expect(getProfile).toHaveBeenCalledWith("production");
      });

      it("defaults profile name to 'default'", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue({
          apiKey: "key",
          apiUrl: "https://api.divinci.app",
        });

        const result = resolveConfig({});

        expect(result!.profile).toBe("default");
        expect(getProfile).toHaveBeenCalledWith("default");
      });

      it("flag apiUrl overrides credentials apiUrl", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue({
          apiKey: "key",
          apiUrl: "https://cred-api.com",
        });

        const result = resolveConfig({ apiUrl: "https://override.com" });

        expect(result!.apiUrl).toBe("https://override.com");
      });
    });

    describe("no config found", () => {
      it("returns undefined when no source has an API key", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue(undefined);

        const result = resolveConfig({});

        expect(result).toBeUndefined();
      });

      it("returns undefined when credentials profile has no apiKey", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(getProfile).mockReturnValue({
          apiKey: "",
          apiUrl: "https://api.divinci.app",
        });

        // Empty string is falsy, so it should fall through
        const result = resolveConfig({});
        expect(result).toBeUndefined();
      });
    });
  });

  describe("requireConfig", () => {
    it("returns config when available", () => {
      process.env.DIVINCI_API_KEY = "my-key";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = requireConfig({});

      expect(result.apiKey).toBe("my-key");
    });

    it("throws descriptive error when not authenticated", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(getProfile).mockReturnValue(undefined);

      expect(() => requireConfig({})).toThrow(
        "Not authenticated. Run `divinci auth login` or set DIVINCI_API_KEY environment variable."
      );
    });
  });

  describe("requireWorkspaceId", () => {
    it("returns workspaceId when present", () => {
      const config: ResolvedConfig = {
        apiKey: "key",
        apiUrl: "https://api.divinci.app",
        workspaceId: "ws-123",
        profile: "default",
        source: "env",
      };

      const result = requireWorkspaceId(config);

      expect(result).toBe("ws-123");
    });

    it("throws descriptive error when workspaceId is missing", () => {
      const config: ResolvedConfig = {
        apiKey: "key",
        apiUrl: "https://api.divinci.app",
        profile: "default",
        source: "env",
      };

      expect(() => requireWorkspaceId(config)).toThrow(
        "No workspace selected. Run `divinci workspace use <id>` or pass --workspace <id>."
      );
    });
  });
});
