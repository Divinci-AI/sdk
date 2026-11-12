import { describe, it, expect, vi } from "vitest";

// Mock the server SDK — define constructor inside factory for vi.mock hoisting
vi.mock("@divinci-ai/server", () => {
  const DivinciServer = vi.fn();
  return { DivinciServer };
});

import { DivinciServer } from "@divinci-ai/server";
import { createClient } from "../../../src/client/create-client.js";
import type { ResolvedConfig } from "../../../src/config/config-manager.js";

const MockDivinciServer = vi.mocked(DivinciServer);

describe("createClient", () => {
  it("creates DivinciServer with apiKey, baseUrl, and defaultWorkspaceId", () => {
    const config: ResolvedConfig = {
      apiKey: "test-key-123",
      apiUrl: "https://api.divinci.app",
      workspaceId: "ws-abc",
      profile: "default",
      source: "env",
    };

    createClient(config);

    expect(MockDivinciServer).toHaveBeenCalledWith({
      apiKey: "test-key-123",
      baseUrl: "https://api.divinci.app",
      defaultWorkspaceId: "ws-abc",
    });
  });

  it("passes undefined workspaceId when not set", () => {
    const config: ResolvedConfig = {
      apiKey: "key",
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "credentials",
    };

    createClient(config);

    expect(MockDivinciServer).toHaveBeenCalledWith({
      apiKey: "key",
      baseUrl: "https://api.divinci.app",
      defaultWorkspaceId: undefined,
    });
  });

  it("passes custom apiUrl", () => {
    const config: ResolvedConfig = {
      apiKey: "key",
      apiUrl: "https://custom-api.example.com",
      workspaceId: "ws-1",
      profile: "staging",
      source: "cli-flag",
    };

    createClient(config);

    expect(MockDivinciServer).toHaveBeenCalledWith({
      apiKey: "key",
      baseUrl: "https://custom-api.example.com",
      defaultWorkspaceId: "ws-1",
    });
  });

  it("returns the DivinciServer instance", () => {
    const mockInstance = { workspaces: {}, releases: {} };
    MockDivinciServer.mockReturnValue(mockInstance as never);

    const config: ResolvedConfig = {
      apiKey: "key",
      apiUrl: "https://api.divinci.app",
      profile: "default",
      source: "env",
    };

    const client = createClient(config);

    expect(client).toBe(mockInstance);
  });
});
