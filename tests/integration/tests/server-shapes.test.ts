/**
 * Server SDK ↔ live API shape oracle.
 *
 * Runs the real @divinci-ai/server client against staging and records the
 * actual wire shapes. Assertions encode what the SDK's declared types
 * promise — failures here mean the SDK (or its types) drifted from the API.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DivinciServer } from "@divinci-ai/server";
import { shouldRunIntegration, integrationConfig } from "../src/env.js";
import { record, flushReport } from "../src/shape-report.js";

/**
 * The /api/v1 layer requires a workspace API key for several routes
 * (JWT bearer gets "This endpoint requires API key authentication"), so
 * this suite only runs when DIVINCI_TEST_API_KEY is provided. Provision a
 * key for the test workspace in the dashboard (Workspace → API Keys) and
 * export it, or add it to private-keys/staging/test.env.
 */
const apiKey = process.env.DIVINCI_TEST_API_KEY;

describe.skipIf(!shouldRunIntegration || !apiKey)("server SDK shapes (staging)", () => {
  let divinci: DivinciServer;

  beforeAll(() => {
    divinci = new DivinciServer({
      apiKey: apiKey!,
      baseUrl: integrationConfig.apiBaseUrl,
      timeout: 45_000,
    });
  });

  afterAll(() => {
    console.log(`[integration] shape report: ${flushReport()}`);
  });

  it("workspaces.list() matches PaginatedResponse<Workspace> with id field", async () => {
    const result = await divinci.workspaces.list({ limit: 5 });
    record("server.workspaces.list", result);

    // Declared: PaginatedResponse — { data, hasMore }
    expect(result, "list() returned nothing").toBeTruthy();
    expect(Array.isArray(result.data), "declared PaginatedResponse.data missing").toBe(true);
    expect(result.data.length, "test user should see ≥1 workspace").toBeGreaterThan(0);

    const ws = result.data[0] as Record<string, unknown>;
    record("server.workspaces.list[0]", ws);
    // Declared: Workspace.id (ObjectId string)
    expect(typeof ws.id, "declared Workspace.id missing on wire").toBe("string");
  });

  it("workspaces.get(TEST_WHITELABEL_ID) returns the workspace", async () => {
    const ws = (await divinci.workspaces.get(
      integrationConfig.testWorkspaceId!,
    )) as unknown as Record<string, unknown>;
    record("server.workspaces.get", ws);
    expect(typeof ws.id, "declared Workspace.id missing on wire").toBe("string");
    // Wire sends `title`; SDK normalizes title→name for backwards compat
    const nameOrTitle = ws.name ?? ws.title;
    expect(typeof nameOrTitle, "declared Workspace.name/title missing on wire").toBe("string");
  });

  it("releases.list(workspaceId) matches PaginatedResponse<Release> with id field", async () => {
    const result = await divinci.releases.list(integrationConfig.testWorkspaceId!, {
      limit: 5,
    });
    record("server.releases.list", result);

    expect(Array.isArray(result.data), "declared PaginatedResponse.data missing").toBe(true);
    expect(result.data.length, "test workspace should have ≥1 release").toBeGreaterThan(0);

    const release = result.data[0] as Record<string, unknown>;
    record("server.releases.list[0]", release);
    expect(typeof release.id, "declared Release.id missing on wire").toBe("string");
    // Wire sends `title`; SDK normalizes title→name for backwards compat
    const nameOrTitle = release.name ?? release.title;
    expect(typeof nameOrTitle, "declared Release.name/title missing on wire").toBe("string");
  });
});
