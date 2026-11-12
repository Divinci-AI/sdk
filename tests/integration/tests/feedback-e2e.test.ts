/**
 * Authenticated E2E for the message-feedback READ surface against staging.
 *
 * These are `/white-label/:id/message-feedback{,/stats,/:id}` ux routes gated by
 * `permissionMiddleware(WHITELABEL_ENUM.viewTranscript)` — they validate the
 * OAuth JWT (ROPC), NOT a workspace API key. So this suite uses getAccessToken()
 * (the test user's bearer token) rather than the API-key path the shape-oracle
 * suite uses.
 *
 * Proves the deployed feature end-to-end: auth gate passes, routes are mounted,
 * handlers query the DB, and response shapes match the SDK's declared DTOs.
 *
 * SECURITY: never log token values.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { shouldRunIntegration, integrationConfig } from "../src/env.js";
import { getAccessToken } from "../src/auth.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

describe.skipIf(!shouldRunIntegration)("message-feedback read E2E (staging)", () => {
  let token: string;
  // Resolved at runtime from the test user's own whitelabels. (The
  // TEST_WHITELABEL_ID fixture is a UUID with no backing WhiteLabel doc, so
  // findById-based routes — notification AND feedback — CastError on it.)
  let wl: string;

  async function authedGet(path: string): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${integrationConfig.apiBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = { __raw: text.slice(0, 200) };
    }
    return { status: res.status, json };
  }

  beforeAll(async () => {
    token = await getAccessToken();
    // Resolve a real ObjectId whitelabel the test user owns.
    const { status, json } = await authedGet("/white-label/");
    if (status !== 200 || !Array.isArray(json)) {
      throw new Error(`could not list own whitelabels (status ${status})`);
    }
    const match = (json as Array<Record<string, unknown>>).find((w) =>
      OBJECT_ID.test(String(w._id ?? w.id ?? "")),
    );
    if (!match) throw new Error("test user owns no ObjectId-keyed whitelabel");
    wl = String(match._id ?? match.id);
  });

  it("GET /message-feedback returns 200 with { docs[], pagination }", async () => {
    const { status, json } = await authedGet(`/white-label/${wl}/message-feedback`);
    expect(status, `expected 200, got ${status} (${JSON.stringify(json).slice(0, 200)})`).toBe(200);
    const body = json as { docs?: unknown; pagination?: Record<string, unknown> };
    expect(Array.isArray(body.docs), "docs[] missing").toBe(true);
    expect(body.pagination, "pagination missing").toBeTruthy();
    expect(typeof body.pagination?.page).toBe("number");
    expect(typeof body.pagination?.limit).toBe("number");
    expect(typeof body.pagination?.total).toBe("number");
    expect(typeof body.pagination?.pages).toBe("number");

    // If the test whitelabel already has feedback, validate a record's DTO shape.
    const docs = body.docs as Array<Record<string, unknown>>;
    if (docs.length > 0) {
      const r = docs[0];
      expect(typeof r.id, "record.id missing").toBe("string");
      expect(typeof r.messageRef, "record.messageRef missing").toBe("string");
      expect([-1, 1, null]).toContain(r.sentiment);
      expect(["authed", "anonymous"]).toContain(r.source);
      expect(typeof r.createdAt).toBe("number");
      expect(typeof r.isRead).toBe("boolean");
      // The stored Notification shape must NOT leak through.
      expect(r).not.toHaveProperty("notificationType");
      expect(r).not.toHaveProperty("details");
      expect(r).not.toHaveProperty("target");
    }
  });

  it("GET /message-feedback/stats returns 200 with the aggregation shape", async () => {
    const { status, json } = await authedGet(`/white-label/${wl}/message-feedback/stats`);
    expect(status, `expected 200, got ${status}`).toBe(200);
    const s = json as {
      total?: unknown;
      bySentiment?: Record<string, unknown>;
      bySource?: Record<string, unknown>;
      withText?: unknown;
      byRelease?: unknown;
    };
    expect(typeof s.total).toBe("number");
    expect(typeof s.bySentiment?.positive).toBe("number");
    expect(typeof s.bySentiment?.negative).toBe("number");
    expect(typeof s.bySentiment?.neutral).toBe("number");
    expect(typeof s.bySource?.authed).toBe("number");
    expect(typeof s.bySource?.anonymous).toBe("number");
    expect(typeof s.withText).toBe("number");
    expect(Array.isArray(s.byRelease), "byRelease[] missing").toBe(true);

    // Internal consistency: sentiment buckets sum to the total.
    const bs = s.bySentiment as { positive: number; negative: number; neutral: number };
    expect(bs.positive + bs.negative + bs.neutral).toBe(s.total);
  });

  it("GET /message-feedback accepts the filter params (sentiment/source/hasText)", async () => {
    const { status, json } = await authedGet(
      `/white-label/${wl}/message-feedback?sentiment=negative&source=anonymous&hasText=true&limit=5`,
    );
    expect(status, `expected 200, got ${status}`).toBe(200);
    const body = json as { docs?: unknown };
    expect(Array.isArray(body.docs)).toBe(true);
  });

  it("GET /message-feedback/:id 404s for a non-existent id (route + ownership check)", async () => {
    const { status } = await authedGet(
      `/white-label/${wl}/message-feedback/000000000000000000000000`,
    );
    expect(status).toBe(404);
  });

  it("404s (not 400) for a malformed whitelabel id", async () => {
    // A non-ObjectId whitelabel can't match a real doc; the requireObjectIdParam
    // guard returns a clean 404 instead of a Mongoose CastError 400.
    const { status } = await authedGet(
      `/white-label/00000000-6931-63c4-ec42-4a88f3a46ee9/message-feedback`,
    );
    expect(status).toBe(404);
  });

  it("404s (not 400) for a malformed feedback id", async () => {
    const { status } = await authedGet(
      `/white-label/${wl}/message-feedback/not-an-objectid`,
    );
    expect(status).toBe(404);
  });

  it("resolved a real ObjectId whitelabel + staging base URL (sanity)", () => {
    expect(wl).toMatch(OBJECT_ID);
    expect(integrationConfig.apiBaseUrl).toMatch(/^https:\/\//);
  });
});
