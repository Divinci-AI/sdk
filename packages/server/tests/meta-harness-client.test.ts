/**
 * MetaHarnessClient tests
 *
 * Tests SDK HTTP client → URL + method + body mapping for all three
 * sub-accessors (loop, iterations, proposals). This is Layer 2 per the
 * test strategy — catches URL typos, method mismatches, and param
 * serialization bugs without re-testing server handler logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaHarnessClient } from "../src/meta-harness/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

describe("MetaHarnessClient", () => {
  let mockHttp: ReturnType<typeof createMockHttpClient>;
  let client: MetaHarnessClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockHttp = createMockHttpClient();
    client = new MetaHarnessClient(mockHttp);
  });

  // ─── Loop ────────────────────────────────────────────────────────

  describe("loop.get", () => {
    it("calls GET /api/v1/meta-harness/loop", async () => {
      mockHttp.get = vi.fn().mockResolvedValue({ status: "idle", config: {} });
      const result = await client.loop.get();

      expect(mockHttp.get).toHaveBeenCalledWith("/api/v1/meta-harness/loop");
      expect(result.status).toBe("idle");
    });
  });

  describe("loop.update", () => {
    it("calls PATCH /api/v1/meta-harness/loop with config body", async () => {
      mockHttp.patch = vi.fn().mockResolvedValue({
        loop: { status: "idle", config: { autonomyLevel: "full-auto" } },
      });
      const result = await client.loop.update({ autonomyLevel: "full-auto" });

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v1/meta-harness/loop",
        { autonomyLevel: "full-auto" },
      );
      expect(result.config.autonomyLevel).toBe("full-auto");
    });
  });

  describe("loop.iterate", () => {
    it("calls POST /api/v1/meta-harness/loop/iterate", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ accepted: true, loopId: "loop-1" });
      const result = await client.loop.iterate();

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/loop/iterate",
        {},
      );
      expect(result.accepted).toBe(true);
    });
  });

  describe("loop.pause", () => {
    it("calls POST /api/v1/meta-harness/loop/pause", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ status: "paused" });
      await client.loop.pause();

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/loop/pause",
        {},
      );
    });
  });

  describe("loop.resume", () => {
    it("calls POST /api/v1/meta-harness/loop/resume", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ status: "idle" });
      await client.loop.resume();

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/loop/resume",
        {},
      );
    });
  });

  describe("loop.cancel", () => {
    it("calls POST /api/v1/meta-harness/loop/cancel", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ status: "cancelled" });
      await client.loop.cancel();

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/loop/cancel",
        {},
      );
    });
  });

  // ─── Iterations ──────────────────────────────────────────────────

  describe("iterations.list", () => {
    it("calls GET /api/v1/meta-harness/iterations with query params", async () => {
      mockHttp.get = vi.fn().mockResolvedValue([]);
      await client.iterations.list({ limit: 5 });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v1/meta-harness/iterations",
        { limit: 5, cursor: undefined },
      );
    });

    it("defaults to empty options", async () => {
      mockHttp.get = vi.fn().mockResolvedValue([]);
      await client.iterations.list();

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v1/meta-harness/iterations",
        { limit: undefined, cursor: undefined },
      );
    });
  });

  describe("iterations.get", () => {
    it("calls GET /api/v1/meta-harness/iterations/:id", async () => {
      mockHttp.get = vi.fn().mockResolvedValue({ iterationNumber: 3 });
      const result = await client.iterations.get("iter-abc");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v1/meta-harness/iterations/iter-abc",
      );
      expect(result.iterationNumber).toBe(3);
    });
  });

  // ─── Proposals ───────────────────────────────────────────────────

  describe("proposals.list", () => {
    it("passes status filter as query param", async () => {
      mockHttp.get = vi.fn().mockResolvedValue([]);
      await client.proposals.list({ status: "pending" });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v1/meta-harness/proposals",
        { status: "pending", limit: undefined, cursor: undefined },
      );
    });
  });

  describe("proposals.accept", () => {
    it("calls POST /api/v1/meta-harness/proposals/:id/accept", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ status: "accepted" });
      const result = await client.proposals.accept("prop-1");

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/proposals/prop-1/accept",
        {},
      );
      expect(result.status).toBe("accepted");
    });
  });

  describe("proposals.reject", () => {
    it("calls POST /api/v1/meta-harness/proposals/:id/reject with reason", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ status: "rejected" });
      await client.proposals.reject("prop-1", { reason: "not ready" });

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/proposals/prop-1/reject",
        { reason: "not ready" },
      );
    });

    it("sends empty reason when none provided", async () => {
      mockHttp.post = vi.fn().mockResolvedValue({ status: "rejected" });
      await client.proposals.reject("prop-2");

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v1/meta-harness/proposals/prop-2/reject",
        { reason: undefined },
      );
    });
  });

  // ─── Sub-accessor scoping ────────────────────────────────────────

  describe("sub-accessor isolation", () => {
    it("loop, iterations, proposals hit distinct endpoint prefixes", async () => {
      mockHttp.get = vi.fn().mockResolvedValue({});
      mockHttp.post = vi.fn().mockResolvedValue({});

      await client.loop.get();
      await client.iterations.list();
      await client.proposals.list();

      const getCalls = (mockHttp.get as any).mock.calls.map((c: any[]) => c[0]);
      expect(getCalls).toEqual([
        "/api/v1/meta-harness/loop",
        "/api/v1/meta-harness/iterations",
        "/api/v1/meta-harness/proposals",
      ]);
    });
  });
});
