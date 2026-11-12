/**
 * Headless external-user auth E2E against staging — the exact partner flow
 * that was blocked before client@0.5.0 (see cli/client CHANGELOGs 2026-07-01):
 *
 *   1. backend mints an embed API key (create → rotate for the secret)
 *   2. POST /embed/login   (API key + user identity)  → 7-day refreshToken
 *   3. POST /embed/validate-login (refreshToken + origin + releaseId)
 *                                                     → 30-min accessToken
 *   4. accessToken drives @divinci-ai/client as `userToken` on the ux
 *      routes (chat.create) — the surface that 403'd with the refresh token
 *
 * Also pins the two security-relevant negatives:
 *   - the refresh token is NOT accepted as an Authorization bearer
 *   - validate-login rejects an origin missing from the key's allowedOrigins
 *
 * SECURITY: never log the key secret, refresh token, or access token.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DivinciClient } from "@divinci-ai/client";
import { shouldRunIntegration, integrationConfig } from "../src/env.js";
import { getAccessToken } from "../src/auth.js";
import { discoverFixtures } from "../src/discovery.js";

const api = integrationConfig.apiBaseUrl;
const ALLOWED_ORIGIN = "https://headless-e2e.divinci.test";
const WRONG_ORIGIN = "https://not-allowlisted.example.com";

function anyId(obj: unknown): string | undefined {
  const rec = obj as Record<string, unknown> | null;
  const candidate = rec?.id ?? rec?._id;
  return typeof candidate === "string" ? candidate : undefined;
}

async function json(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return { __raw: text.slice(0, 200) };
  }
}

describe.skipIf(!shouldRunIntegration)("headless external-user auth E2E (staging)", () => {
  let oauthToken: string;
  let workspaceId: string;
  let releaseId: string;
  let apikeyId: string | undefined;
  let apikeySecret: string;
  let tierSlug: string;
  let createdTierId: string | undefined;
  let refreshToken: string;
  let accessToken: string;
  let threadId: string | undefined;
  let sdkClient: DivinciClient | undefined;

  beforeAll(async () => {
    oauthToken = await getAccessToken();
    const fixtures = await discoverFixtures(oauthToken);
    workspaceId = fixtures.workspaceId;
    releaseId = fixtures.releaseId;

    // /embed/login validates membershipTier against the whitelabel's embed
    // tiers ("Invalid tier … availableSlugs") — reuse an existing tier or
    // provision a throwaway one.
    const tiersRes = await fetch(`${api}/white-label/${workspaceId}/embed/tier`, {
      headers: { Authorization: `Bearer ${oauthToken}` },
    });
    const tiers = await json(tiersRes);
    const tierList: any[] = Array.isArray(tiers) ? tiers : tiers?.tiers ?? tiers?.data ?? [];
    if (tierList.length > 0 && typeof tierList[0]?.slug === "string") {
      tierSlug = tierList[0].slug;
    } else {
      tierSlug = "headless-e2e";
      const tierRes = await fetch(`${api}/white-label/${workspaceId}/embed/tier`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Headless E2E (auto-deleted)",
          slug: tierSlug,
          // staging's deployed validator requires a non-empty array here
          windowValidations: [{ durationMs: 86_400_000, limitNanoUSD: "1000000000" }],
          messageLimits: {
            messagesPerMonth: -1,
            messagesPerDay: -1,
            messagesPerHour: -1,
            maxConversationLength: -1,
          },
        }),
      });
      expect([200, 201], `embed tier create (status ${tierRes.status})`).toContain(tierRes.status);
      createdTierId = anyId(await json(tierRes));
    }

    // Provision a throwaway embed API key. Keys are created secretless
    // (hashedKey: "") — the secret is minted by the first rotation.
    const createRes = await fetch(`${api}/white-label/${workspaceId}/embed/api-key`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "headless-auth-e2e (auto-deleted)",
        allowedOrigins: [ALLOWED_ORIGIN],
      }),
    });
    expect(createRes.status, "embed api-key create").toBe(201);
    apikeyId = anyId(await json(createRes));
    expect(apikeyId, "created key has no id").toBeTruthy();

    const rotateRes = await fetch(
      `${api}/white-label/${workspaceId}/embed/api-key/${apikeyId}/rotate`,
      { method: "POST", headers: { Authorization: `Bearer ${oauthToken}` } },
    );
    expect(rotateRes.status, "embed api-key rotate").toBe(200);
    const rotated = await json(rotateRes);
    apikeySecret = rotated?.newSecretKey;
    expect(typeof apikeySecret, "rotate returned no newSecretKey").toBe("string");
  }, 60_000);

  afterAll(async () => {
    if (threadId && sdkClient) {
      try {
        await sdkClient.chat.delete(threadId);
      } catch {
        /* embed users may not be allowed to delete; the key deletion below
           orphans nothing sensitive */
      }
    }
    if (apikeyId) {
      const del = await fetch(`${api}/white-label/${workspaceId}/embed/api-key/${apikeyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${oauthToken}` },
      });
      console.log(`[integration] embed api-key cleanup status=${del.status}`);
    }
    if (createdTierId) {
      const del = await fetch(
        `${api}/white-label/${workspaceId}/embed/tier/${createdTierId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${oauthToken}` } },
      );
      console.log(`[integration] embed tier cleanup status=${del.status}`);
    }
  }, 30_000);

  it("POST /embed/login exchanges API key + identity for a refresh token", async () => {
    const res = await fetch(`${api}/embed/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: apikeySecret,
        userId: `headless-e2e-${Date.now()}`,
        membershipTier: tierSlug,
        username: "Headless E2E",
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body?.refreshToken, "no refreshToken in /embed/login response").toBe("string");
    expect(typeof body?.refreshExpiresAt).toBe("string");
    refreshToken = body.refreshToken;
  });

  it("refresh token is NOT accepted as a bearer credential on ux routes", async () => {
    const res = await fetch(`${api}/ai-chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "should-never-exist" }),
    });
    // The exact status is middleware-dependent (401 vs 403); the invariant is
    // that a refresh token never authorizes a ux route.
    expect(res.status, "refresh token must not authorize /ai-chat").toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
  });

  it("validate-login rejects an origin not in the key's allowedOrigins", async () => {
    const res = await fetch(`${api}/embed/validate-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, origin: WRONG_ORIGIN, releaseId }),
    });
    expect(res.status).toBe(200); // deliberate non-oracle: failures are 200 {valid:false}
    const body = await json(res);
    expect(body?.valid).toBe(false);
    expect(body?.accessToken).toBeUndefined();
  });

  it("validate-login exchanges the refresh token for an access token", async () => {
    const res = await fetch(`${api}/embed/validate-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, origin: ALLOWED_ORIGIN, releaseId }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body?.valid, "validate-login rejected an allowlisted origin").toBe(true);
    expect(typeof body?.accessToken).toBe("string");
    expect(body?.userInfo?.user_id).toBeTruthy();
    expect(body?.tierConfig?.tier).toBeTruthy();
    accessToken = body.accessToken;
  });

  it("the access token drives @divinci-ai/client as userToken on ux routes", async () => {
    sdkClient = new DivinciClient({
      releaseId,
      userToken: accessToken,
      baseUrl: api,
      timeout: 45_000,
    });

    const thread = await sdkClient.chat.create({ title: "headless-auth-e2e" });
    threadId = anyId(thread);
    expect(threadId, "chat.create returned no thread id — access token not honored").toBeTruthy();
  });
});
