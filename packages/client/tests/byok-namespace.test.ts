/**
 * BYOKNamespace.test(): the endpoint probe for an openai-compatible key, on
 * the OAuth route (/white-label/:id/tools/byok/keys/:keyId/test).
 */
import { describe, it, expect, vi } from "vitest";
import { BYOKNamespace } from "../src/namespaces/index.js";

describe("BYOKNamespace", () => {
  it("test() POSTs to the key's /test route, using the bound workspace", async () => {
    const http = { post: vi.fn().mockResolvedValue({ ok: false, kind: "auth", status: 401, latencyMs: 9 }) };
    const ns = new BYOKNamespace(http as never, { workspaceId: "ws1" });
    const out = await ns.test({ keyId: "k1" });
    expect(http.post).toHaveBeenCalledWith("/white-label/ws1/tools/byok/keys/k1/test", {});
    expect(out).toEqual({ ok: false, kind: "auth", status: 401, latencyMs: 9 });
  });
});
