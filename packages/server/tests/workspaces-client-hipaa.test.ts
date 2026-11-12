import { describe, it, expect, vi } from "vitest";
import { WorkspaceClient } from "../src/workspaces/index.js";
import type { ServerHttpClient } from "../src/http-client.js";

/**
 * HIPAA scope at workspace creation, as the SDK sees it.
 *
 * `create` already spreads its options into the body; what is pinned here is
 * that `hipaa` actually reaches the wire, that the server's `hipaa` result
 * (which carries `chatBlockedUntilVendorBaa`) is handed back to the caller, and
 * that a create WITHOUT `hipaa` is byte-for-byte what it was.
 */
const ASSENT = { versionHash: "abc", signerTitle: "Owner", organizationLegalName: "Clinic LLC" };

function clientWith(post: unknown, get: unknown = {}) {
  const http = {
    post: vi.fn().mockResolvedValue(post),
    get: vi.fn().mockResolvedValue(get),
  } as unknown as ServerHttpClient;
  return { client: new WorkspaceClient(http), http };
}

describe("WorkspaceClient.create with hipaa", () => {
  it("sends hipaa to the wire unchanged, beside title", async () => {
    const { client, http } = clientWith({ workspace: { _id: "w1", title: "Clinic", hipaaScoped: true }, created: true });
    await client.create({ name: "Clinic", description: "d", hipaa: ASSENT });

    expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      "/api/v1/workspaces",
      { title: "Clinic", description: "d", hipaa: ASSENT },
    ]);
  });

  it("hands back hipaaScoped and the server's hipaa result", async () => {
    const hipaa = { accepted: true, version: "1", versionHash: "abc", acceptedAt: 1, chatBlockedUntilVendorBaa: true };
    const { client } = clientWith({ workspace: { _id: "w1", title: "Clinic", hipaaScoped: true }, created: true, hipaa });
    const w = await client.create({ name: "Clinic", description: "d", hipaa: ASSENT });

    expect(w.id).toBe("w1");
    expect(w.hipaaScoped).toBe(true);
    expect(w.hipaa?.chatBlockedUntilVendorBaa).toBe(true);
  });

  it("without hipaa: nothing hipaa-shaped is sent or returned", async () => {
    const { client, http } = clientWith({ workspace: { _id: "w1", title: "t" }, created: true });
    const w = await client.create({ name: "t", description: "d" });

    expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ title: "t", description: "d" });
    expect(w.hipaa).toBeUndefined();
    expect(w.hipaaScoped).toBeUndefined();
  });
});

describe("WorkspaceClient.getBaaAgreement", () => {
  it("reads the workspace-independent agreement route", async () => {
    const agreement = { available: false, version: "1.0-draft", versionHash: "h", title: "BAA", content: "c" };
    const { client, http } = clientWith({}, agreement);

    expect(await client.getBaaAgreement()).toEqual(agreement);
    expect((http.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/v1/workspaces/baa-agreement");
  });
});
