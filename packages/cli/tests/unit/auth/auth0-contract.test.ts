/**
 * The CLI<->server authentication contract.
 *
 * cli <=0.2.9 asked Auth0 for PROD tokens from the DEV tenant
 * (dev-46tiys6hnb6vbg17, audience chat.divinci.app:8081) while prod validates
 * divinci-prod / chat.divinci.app:8080. The tokens were real and the login flow
 * succeeded, so `auth status` reported "Authenticated, token valid" — but every
 * /api/v1 route 403'd, and because the server fails OPEN on a validation
 * failure (optionalAuthMiddlewareHTTP swallows the error, then getUserId throws
 * FORBIDDEN), a valid token, a garbage token and NO token were byte-identical
 * 403s. That made it undiagnosable from the client: re-authenticating produced
 * another wrong-tenant token, and the "no-token control test also 403s" reading
 * pointed at a Cloudflare Access layer that does not exist.
 *
 * The bug was a two-line config drift that nothing compared. These tests are
 * that comparison. They are deliberately CREDENTIAL-FREE so they run everywhere;
 * scripts/verify-auth0-contract.mjs checks the same lock against Infisical.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getAuth0Config } from "../../../src/auth/oauth.js";

const lockPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/auth/auth0-contract.lock.json",
);
const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
  environments: Record<string, { domain: string; audience: string; issuer: string }>;
};
const environments = Object.entries(lock.environments);

describe("Auth0 contract", () => {
  test("the lock covers at least prod, staging and dev", () => {
    expect(environments.length).toBeGreaterThanOrEqual(3);
    expect(lock.environments["https://api.divinci.app"]).toBeDefined();
  });

  test.each(environments)("%s uses the locked tenant and audience", (apiUrl, expected) => {
    const config = getAuth0Config(apiUrl);
    expect(config.domain).toBe(expected.domain);
    expect(config.audience).toBe(expected.audience);
  });

  test("production does NOT authenticate against the dev tenant", () => {
    // The exact regression. Named explicitly so a future edit that reintroduces
    // it fails with a message that says what it broke, not just "expected X".
    const prod = getAuth0Config("https://api.divinci.app");
    expect(prod.domain).not.toContain("dev-");
    expect(prod.audience).not.toBe("chat.divinci.app:8081");
  });

  test("each environment has a distinct tenant+audience pair", () => {
    const pairs = environments.map(([, e]) => `${e.domain}|${e.audience}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("an unknown API URL is REFUSED, not silently served production config", () => {
    // This test previously asserted the opposite — that an unknown URL falls
    // back to production — reasoning only about WHICH tenant it fell back to
    // (prod, not dev) and never about whether falling back was safe at all.
    //
    // It was not. Falling back means `--api-url https://evil.test` mints a REAL
    // production access token and then sends it to that host. A typo does the
    // same by accident. Refusing is the only safe answer.
    expect(() => getAuth0Config("https://api.example.invalid")).toThrow(/Unknown API URL/);
  });

  test("the refusal names the known hosts and the escape hatch", () => {
    // An error that only says "no" sends people hunting. It has to say what IS
    // valid and how a legitimate custom deployment proceeds.
    let message = "";
    try { getAuth0Config("https://api.example.invalid"); } catch (e) { message = (e as Error).message; }
    expect(message).toContain("https://api.divinci.app");
    expect(message).toContain("DIVINCI_AUTH0_DOMAIN");
    expect(message).toMatch(/production access token/i);
  });

  test("a custom deployment works when ALL THREE env vars are set", () => {
    const saved = { ...process.env };
    process.env.DIVINCI_AUTH0_DOMAIN = "tenant.example.auth0.com";
    process.env.DIVINCI_AUTH0_CLIENT_ID = "abc123";
    process.env.DIVINCI_AUTH0_AUDIENCE = "https://api.self-hosted.test";
    try {
      const cfg = getAuth0Config("https://api.self-hosted.test");
      expect(cfg.domain).toBe("tenant.example.auth0.com");
      expect(cfg.audience).toBe("https://api.self-hosted.test");
    } finally {
      process.env = saved;
    }
  });

  test("a PARTIAL env override is refused, not half-applied", () => {
    // Requiring all three is the point. A partial override is how you end up
    // authenticating against one environment while talking to another — the
    // exact failure this file has already shipped once.
    const saved = { ...process.env };
    process.env.DIVINCI_AUTH0_DOMAIN = "tenant.example.auth0.com";
    delete process.env.DIVINCI_AUTH0_CLIENT_ID;
    delete process.env.DIVINCI_AUTH0_AUDIENCE;
    try {
      expect(() => getAuth0Config("https://api.self-hosted.test")).toThrow(/Unknown API URL/);
    } finally {
      process.env = saved;
    }
  });

  test("issuer is the domain as an https origin, with no trailing slash", () => {
    // The server compares the token's `iss` against AUTH0_BASE_URL verbatim, so
    // a trailing slash or a bare hostname here is a silent validation failure.
    for (const [, env] of environments) {
      expect(env.issuer).toBe(`https://${env.domain}`);
      expect(env.issuer.endsWith("/")).toBe(false);
    }
  });
});
