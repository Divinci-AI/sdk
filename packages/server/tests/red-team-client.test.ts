/**
 * RedTeamClient path/verb contract.
 *
 * Paths encode the verified wire truth (public-api
 * `/:whitelabelId/red-team`, GET /plan + POST /run).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RedTeamClient,
  RED_TEAM_CATEGORIES,
  isRedTeamCategory,
} from "../src/red-team/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ServerHttpClient;
}

describe("isRedTeamCategory", () => {
  it("accepts every catalogued category", () => {
    for (const c of RED_TEAM_CATEGORIES) {
      expect(isRedTeamCategory(c)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isRedTeamCategory("sql-injection")).toBe(false);
    expect(isRedTeamCategory("")).toBe(false);
    expect(isRedTeamCategory(null)).toBe(false);
  });
});

describe("RedTeamClient", () => {
  let http: ServerHttpClient;
  let client: RedTeamClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new RedTeamClient(http);
  });

  it("plan() GETs /white-label/:id/red-team/plan", async () => {
    http.get = vi.fn().mockResolvedValue({ categories: [], totalProbes: 32, note: "" });

    await client.plan("ws-1");

    expect(http.get).toHaveBeenCalledWith("/white-label/ws-1/red-team/plan");
  });

  it("run() POSTs /run with category + releaseId and a 120s timeout", async () => {
    http.request = vi.fn().mockResolvedValue({ measured: true, category: "jailbreak" });

    await client.run("ws-1", {
      releaseId: "rel-9",
      category: "jailbreak",
      systemPrompt: "You are a support bot.",
    });

    expect(http.request).toHaveBeenCalledWith(
      "/white-label/ws-1/red-team/run",
      expect.objectContaining({
        method: "POST",
        timeout: 120_000,
        body: {
          category: "jailbreak",
          releaseId: "rel-9",
          systemPrompt: "You are a support bot.",
        },
      }),
    );
  });

  it("run() omits systemPrompt when the caller did not pass one", async () => {
    http.request = vi.fn().mockResolvedValue({ measured: true });

    await client.run("ws-1", { releaseId: "rel-9", category: "prompt-injection" });

    const opts = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      body: Record<string, unknown>;
    };
    expect(opts.body).toEqual({
      category: "prompt-injection",
      releaseId: "rel-9",
    });
  });

  it("run() rejects an unknown category before hitting the network", async () => {
    await expect(
      client.run("ws-1", {
        releaseId: "rel-9",
        category: "sql-injection" as never,
      }),
    ).rejects.toThrow(/Invalid red-team category/);
    expect(http.request).not.toHaveBeenCalled();
  });

  it("run() rejects a missing releaseId before hitting the network", async () => {
    await expect(
      client.run("ws-1", { releaseId: "", category: "jailbreak" }),
    ).rejects.toThrow(/DEPLOYED release/);
    expect(http.request).not.toHaveBeenCalled();
  });

  it("runSweep() walks every category sequentially", async () => {
    const seen: string[] = [];
    http.request = vi.fn().mockImplementation((_path, opts: { body: { category: string } }) => {
      seen.push(opts.body.category);
      return Promise.resolve({ measured: true, category: opts.body.category });
    });

    const sweep = await client.runSweep("ws-1", { releaseId: "rel-9" });

    expect(seen).toEqual([...RED_TEAM_CATEGORIES]);
    expect(sweep.batches).toHaveLength(RED_TEAM_CATEGORIES.length);
    expect(sweep.releaseId).toBe("rel-9");
  });

  it("runSweep() honours a category subset", async () => {
    http.request = vi.fn().mockResolvedValue({ measured: true });

    await client.runSweep("ws-1", {
      releaseId: "rel-9",
      categories: ["harmful-content", "scope-violation"],
    });

    expect(http.request).toHaveBeenCalledTimes(2);
    const cats = (http.request as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[1] as { body: { category: string } }).body.category,
    );
    expect(cats).toEqual(["harmful-content", "scope-violation"]);
  });
});
