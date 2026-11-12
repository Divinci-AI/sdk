import { describe, it, expect, vi } from "vitest";
import { ApiKeyClient } from "../src/api-keys/index.js";
import type { ServerHttpClient } from "../src/http-client.js";

/**
 * The server's rotate route answers `{ newSecretKey }`, not the `{ secret }`
 * that `ApiKeyWithSecret` promises. Callers read `.secret`, so without the
 * mapping `divinci api-key rotate` printed "undefined" AFTER the old secret had
 * already been invalidated (found 2026-09-23). The CLI's own test mocked the
 * SDK with `{ secret }`, which is why it never caught this; these tests pin
 * the SDK against the server's real response shape.
 */
function clientReturning(body: unknown) {
  const http = { post: vi.fn().mockResolvedValue(body) } as unknown as ServerHttpClient;
  return { client: new ApiKeyClient(http), http };
}

describe("ApiKeyClient.rotate", () => {
  it("maps the server's newSecretKey to secret", async () => {
    const { client, http } = clientReturning({ newSecretKey: "divinci_new" });
    const r = await client.rotate("ws1", "key1");
    expect(r.secret).toBe("divinci_new");
    expect((r as unknown as Record<string, unknown>).newSecretKey).toBeUndefined();
    expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/v1/workspaces/ws1/api-keys/key1/rotate");
  });

  it("still accepts a server that answers { secret }", async () => {
    const { client } = clientReturning({ secret: "divinci_s" });
    expect((await client.rotate("ws1", "key1")).secret).toBe("divinci_s");
  });

  it("throws instead of returning an undefined secret", async () => {
    const { client } = clientReturning({});
    await expect(client.rotate("ws1", "key1")).rejects.toThrow(/no secret/);
  });
});
