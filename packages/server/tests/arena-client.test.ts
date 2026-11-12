/**
 * ArenaClient tests (Server SDK)
 *
 * Tests for server-side Arena operations including enable/disable,
 * variant selection, results, presets, cost estimation, and testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArenaClient, ArenaPresetsClient } from "../src/arena/index.js";
import { ServerHttpClient } from "../src/http-client.js";

// Mock ServerHttpClient
function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
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
};

describe("ArenaClient", () => {
  let mockHttpClient: ReturnType<typeof createMockHttpClient>;
  let arenaClient: ArenaClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    arenaClient = new ArenaClient(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Enable / Disable / Results ──

  describe("enable", () => {
    it("should POST to enable endpoint", async () => {
      const body = {
        variants: [
          { name: "GPT-4o", releaseId: "rel-1" },
          { name: "Claude 3.5", releaseId: "rel-2" },
        ],
        showModelNames: true,
      };
      mockHttpClient.post.mockResolvedValue({ experimentId: "exp-123", arenaConfig: {} });

      await arenaClient.enable("ws-123", body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/enable",
        body
      );
    });
  });

  describe("disable", () => {
    it("should POST to disable endpoint", async () => {
      mockHttpClient.post.mockResolvedValue({ status: "disabled" });

      const result = await arenaClient.disable("ws-123");

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/disable",
        {}
      );
      expect(result.status).toBe("disabled");
    });
  });

  describe("getResults", () => {
    it("should GET arena results", async () => {
      const results = { variants: [{ name: "GPT-4o", winRate: 60 }], totalSelections: 100 };
      mockHttpClient.get.mockResolvedValue(results);

      const result = await arenaClient.getResults("ws-123");

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/results"
      );
      expect(result.totalSelections).toBe(100);
    });
  });

  // ── Variant Selection ──

  describe("selectChatVariant", () => {
    it("should POST to ai-chat arena-select", async () => {
      mockHttpClient.post.mockResolvedValue({ status: "ok" });

      await arenaClient.selectChatVariant("chat-123", "msg-456", 0);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/ai-chat/chat-123/message/msg-456/arena-select",
        { selectedIndex: 0 }
      );
    });
  });

  describe("selectTranscriptVariant", () => {
    it("should POST to whitelabel transcript arena-select", async () => {
      mockHttpClient.post.mockResolvedValue({ status: "ok" });

      await arenaClient.selectTranscriptVariant("ws-123", "t-456", "msg-789", 1);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/transcript/t-456/message/msg-789/arena-select",
        { selectedIndex: 1 }
      );
    });
  });

  describe("regenerateVariant", () => {
    it("should POST to arena-regenerate-variant", async () => {
      mockHttpClient.post.mockResolvedValue({ status: "ok", variant: { content: "New text" } });

      await arenaClient.regenerateVariant("ws-123", "t-456", "msg-789", 0, "claude-3-5-sonnet");

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/transcript/t-456/message/msg-789/arena-regenerate-variant",
        { variantIndex: 0, assistantId: "claude-3-5-sonnet" }
      );
    });
  });

  // ── Test & Cost ──

  describe("test", () => {
    it("should POST test question", async () => {
      const body = { question: "What is our refund policy?" };
      mockHttpClient.post.mockResolvedValue({ variants: [] });

      await arenaClient.test("ws-123", body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/test",
        body
      );
    });
  });

  describe("testSelect", () => {
    it("should POST operator test selection", async () => {
      const body = { selectedIndex: 0, question: "What is our refund policy?" };
      mockHttpClient.post.mockResolvedValue({ status: "ok" });

      await arenaClient.testSelect("ws-123", body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/test-select",
        body
      );
    });
  });

  describe("costEstimate", () => {
    it("should POST to cost-estimate endpoint", async () => {
      const body = { variants: [], messageCount: 100 };
      mockHttpClient.post.mockResolvedValue({
        perRound: { estimatedCostFormatted: "$0.02" },
        total: { estimatedCostFormatted: "$2.00" },
      });

      const result = await arenaClient.costEstimate("ws-123", body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/cost-estimate",
        body
      );
      expect(result.total.estimatedCostFormatted).toBe("$2.00");
    });
  });

  describe("routingEstimate", () => {
    it("should POST to arena-routing-estimate", async () => {
      const body = { suiteId: "suite-456", experimentId: "exp-789" };
      mockHttpClient.post.mockResolvedValue({ totalExtraLlmCalls: 50 });

      const result = await arenaClient.routingEstimate("ws-123", body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/qa/auto-fix/arena-routing-estimate",
        body
      );
      expect(result.totalExtraLlmCalls).toBe(50);
    });
  });

  // ── Presets ──

  describe("presets", () => {
    it("should return ArenaPresetsClient", () => {
      expect(arenaClient.presets).toBeInstanceOf(ArenaPresetsClient);
    });

    it("should return same instance on repeated access", () => {
      const first = arenaClient.presets;
      const second = arenaClient.presets;
      expect(first).toBe(second);
    });
  });
});

describe("ArenaPresetsClient", () => {
  let mockHttpClient: ReturnType<typeof createMockHttpClient>;
  let presetsClient: ArenaPresetsClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    presetsClient = new ArenaPresetsClient(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should GET presets", async () => {
      mockHttpClient.get.mockResolvedValue({ presets: [samplePreset] });

      const result = await presetsClient.list("ws-123");

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets"
      );
      expect(result).toEqual([samplePreset]);
    });
  });

  describe("create", () => {
    it("should POST new preset", async () => {
      const body = { name: "New Preset", variants: [] };
      mockHttpClient.post.mockResolvedValue({ preset: samplePreset });

      const result = await presetsClient.create("ws-123", body);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets",
        body
      );
      expect(result.name).toBe("GPT vs Claude");
    });
  });

  describe("update", () => {
    it("should PUT preset update", async () => {
      const body = { name: "Updated" };
      mockHttpClient.put.mockResolvedValue({ preset: { ...samplePreset, name: "Updated" } });

      const result = await presetsClient.update("ws-123", "preset_123", body);

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets/preset_123",
        body
      );
      expect(result.name).toBe("Updated");
    });
  });

  describe("delete", () => {
    it("should DELETE preset", async () => {
      mockHttpClient.delete.mockResolvedValue(undefined);

      await presetsClient.delete("ws-123", "preset_123");

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets/preset_123"
      );
    });
  });

  describe("activate", () => {
    it("should POST to activate", async () => {
      mockHttpClient.post.mockResolvedValue({ experimentId: "exp-new" });

      const result = await presetsClient.activate("ws-123", "preset_123");

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets/preset_123/activate",
        {}
      );
      expect(result.experimentId).toBe("exp-new");
    });
  });

  describe("export", () => {
    it("should GET export data", async () => {
      const exportData = { name: "GPT vs Claude", variants: [] };
      mockHttpClient.get.mockResolvedValue(exportData);

      const result = await presetsClient.export("ws-123", "preset_123");

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets/preset_123/export"
      );
      expect(result).toEqual(exportData);
    });
  });

  describe("import", () => {
    it("should POST import data", async () => {
      const importData = { name: "Imported", variants: [] };
      mockHttpClient.post.mockResolvedValue({ preset: samplePreset });

      const result = await presetsClient.import("ws-123", importData);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets/import",
        importData
      );
      expect(result._id).toBe("preset_123");
    });
  });

  describe("getResults", () => {
    it("should GET preset results", async () => {
      const results = { experimentIds: ["exp-1"], variants: [], totalSelections: 50 };
      mockHttpClient.get.mockResolvedValue(results);

      const result = await presetsClient.getResults("ws-123", "preset_123");

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/api/v1/whitelabel/ws-123/arena/presets/preset_123/results"
      );
      expect(result.totalSelections).toBe(50);
    });
  });
});
