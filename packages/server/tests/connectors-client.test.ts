/**
 * ConnectorsClient route-family tests
 *
 * The client talks to TWO different surfaces and picks between them by auth
 * mode. `/api/v1/connectors/*` is gated by
 * requirePermissions("connector:read" | "connector:write") and infers the
 * workspace from the API key; `/white-label/:id/connectors/*` is JWT-gated and
 * 403s an API key.
 *
 * Getting this wrong is not a visible error -- it is a `forbidden` from the
 * wrong host. Every connector command was unreachable from an API-key session
 * until 2026-09-20 because the client only ever built the whitelabel path.
 */

import { describe, it, expect, vi } from "vitest";
import { ConnectorsClient } from "../src/connectors/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function mockHttp(usesApiKey: boolean) {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    upload: vi.fn().mockResolvedValue({}),
    usesApiKey,
  } as unknown as ServerHttpClient;
}

const WS = "6a312a5b8ad8bd2a0833344a";

describe("ConnectorsClient route family", () => {
  it("uses /api/v1/connectors when authenticating with an API key", async () => {
    const http = mockHttp(true);
    await new ConnectorsClient(http).list(WS);
    expect(vi.mocked(http.get).mock.calls[0][0]).toBe("/api/v1/connectors");
  });

  it("uses the whitelabel route when authenticating with a JWT", async () => {
    const http = mockHttp(false);
    await new ConnectorsClient(http).list(WS);
    expect(vi.mocked(http.get).mock.calls[0][0]).toBe(
      `/white-label/${WS}/connectors`
    );
  });

  it("never embeds the workspace id in the API-key path", async () => {
    // v1 derives the workspace from the key. Interpolating it would 404.
    const http = mockHttp(true);
    await new ConnectorsClient(http).list(WS);
    expect(vi.mocked(http.get).mock.calls[0][0]).not.toContain(WS);
  });

  it("starts a web crawl on the v1 route under an API key", async () => {
    const http = mockHttp(true);
    await new ConnectorsClient(http).webCrawlStart(WS, {
      mode: "crawl",
      rootUrl: "https://example.com",
      targetVectorId: "vec_1",
    });
    expect(vi.mocked(http.post).mock.calls[0][0]).toBe(
      "/api/v1/connectors/web-crawl/start"
    );
  });
});

describe("ConnectorsClient whitelabel-only methods", () => {
  // v1 mounts 9 of the 11 connector sub-paths. These two are absent, so under
  // an API key they must fail by NAME rather than as an opaque 404.
  it("refresh() throws a named error under an API key", async () => {
    const http = mockHttp(true);
    await expect(new ConnectorsClient(http).refresh(WS, "wordpress")).rejects.toThrow(
      /connectors\.refresh\(\) is not available on \/api\/v1\/connectors/
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it("files() throws a named error under an API key", async () => {
    const http = mockHttp(true);
    await expect(
      new ConnectorsClient(http).files(WS, "google_drive")
    ).rejects.toThrow(/connectors\.files\(\) is not available/);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("still reaches both whitelabel-only routes under a JWT", async () => {
    const http = mockHttp(false);
    const client = new ConnectorsClient(http);
    await client.refresh(WS, "wordpress");
    await client.files(WS, "google_drive");
    expect(vi.mocked(http.post).mock.calls[0][0]).toBe(
      `/white-label/${WS}/connectors/wordpress/refresh`
    );
    expect(vi.mocked(http.get).mock.calls[0][0]).toBe(
      `/white-label/${WS}/connectors/google_drive/files`
    );
  });
});
