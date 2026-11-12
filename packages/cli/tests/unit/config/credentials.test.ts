import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

import * as fs from "node:fs";
import {
  loadCredentials,
  saveCredentials,
  getProfile,
  setProfile,
  deleteProfile,
  setDefaultProfile,
  getCredentialsPath,
  type CredentialsFile,
  type ProfileData,
} from "../../../src/config/credentials.js";

describe("credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCredentialsPath", () => {
    it("returns the expected path under ~/.config/divinci", () => {
      const result = getCredentialsPath();
      expect(result).toBe("/mock-home/.config/divinci/credentials.json");
    });
  });

  describe("loadCredentials", () => {
    it("returns empty credentials when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadCredentials();

      expect(result).toEqual({
        version: 1,
        defaultProfile: "default",
        profiles: {},
      });
    });

    it("reads and parses existing credentials file", () => {
      const stored: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: {
            apiKey: "key-123",
            apiUrl: "https://api.divinci.app",
            workspaceId: "ws-1",
          },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(stored));

      const result = loadCredentials();

      expect(result).toEqual(stored);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/mock-home/.config/divinci/credentials.json",
        "utf-8"
      );
    });

    it("returns empty credentials when file has invalid JSON", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("not-json{{{");

      const result = loadCredentials();

      expect(result).toEqual({
        version: 1,
        defaultProfile: "default",
        profiles: {},
      });
    });

    it("returns empty credentials when readFileSync throws", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("EACCES");
      });

      const result = loadCredentials();

      expect(result).toEqual({
        version: 1,
        defaultProfile: "default",
        profiles: {},
      });
    });
  });

  describe("saveCredentials", () => {
    it("creates config directory if it does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const creds: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {},
      };
      saveCredentials(creds);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        "/mock-home/.config/divinci",
        { recursive: true, mode: 0o700 }
      );
    });

    it("does not create directory if it already exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const creds: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {},
      };
      saveCredentials(creds);

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it("writes credentials with restrictive permissions (0o600)", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const creds: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: { apiKey: "key-abc", apiUrl: "https://api.divinci.app" },
        },
      };
      saveCredentials(creds);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/mock-home/.config/divinci/credentials.json",
        JSON.stringify(creds, null, 2),
        { mode: 0o600 }
      );
    });
  });

  describe("getProfile", () => {
    it("returns the default profile when no name is provided", () => {
      const stored: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: { apiKey: "key-1", apiUrl: "https://api.divinci.app" },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(stored));

      const result = getProfile();
      expect(result).toEqual({ apiKey: "key-1", apiUrl: "https://api.divinci.app" });
    });

    it("returns a named profile when specified", () => {
      const stored: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {
          staging: { apiKey: "key-staging", apiUrl: "https://api.stage.divinci.app" },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(stored));

      const result = getProfile("staging");
      expect(result).toEqual({ apiKey: "key-staging", apiUrl: "https://api.stage.divinci.app" });
    });

    it("returns undefined for a non-existent profile", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getProfile("missing");
      expect(result).toBeUndefined();
    });
  });

  describe("setProfile", () => {
    it("adds a new profile and saves", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const profileData: ProfileData = {
        apiKey: "new-key",
        apiUrl: "https://api.divinci.app",
        email: "user@example.com",
      };
      setProfile("production", profileData);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent) as CredentialsFile;
      expect(written.profiles.production).toEqual(profileData);
    });

    it("overwrites an existing profile", () => {
      const existing: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: { apiKey: "old-key", apiUrl: "https://old.api" },
        },
      };
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).endsWith("credentials.json")) return true;
        return true; // config dir exists too
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const newData: ProfileData = { apiKey: "new-key", apiUrl: "https://new.api" };
      setProfile("default", newData);

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent) as CredentialsFile;
      expect(written.profiles.default).toEqual(newData);
    });
  });

  describe("deleteProfile", () => {
    it("removes a profile and saves", () => {
      const existing: CredentialsFile = {
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: { apiKey: "key-1", apiUrl: "https://api.divinci.app" },
          staging: { apiKey: "key-2", apiUrl: "https://api.stage.divinci.app" },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      deleteProfile("staging");

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent) as CredentialsFile;
      expect(written.profiles.staging).toBeUndefined();
      expect(written.profiles.default).toBeDefined();
    });

    it("is a no-op when deleting a non-existent profile", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      deleteProfile("nonexistent");

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("setDefaultProfile", () => {
    it("updates the default profile name and saves", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      setDefaultProfile("staging");

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent) as CredentialsFile;
      expect(written.defaultProfile).toBe("staging");
    });
  });
});
