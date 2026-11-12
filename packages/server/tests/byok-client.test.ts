/**
 * BYOKClient: the endpoint probe and the openai-compatible fields go to the
 * OAuth route the web UI uses (/white-label/:id/tools/byok/keys).
 */
import { describe, it, expect, vi } from "vitest";
import { BYOKClient } from "../src/byok/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function mockHttp() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({ ok: true, latencyMs: 5 }),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  } as unknown as ServerHttpClient;
}

const WS = "6a312a5b8ad8bd2a0833344a";

describe("BYOKClient", () => {
  it("test() POSTs to the key's /test route with an empty body", async () => {
    const http = mockHttp();
    const result = await new BYOKClient(http).test(WS, "k1");
    expect(http.post).toHaveBeenCalledWith(`/white-label/${WS}/tools/byok/keys/k1/test`, {});
    expect(result).toEqual({ ok: true, latencyMs: 5 });
  });

  it("create() passes customEndpoint and customModel through", async () => {
    const http = mockHttp();
    const body = { name: "nli", providerId: "openai-compatible", auth: { apiKey: "x" }, customEndpoint: "https://h.example.com/v1/chat/completions", customModel: "m" };
    await new BYOKClient(http).create(WS, body);
    expect(http.post).toHaveBeenCalledWith(`/white-label/${WS}/tools/byok/keys`, body);
  });
});
