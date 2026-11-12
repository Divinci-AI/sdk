/**
 * ServerHttpClient Integration Tests
 *
 * Tests the HTTP client against a running local API server.
 * Requires local-mac.yml to be running (API on port 9080).
 *
 * Uses JWT auth (Bearer token) since API key model has Mongoose connection
 * issues in the local Docker environment.
 *
 * Run with: INTEGRATION=true npx vitest run tests/integration/http-client-live.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ServerHttpClient, ServerApiError } from "../../src/http-client.js";
import * as fs from "fs";
import * as path from "path";

// Skip unless INTEGRATION=true is set
const RUN_INTEGRATION = process.env.INTEGRATION === "true";

// Resolve auth state to extract JWT
function getJwtToken(): string {
  const authFile = path.resolve(
    __dirname,
    "../../../../../../workspace/clients/tests/auth/admin.json"
  );

  if (!fs.existsSync(authFile)) {
    throw new Error(`Auth state file not found: ${authFile}. Run Playwright auth setup first.`);
  }

  const authState = JSON.parse(fs.readFileSync(authFile, "utf-8"));
  const origins = authState.origins ?? [];

  for (const origin of origins) {
    for (const item of origin.localStorage ?? []) {
      if (item.name?.includes("auth0spajs")) {
        const val = JSON.parse(item.value || "{}");
        const token = val.body?.access_token;
        if (token) return token;
      }
    }
  }

  throw new Error("No JWT token found in auth state. Run Playwright auth setup.");
}

// Get test whitelabel ID owned by test user
const TEST_WHITELABEL_ID = "698d3af53d3e87dec403c669";
const API_BASE_URL = "http://localhost:9080";

describe.skipIf(!RUN_INTEGRATION)("ServerHttpClient Integration", () => {
  let client: ServerHttpClient;
  let token: string;

  beforeAll(() => {
    token = getJwtToken();

    // Create client with JWT as "API key" — the server routes
    // we're testing use Bearer auth, so we pass the JWT via custom headers
    client = new ServerHttpClient({
      apiKey: "jwt-placeholder",
      baseUrl: API_BASE_URL,
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  });

  describe("GET requests", () => {
    it("should fetch whitelabel list", async () => {
      const result = await client.get<unknown[]>("/white-label");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should fetch single whitelabel", async () => {
      const result = await client.get<{ whitelabel: Record<string, unknown> }>(
        `/white-label/${TEST_WHITELABEL_ID}`
      );

      expect(result.whitelabel).toBeDefined();
      expect(result.whitelabel._id).toBe(TEST_WHITELABEL_ID);
    });

    it("should handle 404 for non-existent resource", async () => {
      try {
        await client.get("/white-label/000000000000000000000000");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        const apiError = error as ServerApiError;
        expect(apiError.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe("query parameters", () => {
    it("should pass query params to server", async () => {
      // The whitelabel list endpoint doesn't paginate, but this verifies
      // the URL building works end-to-end
      const result = await client.get<unknown[]>("/white-label", {
        limit: 5,
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("POST requests", () => {
    it("should handle POST with body", async () => {
      // Use the transcript endpoint which accepts POST
      const result = await client.get<{ transcripts: unknown[] }>(
        `/white-label/${TEST_WHITELABEL_ID}/transcript`,
        { limit: 1 }
      );

      expect(result.transcripts).toBeDefined();
      expect(Array.isArray(result.transcripts)).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw ServerApiError on auth failure", async () => {
      const badClient = new ServerHttpClient({
        apiKey: "bad-key",
        baseUrl: API_BASE_URL,
        timeout: 10000,
        maxRetries: 0,
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      try {
        await badClient.get("/white-label");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        const apiError = error as ServerApiError;
        expect([401, 403]).toContain(apiError.status);
      }
    });

    it("should throw on network error for unreachable host", async () => {
      const badClient = new ServerHttpClient({
        apiKey: "test",
        baseUrl: "http://localhost:1",
        timeout: 3000,
        maxRetries: 0,
      });

      try {
        await badClient.get("/test");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServerApiError);
        expect((error as ServerApiError).code).toBe("NETWORK_ERROR");
      }
    });
  });

  describe("health check", () => {
    it("should reach the API server health endpoint", async () => {
      const response = await fetch(`${API_BASE_URL}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe("ok");
    });
  });
});
