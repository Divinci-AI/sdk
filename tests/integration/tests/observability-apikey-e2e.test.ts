/**
 * Live API-key E2E for the observability read routes against staging.
 *
 * Reproduces the partner-SDK scenario (DrFuhrman): authenticate with a workspace
 * API key (X-API-Key) — NOT OAuth — and read feedback / analytics. Mints a scoped
 * key as the OAuth test user, rotates it to get the secret, exercises the routes
 * with the key, then deletes it.
 *
 * Proves: transcript:view path (feedback), whitelabel:config path (analytics),
 * and the WORKSPACE_MISMATCH binding guard (key can't read a different workspace).
 *
 * SECURITY: never log the key secret or the OAuth token.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { shouldRunIntegration, integrationConfig } from "../src/env.js";
import { getAccessToken } from "../src/auth.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const api = integrationConfig.apiBaseUrl;

describe.skipIf(!shouldRunIntegration)("observability API-key E2E (staging)", () => {
  let token: string;
  let wl: string;        // whitelabel the key is bound to
  let otherWl: string;   // a different owned whitelabel (for the mismatch test)
  let apikeyId: string;
  let secret: string;

  async function oauthJson(method: string, path: string, body?: unknown) {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = { __raw: text.slice(0, 200) }; }
    return { status: res.status, json };
  }

  async function keyGet(path: string, whitelabelId = wl) {
    const res = await fetch(`${api}/white-label/${whitelabelId}${path}`, {
      headers: { "X-API-Key": secret },
    });
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = { __raw: text.slice(0, 200) }; }
    return { status: res.status, json };
  }

  beforeAll(async () => {
    token = await getAccessToken();
    const own = await oauthJson("GET", "/white-label/");
    const list = (Array.isArray(own.json) ? own.json : []) as Array<Record<string, unknown>>;
    const ids = list.map((w) => String(w._id ?? w.id ?? "")).filter((id) => OBJECT_ID.test(id));
    if (ids.length < 1) throw new Error("test user owns no ObjectId-keyed whitelabel");
    wl = ids[0];
    otherWl = ids.find((id) => id !== wl) ?? "";

    // Mint a key scoped to both observability permission families, then rotate
    // to obtain the usable secret (creation leaves hashedKey empty).
    const created = await oauthJson("POST", `/white-label/${wl}/embed/api-key/`, {
      name: "obs-e2e-key",
      allowedOrigins: [],
      permissions: ["transcript:view", "whitelabel:config"],
    });
    if (created.status !== 201) {
      throw new Error(`create key failed (${created.status}): ${JSON.stringify(created.json).slice(0, 200)}`);
    }
    apikeyId = String(created.json._id ?? created.json.id);
    const rotated = await oauthJson("POST", `/white-label/${wl}/embed/api-key/${apikeyId}/rotate`);
    if (rotated.status !== 200 || !rotated.json?.newSecretKey) {
      throw new Error(`rotate key failed (${rotated.status})`);
    }
    secret = rotated.json.newSecretKey;
  });

  afterAll(async () => {
    if (apikeyId) {
      await oauthJson("DELETE", `/white-label/${wl}/embed/api-key/${apikeyId}`).catch(() => {});
    }
  });

  it("API key reads feedback list (transcript:view path) → 200", async () => {
    const { status, json } = await keyGet("/message-feedback");
    expect(status, `expected 200, got ${status} (${JSON.stringify(json).slice(0, 160)})`).toBe(200);
    expect(Array.isArray(json.docs)).toBe(true);
  });

  it("API key reads feedback stats → 200 with aggregation shape", async () => {
    const { status, json } = await keyGet("/message-feedback/stats");
    expect(status).toBe(200);
    expect(typeof json.total).toBe("number");
    expect(typeof json.bySentiment?.positive).toBe("number");
  });

  it("API key reads product analytics metrics (whitelabel:config path) → 200", async () => {
    const { status } = await keyGet("/analytics/products/metrics?timeRange=7d");
    expect(status).toBe(200);
  });

  it("WORKSPACE_MISMATCH: the key cannot read a different whitelabel", async () => {
    if (!otherWl) return; // only one whitelabel owned; skip
    const { status, json } = await keyGet("/message-feedback", otherWl);
    expect(status).toBe(403);
    expect(json?.error?.code).toBe("WORKSPACE_MISMATCH");
  });

  it("fail-closed: a bogus API key 401s, never falls through to the handler", async () => {
    const res = await fetch(`${api}/white-label/${wl}/message-feedback`, {
      headers: { "X-API-Key": "divinci_bogus_key_that_does_not_exist" },
    });
    // Must be 401 (auth failed) — never 200 (fall-through) or 403 (handler-level).
    expect(res.status).toBe(401);
  });
});
