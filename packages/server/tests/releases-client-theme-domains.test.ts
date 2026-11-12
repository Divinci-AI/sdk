import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReleaseClient } from "../src/releases/index.js";
import { ServerHttpClient } from "../src/http-client.js";

/**
 * `testingDomains` and `themeOverride` were the last two fields the CLI still
 * assigned through `(updates as Record<string, unknown>)`. Both happen to be
 * forwarded correctly today — which is precisely why they needed a test: the
 * cast meant the day someone deleted a forwarding line, nothing would have
 * said so, and the symptom would have been a customer's CORS allowlist
 * quietly reverting.
 *
 * Every assertion below is written the way the voice tests are: the explicit
 * value must BEAT the stored one. Asserting the key is merely present passes
 * against the bug, because the builder carries `current.*` forward.
 */

const WL = "69995f9a7824ced78b66686c";
const RELEASE = "6a2ba698857d4d8b90fd6734";

const CURRENT = {
  _id: RELEASE,
  slug: "fuhrman-3back-gemini-embedding-2-1777862475",
  title: "Fuhrman v8",
  description: "",
  status: "available",
  assistant: { id: "6a321e600004d656159271f0", finetune: true },
  testingDomains: ["https://old.example.com"],
  themeOverride: { preset: "dark" },
};

function mockHttp(current: Record<string, unknown> = CURRENT) {
  return {
    get: vi.fn().mockResolvedValue(current),
    post: vi.fn().mockResolvedValue({ _id: RELEASE }),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

type PostCalls = { mock: { calls: [string, Record<string, unknown>][] } };
const bodyOf = (http: ServerHttpClient) =>
  (http.post as unknown as PostCalls).mock.calls[0][1];

describe("ReleaseClient.updateInWorkspace — testingDomains / themeOverride", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("lets an explicit testingDomains BEAT the stored allowlist", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      testingDomains: ["https://docs.divinci.ai"],
    });
    expect(bodyOf(http).testingDomains).toEqual(["https://docs.divinci.ai"]);
  });

  it("forwards an EMPTY testingDomains array — clearing is not the same as unset", async () => {
    // `--testing-domains ''` means "allow nothing". A truthiness check would
    // drop it and leave the old origins allowed, which is a security-relevant
    // difference rather than a cosmetic one.
    await client.updateInWorkspace(WL, RELEASE, { testingDomains: [] });
    expect(bodyOf(http).testingDomains).toEqual([]);
  });

  it("lets an explicit themeOverride BEAT the stored one", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      themeOverride: { preset: "custom", colors: { primary: "#2e7d32" } },
    });
    expect(bodyOf(http).themeOverride).toEqual({
      preset: "custom", colors: { primary: "#2e7d32" },
    });
  });

  it("forwards null to CLEAR themeOverride rather than treating it as unset", async () => {
    await client.updateInWorkspace(WL, RELEASE, { themeOverride: null });
    expect("themeOverride" in bodyOf(http)).toBe(true);
    expect(bodyOf(http).themeOverride).toBeNull();
  });

  it("preserves both when the caller names neither", async () => {
    await client.updateInWorkspace(WL, RELEASE, { name: "unchanged" });
    expect(bodyOf(http).testingDomains).toEqual(["https://old.example.com"]);
    expect(bodyOf(http).themeOverride).toEqual({ preset: "dark" });
  });

  it("THROWS on a field the route ignores, instead of silently dropping it", async () => {
    // The whole point of UNFORWARDED_UPDATE_FIELDS: the previous behaviour was
    // a 200 and no change.
    await expect(
      client.updateInWorkspace(WL, RELEASE, { authMode: "public" as never }),
    ).rejects.toThrow(/does not support: authMode/);
    // ...and it refuses BEFORE writing anything.
    expect((http.post as unknown as PostCalls).mock.calls.length).toBe(0);
  });
});
