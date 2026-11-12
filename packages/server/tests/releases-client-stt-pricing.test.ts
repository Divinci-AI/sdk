import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReleaseClient } from "../src/releases/index.js";
import { ServerHttpClient } from "../src/http-client.js";

/**
 * The last two fields of the silent-drop family documented by
 * `releases-client-skill-config.test.ts` (skillConfig) and
 * `releases-client-voice.test.ts` (the three voice fields).
 *
 * `sttToolOverride` and `pricingTiers` were a STRICTER case than either. Those
 * shipped inert because the body-builder — an explicit allowlist — carried the
 * value forward from `current` but never read it from `options`, so the stored
 * value silently beat the caller's. These two were absent from
 * `UpdateReleaseOptions` altogether, so there was no field for the allowlist to
 * forget and `releases-client-update-forwarding.test.ts` stayed green while the
 * capability simply did not exist on the SDK. The server has accepted both on
 * both release routes the whole time, symmetric with `ttsToolOverride`.
 *
 * The distinction matters for what these tests assert. The voice tests prove an
 * explicit value BEATS a stored one, because the carry-forward was the thing
 * hiding the bug. Here there is no carry-forward to beat — deliberately, since
 * both routes are tri-state on these keys — so the load-bearing assertions are
 * that the key reaches the wire at all, that `null` survives as a CLEAR rather
 * than being dropped by a truthiness check, and that omitting the field emits
 * NO key (which is what makes the tri-state route leave the stored value
 * alone).
 */

const WL = "6a321d7a0004d6561592719b";
const RELEASE = "6a321d7a0004d6561592719e";

/** The shape `updateInWorkspace` GETs before it merges. */
const CURRENT_LIVE_RELEASE = {
  _id: RELEASE,
  slug: "default-1592719b",
  title: "Dr. Fuhrman AI",
  description: "",
  status: "available",
  allowAnonymousChat: true,
  maxAnonymousChatMessages: 20,
  assistant: { id: "6a321e600004d656159271f0", finetune: true },
  // Neither key is present, which is the honest starting state for a release
  // that has never been able to set them through this client.
};

const DAY_MS = 86_400_000;
/** $1.00/day in nano-USD. A decimal STRING, never a number — see the type. */
const ONE_USD_NANO = "1000000000";

function mockHttp(current: Record<string, unknown> = CURRENT_LIVE_RELEASE) {
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

describe("ReleaseClient.updateInWorkspace — sttToolOverride", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("forwards sttToolOverride to the wire body", async () => {
    await client.updateInWorkspace(WL, RELEASE, { sttToolOverride: "deepgram-nova-3" });
    expect(bodyOf(http).sttToolOverride).toBe("deepgram-nova-3");
  });

  it("forwards the platform-key transcriber too", async () => {
    // The `@cf/...` id is the one served on Divinci's own key; a BYOK id and a
    // platform id must travel the same path, or only the paid one works.
    await client.updateInWorkspace(WL, RELEASE, {
      sttToolOverride: "@cf/openai/whisper-large-v3-turbo",
    });
    expect(bodyOf(http).sttToolOverride).toBe("@cf/openai/whisper-large-v3-turbo");
  });

  it("forwards null to CLEAR the override rather than treating it as unset", async () => {
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, sttToolOverride: "deepgram-nova-3" });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { sttToolOverride: null });
    expect("sttToolOverride" in bodyOf(stored)).toBe(true);
    expect(bodyOf(stored).sttToolOverride).toBeNull();
  });

  it("emits NO sttToolOverride key when the caller names none", async () => {
    // Both update routes assign only `if (sttToolOverride !== undefined)`, so an
    // absent key leaves the stored value untouched. Echoing `current` back would
    // re-write a value another writer may have changed since our GET.
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, sttToolOverride: "deepgram-nova-3" });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { name: "unchanged" });
    expect("sttToolOverride" in bodyOf(stored)).toBe(false);
  });

  it("carries an STT choice alongside its TTS counterpart", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      ttsToolOverride: "deepgram-tts",
      ttsVoiceOverride: "aura-2-draco-en",
      sttToolOverride: "deepgram-nova-3",
    });
    const body = bodyOf(http);
    expect(body.ttsToolOverride).toBe("deepgram-tts");
    expect(body.ttsVoiceOverride).toBe("aura-2-draco-en");
    expect(body.sttToolOverride).toBe("deepgram-nova-3");
  });
});

describe("ReleaseClient.updateInWorkspace — pricingTiers", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  const TIERS = [
    {
      slug: "free",
      name: "Free",
      order: 0,
      isDefault: true,
      windowValidations: [{ durationMs: DAY_MS, limitNanoUSD: ONE_USD_NANO }],
    },
    {
      slug: "pro",
      name: "Pro",
      order: 1,
      priceCents: 2900,
      currency: "usd",
      windowValidations: [{ durationMs: DAY_MS, limitNanoUSD: "25000000000" }],
    },
  ];

  it("forwards a tier set to the wire body", async () => {
    await client.updateInWorkspace(WL, RELEASE, { pricingTiers: TIERS });
    expect(bodyOf(http).pricingTiers).toEqual(TIERS);
  });

  it("preserves limitNanoUSD as a STRING", async () => {
    // Carried as a decimal string because nano-USD exceeds JS number precision
    // at real dollar amounts. A builder that normalised it to a number would
    // round the ceiling silently — the failure would surface as a spend cap
    // that is merely slightly wrong, which nobody reads as a bug.
    await client.updateInWorkspace(WL, RELEASE, { pricingTiers: TIERS });
    const sent = bodyOf(http).pricingTiers as typeof TIERS;
    expect(typeof sent[0].windowValidations[0].limitNanoUSD).toBe("string");
    expect(sent[0].windowValidations[0].limitNanoUSD).toBe(ONE_USD_NANO);
  });

  it("forwards an unlimited window sentinel untouched", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      pricingTiers: [{
        slug: "staff", name: "Staff", order: 0,
        windowValidations: [{ durationMs: DAY_MS, limitNanoUSD: "-1" }],
      }],
    });
    const sent = bodyOf(http).pricingTiers as typeof TIERS;
    expect(sent[0].windowValidations[0].limitNanoUSD).toBe("-1");
  });

  it("forwards null to CLEAR the set and restore workspace tiers", async () => {
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, pricingTiers: TIERS });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { pricingTiers: null });
    expect("pricingTiers" in bodyOf(stored)).toBe(true);
    expect(bodyOf(stored).pricingTiers).toBeNull();
  });

  it("forwards an empty array as a real value, not as unset", async () => {
    // `[]` is falsy-adjacent enough that a truthiness check would drop it while
    // an operator watched their tier set fail to clear.
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, pricingTiers: TIERS });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { pricingTiers: [] });
    expect("pricingTiers" in bodyOf(stored)).toBe(true);
    expect(bodyOf(stored).pricingTiers).toEqual([]);
  });

  it("emits NO pricingTiers key when the caller names none", async () => {
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, pricingTiers: TIERS });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { name: "unchanged" });
    expect("pricingTiers" in bodyOf(stored)).toBe(false);
  });

  it("does not invent Stripe ids — those are written back by the sync step", async () => {
    // A tier is not purchasable until `pricing-tiers/sync` mints the Price and
    // writes stripePriceId back. The client must not fabricate one, or a tier
    // would look checkout-ready while Stripe knows nothing about it.
    await client.updateInWorkspace(WL, RELEASE, { pricingTiers: TIERS });
    const sent = bodyOf(http).pricingTiers as Array<Record<string, unknown>>;
    expect(sent[1].stripePriceId).toBeUndefined();
    expect(sent[1].stripeProductId).toBeUndefined();
  });
});
