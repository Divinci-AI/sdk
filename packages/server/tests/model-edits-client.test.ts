/**
 * ModelEditsClient tests
 *
 * Pins the wire contract: paths, query params, bodies, and the unwrapping the
 * client does for callers. These are the parts a server change breaks quietly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelEditsClient, type ModelEdit } from "../src/model-edits/index.js";
import { ServerHttpClient } from "../src/http-client.js";

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


function createMockHttpClient(usesApiKey = true) {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    // Route family is chosen from this: `/api/v1/*` is behind requireAPIKey(),
    // `/white-label/:id/larql` takes the OAuth JWT. Existing cases below pin
    // the API-key paths, so they declare the API-key mode explicitly.
    usesApiKey,
  } as unknown as ServerHttpClient;
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

describe("ModelEditsClient", () => {
  let http: ServerHttpClient;
  let client: ModelEditsClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    http = createMockHttpClient();
    client = new ModelEditsClient(http);
  });

  describe("describe", () => {
    it("sends the entity as a query param", async () => {
      const result = {
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
      http.get = vi.fn().mockResolvedValue(result);

      expect(await client.describe("Paris")).toEqual(result);
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits/describe", { entity: "Paris" }, LARQL_TIMEOUT);
    });

    it("leaves query encoding to the http client", async () => {
      // Pre-encoding here would double-encode, and a lookup for an entity with
      // a space would quietly return nothing.
      http.get = vi.fn().mockResolvedValue({ entity: "New York", associations: [] });
      await client.describe("New York");
      expect(http.get).toHaveBeenCalledWith(
        "/api/v1/model-edits/describe",
        { entity: "New York" },
        LARQL_TIMEOUT
      );
    });
  });

  describe("list", () => {
    it("unwraps the { edits } envelope", async () => {
      http.get = vi.fn().mockResolvedValue({ edits: [sampleEdit] });
      expect(await client.list()).toEqual([sampleEdit]);
    });

    it("forwards status and entity filters", async () => {
      http.get = vi.fn().mockResolvedValue({ edits: [] });
      await client.list({ status: "COMMITTED", entity: "Paris" });
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits", {
        status: "COMMITTED",
        entity: "Paris",
      });
    });
  });

  describe("get", () => {
    it("encodes an id containing a path separator", async () => {
      http.get = vi.fn().mockResolvedValue(sampleEdit);
      await client.get("edit/123");
      expect(http.get).toHaveBeenCalledWith("/api/v1/model-edits/edit%2F123");
    });
  });

  describe("create", () => {
    it("posts the triple and op verbatim", async () => {
      http.post = vi.fn().mockResolvedValue({ ...sampleEdit, confidence: 0.93, activeEditCount: 1 });
      await client.create({
        entity: "Paris",
        relation: "capital-of",
        target: "France",
        op: "DELETE",
      });
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/model-edits",
        { entity: "Paris", relation: "capital-of", target: "France", op: "DELETE" },
        LARQL_TIMEOUT
      );
    });

    it("propagates NO_ASSOCIATION rather than returning an empty result", async () => {
      // Callers branch on this — a fact the model never held is a real answer,
      // not a failure to paper over.
      http.post = vi.fn().mockRejectedValue(new Error("No suppressible association"));
      await expect(
        client.create({ entity: "Paris", relation: "r", target: "Nowhere", op: "DELETE" }),
      ).rejects.toThrow("No suppressible association");
    });
  });

  describe("revert", () => {
    it("issues DELETE against the edit id", async () => {
      const reverted = {
        editId: "edit_123",
        status: "reverted" as const,
        entity: "Paris",
        relation: "capital-of",
        target: "France",
        revertedAt: "2026-08-28T01:00:00Z",
      };
      http.delete = vi.fn().mockResolvedValue(reverted);
      expect(await client.revert("edit_123")).toEqual(reverted);
      expect(http.delete).toHaveBeenCalledWith("/api/v1/model-edits/edit_123");
    });
  });
});

describe("ModelEditsClient — OAuth route family", () => {
  // `/api/v1/*` is mounted behind requireAPIKey() and rejects a bearer token
  // outright, so hard-coding it made every `divinci model-edits` call under the
  // CLI's default OAuth login fail with "Authentication failed" — the command
  // group was unusable for its primary auth mode. These pin the JWT surface,
  // which delegates to the same shared edit-service.
  const WS = "6a321d7a0004d6561592719b";

  function oauthClient() {
    const http = createMockHttpClient(false);
    return { http, client: new ModelEditsClient(http, WS) };
  }

  it("describes through the white-label surface", async () => {
    const { http, client } = oauthClient();
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ entity: "Paris", edges: [] });
    await client.describe("Paris");
    expect(http.get).toHaveBeenCalledWith(
      `/white-label/${WS}/larql/describe`,
      { entity: "Paris" },
      LARQL_TIMEOUT
    );
  });

  it("lists and creates through the white-label surface", async () => {
    const { http, client } = oauthClient();
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ edits: [] });
    await client.list();
    expect(http.get).toHaveBeenCalledWith(`/white-label/${WS}/larql/edits`, {
      status: undefined,
      entity: undefined,
    });

    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "e1" });
    await client.create({ entity: "Paris", relation: "r", target: "t", op: "DELETE" });
    expect(http.post).toHaveBeenCalledWith(
      `/white-label/${WS}/larql/edits`,
      { entity: "Paris", relation: "r", target: "t", op: "DELETE" },
      LARQL_TIMEOUT
    );
  });

  it("reverts through the white-label surface", async () => {
    const { http, client } = oauthClient();
    (http.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ reverted: true });
    await client.revert("edit_123");
    expect(http.delete).toHaveBeenCalledWith(`/white-label/${WS}/larql/edits/edit_123`);
  });

  it("gets by filtering the list, because the OAuth surface has no fetch-one", async () => {
    // Calling a route that does not exist would 404 and look like a missing
    // edit rather than a missing route.
    const { http, client } = oauthClient();
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ edits: [sampleEdit] });
    const got = await client.get("edit_123");
    expect(got.id).toBe("edit_123");
    expect(http.get).toHaveBeenCalledWith(`/white-label/${WS}/larql/edits`, {
      status: undefined,
      entity: undefined,
    });
    await expect(client.get("nope")).rejects.toThrow(/not found/i);
  });

  it("refuses rather than guessing when no workspace is known", async () => {
    const http = createMockHttpClient(false);
    const client = new ModelEditsClient(http);
    await expect(client.describe("Paris")).rejects.toThrow(/workspace id is required/i);
    expect(http.get).not.toHaveBeenCalled();
  });

  describe("the cold-start timeout is scoped to the calls that need it", () => {
    // A blanket 120s would mean a genuinely wedged Mongo read hangs the CLI for
    // two minutes. Only the two calls that reach larql get the long timeout.
    it("list, get and revert keep the default", async () => {
      const { http, client } = oauthClient();
      (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ edits: [] });
      (http.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "REVERTED" });

      await client.list();
      await client.revert("edit_123");

      for (const call of [
        ...(http.get as ReturnType<typeof vi.fn>).mock.calls,
        ...(http.delete as ReturnType<typeof vi.fn>).mock.calls,
      ]) {
        const opts = call[2] as { timeout?: number } | undefined;
        expect(opts?.timeout).toBeUndefined();
      }
    });
  });
});
