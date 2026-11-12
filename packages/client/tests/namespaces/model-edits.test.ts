/**
 * ModelEditsNamespace tests
 *
 * Pins the wire contract: paths, query params, bodies, and the unwrapping the
 * namespace does on the caller's behalf. These are the parts a server change
 * can break silently.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ModelEditsNamespace,
  type ModelEdit,
  type DescribeEntityResult,
  type CreateModelEditResult,
  type RevertModelEditResult,
} from "../../src/namespaces/model-edits/index.js";
import type { HttpClient } from "../../src/http-client.js";

/**
 * The larql-backed calls must outlive a cold start.
 *
 * larql-service runs at minScale 0 on an L4; a request after an idle period
 * waits ~23s for the model to load before any work begins. Under the 30s
 * default a `create` timed out AFTER committing server-side, so the caller
 * retried and left a duplicate suppression behind — three of them reached a
 * production workspace that way. Asserting the value here, rather than merely
 * tolerating a third argument, is what stops it silently reverting.
 */
const LARQL_TIMEOUT = { timeout: 120_000 };


function createMockHttpClient(hasApiKey = true): HttpClient {
  return {
    // Route family comes from this: `/api/v1/*` is behind requireAPIKey(),
    // `/white-label/:id/larql` takes the OAuth JWT. These cases pin the
    // API-key paths, so they declare that mode.
    hasApiKey,
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    postFormData: vi.fn(),
    getToken: vi.fn(),
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearTokens: vi.fn(),
  } as unknown as HttpClient;
}

const sampleEdit: ModelEdit = {
  id: "edit_123",
  op: "DELETE",
  entity: "Paris",
  relation: "capital-of",
  target: "France",
  status: "COMMITTED",
  modelVersion: "9abaeaf6",
  appliedAt: "2026-08-28T00:00:00Z",
  committedAt: "2026-08-28T00:00:01Z",
  probeResult: { deltaLogit: -0.42, probeBefore: 0.61, probeAfter: 0.19 },
};

describe("ModelEditsNamespace", () => {
  let http: HttpClient;
  let ns: ModelEditsNamespace;

  beforeEach(() => {
    http = createMockHttpClient();
    ns = new ModelEditsNamespace(http, {});
  });

  describe("describe", () => {
    it("passes the entity as a query param, not a path segment", async () => {
      const result: DescribeEntityResult = {
        entity: "Paris",
        associations: [
          {
            relation: "capital-of",
            target: "France",
            confidence: 1,
            rawScore: 44,
            layer: 25,
            neighbors: ["Eiffel"],
          },
        ],
      };
      vi.mocked(http.get).mockResolvedValue(result);

      expect(await ns.describe("Paris")).toEqual(result);
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits/describe", { entity: "Paris" }, LARQL_TIMEOUT);
    });

    it("does not pre-encode the entity — the http client owns query encoding", async () => {
      // Double-encoding an entity with a space or slash is how a lookup for a
      // real-world entity silently returns nothing.
      vi.mocked(http.get).mockResolvedValue({ entity: "New York", associations: [] });
      await ns.describe("New York");
      expect(http.get).toHaveBeenCalledWith(
        "/api/v1/model-edits/describe",
        { entity: "New York" },
        LARQL_TIMEOUT
      );
    });
  });

  describe("list", () => {
    it("unwraps the { edits } envelope", async () => {
      vi.mocked(http.get).mockResolvedValue({ edits: [sampleEdit] });
      expect(await ns.list()).toEqual([sampleEdit]);
    });

    it("forwards status and entity filters", async () => {
      vi.mocked(http.get).mockResolvedValue({ edits: [] });
      await ns.list({ status: "COMMITTED", entity: "Paris" });
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits", {
        status: "COMMITTED",
        entity: "Paris",
      });
    });

    it("sends undefined for absent filters so they are omitted, not sent empty", async () => {
      vi.mocked(http.get).mockResolvedValue({ edits: [] });
      await ns.list();
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits", {
        status: undefined,
        entity: undefined,
      });
    });
  });

  describe("get", () => {
    it("requests the edit by id", async () => {
      vi.mocked(http.get).mockResolvedValue(sampleEdit);
      expect(await ns.get("edit_123")).toEqual(sampleEdit);
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits/edit_123");
    });

    it("encodes an id with path-significant characters", async () => {
      vi.mocked(http.get).mockResolvedValue(sampleEdit);
      await ns.get("edit/123");
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits/edit%2F123");
    });
  });

  describe("create", () => {
    it("posts the triple and op verbatim", async () => {
      const created: CreateModelEditResult = {
        ...sampleEdit,
        confidence: 0.93,
        activeEditCount: 1,
      };
      vi.mocked(http.post).mockResolvedValue(created);

      const out = await ns.create({
        entity: "Paris",
        relation: "capital-of",
        target: "France",
        op: "DELETE",
      });

      expect(out).toEqual(created);
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/model-edits",
        { entity: "Paris", relation: "capital-of", target: "France", op: "DELETE" },
        LARQL_TIMEOUT
      );
    });

    it("propagates the server error rather than swallowing it", async () => {
      // NO_ASSOCIATION is the normal answer for a fact the model never held.
      // Callers branch on it, so it must not be turned into an empty result.
      vi.mocked(http.post).mockRejectedValue(
        Object.assign(new Error("No suppressible association"), { code: "NO_ASSOCIATION" }),
      );
      await expect(
        ns.create({ entity: "Paris", relation: "r", target: "Nowhere", op: "DELETE" }),
      ).rejects.toThrow("No suppressible association");
    });
  });

  describe("revert", () => {
    it("issues DELETE against the edit id", async () => {
      const reverted: RevertModelEditResult = {
        editId: "edit_123",
        status: "reverted",
        entity: "Paris",
        relation: "capital-of",
        target: "France",
        revertedAt: "2026-08-28T01:00:00Z",
      };
      vi.mocked(http.delete).mockResolvedValue(reverted);

      expect(await ns.revert("edit_123")).toEqual(reverted);
      expect(http.delete).toHaveBeenCalledWith("/api/v1/model-edits/edit_123");
    });
  });

  describe("the cold-start timeout is scoped to the calls that need it", () => {
    // A blanket 120s would mean a genuinely wedged Mongo read hangs the caller
    // for two minutes. Only the two calls that reach larql get it.
    it("list, get and revert keep the default", async () => {
      vi.mocked(http.get).mockResolvedValue({ edits: [] });
      vi.mocked(http.delete).mockResolvedValue({ status: "REVERTED" });

      await ns.list();
      await ns.revert("edit_123");

      for (const call of [
        ...vi.mocked(http.get).mock.calls,
        ...vi.mocked(http.delete).mock.calls,
      ]) {
        const opts = call[2] as { timeout?: number } | undefined;
        expect(opts?.timeout).toBeUndefined();
      }
    });
  });
});
