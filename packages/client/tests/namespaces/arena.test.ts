/**
 * ArenaNamespace tests
 *
 * Tests for Arena operations including variant selection,
 * enable/disable, results, presets, cost estimation, and testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArenaNamespace, ArenaPresetsNamespace } from "../../src/namespaces/arena/index.js";
import type { HttpClient } from "../../src/http-client.js";

// Mock HttpClient
function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
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
const samplePreset = {
  _id: "preset_123",
  whitelabelId: "ws_456",
  name: "GPT vs Claude",
  variants: [
    { name: "GPT-4o", releaseId: "rel-1" },
    { name: "Claude 3.5", releaseId: "rel-2" },
  ],
  status: "active",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const sampleArenaResults = {
  experimentId: "exp-123",
  variants: [
    { name: "GPT-4o", winRate: 55, selections: 110 },
    { name: "Claude 3.5", winRate: 45, selections: 90 },
  ],
  totalSelections: 200,
};

describe("ArenaNamespace", () => {
  let mockHttpClient: HttpClient;
  let arenaNamespace: ArenaNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    arenaNamespace = new ArenaNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Variant Selection ──

  describe("selectChatVariant", () => {
    it("should POST to ai-chat arena-select endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ status: "ok", variantName: "GPT-4o" });

      await arenaNamespace.selectChatVariant({
        chatId: "chat-123",
        messageId: "msg-456",
        selectedIndex: 0,
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/ai-chat/chat-123/message/msg-456/arena-select",
        { selectedIndex: 0 }
      );
    });

    it("should return ArenaSelectResponse", async () => {
      const response = { status: "ok", variantName: "Claude 3.5" };
      vi.mocked(mockHttpClient.post).mockResolvedValue(response);

      const result = await arenaNamespace.selectChatVariant({
        chatId: "chat-123",
        messageId: "msg-456",
        selectedIndex: 1,
      });

      expect(result).toEqual(response);
    });
  });

  describe("selectTranscriptVariant", () => {
    it("should POST to whitelabel transcript arena-select endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ status: "ok" });

      await arenaNamespace.selectTranscriptVariant({
        workspaceId: "ws-123",
        transcriptId: "t-456",
        messageId: "msg-789",
        selectedIndex: 1,
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/transcript/t-456/message/msg-789/arena-select",
        { selectedIndex: 1 }
      );
    });

    it("should use workspaceId from context", async () => {
      const scoped = arenaNamespace.withWorkspace("context-ws");
      vi.mocked(mockHttpClient.post).mockResolvedValue({ status: "ok" });

      await scoped.selectTranscriptVariant({
        transcriptId: "t-456",
        messageId: "msg-789",
        selectedIndex: 0,
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/context-ws/transcript/t-456/message/msg-789/arena-select",
        { selectedIndex: 0 }
      );
    });
  });

  describe("regenerateVariant", () => {
    it("should POST to arena-regenerate-variant endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ status: "ok", variant: { content: "New response" } });

      await arenaNamespace.regenerateVariant({
        workspaceId: "ws-123",
        transcriptId: "t-456",
        messageId: "msg-789",
        variantIndex: 0,
        assistantId: "claude-3-5-sonnet",
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/transcript/t-456/message/msg-789/arena-regenerate-variant",
        { variantIndex: 0, assistantId: "claude-3-5-sonnet" }
      );
    });
  });

  // ── Enable / Disable / Results ──

  describe("enable", () => {
    it("should POST to arena enable endpoint with variants", async () => {
      const body = {
        variants: [
          { name: "GPT-4o", releaseId: "rel-1" },
          { name: "Claude 3.5", releaseId: "rel-2" },
        ],
        showModelNames: true,
      };
      vi.mocked(mockHttpClient.post).mockResolvedValue({ experimentId: "exp-123" });

      await arenaNamespace.enable({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/enable",
        body
      );
    });
  });

  describe("disable", () => {
    it("should POST to arena disable endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ status: "disabled" });

      const result = await arenaNamespace.disable({ workspaceId: "ws-123" });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/disable",
        {}
      );
      expect(result.status).toBe("disabled");
    });
  });

  describe("getResults", () => {
    it("should GET arena results", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleArenaResults);

      const result = await arenaNamespace.getResults({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/results"
      );
      expect(result.totalSelections).toBe(200);
      expect(result.variants).toHaveLength(2);
    });
  });

  // ── Test & Cost Estimation ──

  describe("test", () => {
    it("should POST test question to arena test endpoint", async () => {
      const body = { question: "What is our refund policy?" };
      vi.mocked(mockHttpClient.post).mockResolvedValue({ variants: [] });

      await arenaNamespace.test({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/test",
        body
      );
    });
  });

  describe("testSelect", () => {
    it("should POST operator selection from test panel", async () => {
      const body = { selectedIndex: 0, question: "What is our refund policy?" };
      vi.mocked(mockHttpClient.post).mockResolvedValue({ status: "ok" });

      await arenaNamespace.testSelect({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/test-select",
        body
      );
    });
  });

  describe("costEstimate", () => {
    it("should POST to cost-estimate endpoint", async () => {
      const body = { variants: [], messageCount: 100 };
      vi.mocked(mockHttpClient.post).mockResolvedValue({
        perRound: { estimatedCostFormatted: "$0.02" },
        total: { estimatedCostFormatted: "$2.00" },
      });

      await arenaNamespace.costEstimate({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/cost-estimate",
        body
      );
    });
  });

  describe("routingEstimate", () => {
    it("should POST to QA auto-fix arena-routing-estimate endpoint", async () => {
      const body = { suiteId: "suite-456", experimentId: "exp-789" };
      vi.mocked(mockHttpClient.post).mockResolvedValue({ totalExtraLlmCalls: 50 });

      await arenaNamespace.routingEstimate({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/qa/auto-fix/arena-routing-estimate",
        body
      );
    });
  });

  // ── withWorkspace ──

  describe("withWorkspace", () => {
    it("should return a new ArenaNamespace instance", () => {
      const scoped = arenaNamespace.withWorkspace("ws-123");

      expect(scoped).toBeInstanceOf(ArenaNamespace);
      expect(scoped).not.toBe(arenaNamespace);
    });

    it("should use context workspaceId for operations", async () => {
      const scoped = arenaNamespace.withWorkspace("ws-123");
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleArenaResults);

      await scoped.getResults();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/results"
      );
    });

    it("should allow params to override context workspaceId", async () => {
      const scoped = arenaNamespace.withWorkspace("context-ws");
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleArenaResults);

      await scoped.getResults({ workspaceId: "override-ws" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/override-ws/arena/results"
      );
    });
  });

  // ── Presets sub-namespace ──

  describe("presets", () => {
    it("should return ArenaPresetsNamespace", () => {
      expect(arenaNamespace.presets).toBeInstanceOf(ArenaPresetsNamespace);
    });

    it("should return same instance on repeated access", () => {
      const first = arenaNamespace.presets;
      const second = arenaNamespace.presets;
      expect(first).toBe(second);
    });
  });
});

describe("ArenaPresetsNamespace", () => {
  let mockHttpClient: HttpClient;
  let presetsNamespace: ArenaPresetsNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    presetsNamespace = new ArenaPresetsNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should GET presets for workspace", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue({ presets: [samplePreset] });

      const result = await presetsNamespace.list({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets"
      );
      expect(result).toEqual([samplePreset]);
    });
  });

  describe("create", () => {
    it("should POST new preset", async () => {
      const body = { name: "GPT vs Claude", variants: [] };
      vi.mocked(mockHttpClient.post).mockResolvedValue({ preset: samplePreset });

      const result = await presetsNamespace.create({ workspaceId: "ws-123" }, body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets",
        body
      );
      expect(result.name).toBe("GPT vs Claude");
    });
  });

  describe("update", () => {
    it("should PUT to preset endpoint", async () => {
      const body = { name: "Updated Name" };
      vi.mocked(mockHttpClient.put).mockResolvedValue({ preset: { ...samplePreset, name: "Updated Name" } });

      const result = await presetsNamespace.update(
        { workspaceId: "ws-123", presetId: "preset_123" },
        body
      );

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets/preset_123",
        body
      );
      expect(result.name).toBe("Updated Name");
    });
  });

  describe("delete", () => {
    it("should DELETE preset", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(undefined);

      await presetsNamespace.delete({ workspaceId: "ws-123", presetId: "preset_123" });

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets/preset_123"
      );
    });
  });

  describe("activate", () => {
    it("should POST to activate endpoint", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ experimentId: "exp-new" });

      const result = await presetsNamespace.activate({ workspaceId: "ws-123", presetId: "preset_123" });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets/preset_123/activate",
        {}
      );
      expect(result.experimentId).toBe("exp-new");
    });
  });

  describe("export", () => {
    it("should GET export for preset", async () => {
      const exportData = { name: "GPT vs Claude", variants: [], version: "1.0" };
      vi.mocked(mockHttpClient.get).mockResolvedValue(exportData);

      const result = await presetsNamespace.export({ workspaceId: "ws-123", presetId: "preset_123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets/preset_123/export"
      );
      expect(result).toEqual(exportData);
    });
  });

  describe("import", () => {
    it("should POST import data", async () => {
      const importData = { name: "Imported Preset", variants: [], version: "1.0" };
      vi.mocked(mockHttpClient.post).mockResolvedValue({ preset: samplePreset });

      const result = await presetsNamespace.import({ workspaceId: "ws-123" }, importData);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets/import",
        importData
      );
      expect(result._id).toBe("preset_123");
    });
  });

  describe("getResults", () => {
    it("should GET results for preset", async () => {
      const results = { experimentIds: ["exp-1"], variants: [], totalSelections: 50 };
      vi.mocked(mockHttpClient.get).mockResolvedValue(results);

      const result = await presetsNamespace.getResults({ workspaceId: "ws-123", presetId: "preset_123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/arena/presets/preset_123/results"
      );
      expect(result.totalSelections).toBe(50);
    });
  });
});
