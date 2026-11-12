import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReleaseClient } from "../src/releases/index.js";
import { ServerHttpClient } from "../src/http-client.js";

/**
 * The voice half of the same defect `releases-client-skill-config.test.ts`
 * documents — found because it was still live one field over.
 *
 * `updateInWorkspace` builds its body from an explicit ALLOWLIST and carries
 * the release's CURRENT values forward. `voiceTransport`, `ttsToolOverride` and
 * `ttsVoiceOverride` were carried forward but never read from `options`, so a
 * caller's value was overwritten by the stored one. The CLI assigned
 * `--voice-transport` through `(updates as Record<string, unknown>)`, which
 * asserted the missing field away, so the flag parsed, validated, printed
 * success, and changed nothing.
 *
 * The carry-forward is what makes this invisible: the response describes a
 * release with a voiceTransport, just not the one you asked for. These tests
 * therefore assert the OVERRIDE beats the stored value, which is the exact
 * thing that was broken — asserting merely that the key is present would have
 * passed against the bug.
 *
 * Fixture values are the real staging release read on 2026-08-05:
 * `voiceTransport` unset, `browser-local` / "Daniel".
 */

const WL = "69995f9a7824ced78b66686c";
const RELEASE = "6a2ba698857d4d8b90fd6734";

/** The shape `updateInWorkspace` GETs before it merges — read from staging. */
const CURRENT_LIVE_RELEASE = {
  _id: RELEASE,
  slug: "fuhrman-3back-gemini-embedding-2-1777862475",
  title: "Fuhrman v8 + Medical Disclaimer (Embedding-2) + Gemini 3.5 Flash",
  description: "",
  status: "available",
  allowAnonymousChat: true,
  maxAnonymousChatMessages: 20,
  assistant: { id: "6a321e600004d656159271f0", finetune: true },
  ttsToolOverride: "browser-local",
  ttsVoiceOverride: "Daniel",
  // voiceTransport deliberately absent — that is how the release really is,
  // and an absent stored value is the case where a silent drop is hardest to
  // notice, because the result looks like a default rather than a stale value.
};

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

describe("ReleaseClient.updateInWorkspace — voice fields", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("forwards voiceTransport to the wire body", async () => {
    await client.updateInWorkspace(WL, RELEASE, { voiceTransport: "media-stream" });
    expect(bodyOf(http).voiceTransport).toBe("media-stream");
  });

  it("lets an explicit voiceTransport BEAT the stored one", async () => {
    // The regression: `current.voiceTransport` is spread into the body, so if
    // the option is not forwarded after it, the stored value wins silently.
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, voiceTransport: "conversation-relay" });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { voiceTransport: "media-stream" });
    expect(bodyOf(stored).voiceTransport).toBe("media-stream");
  });

  it("forwards null to CLEAR the transport, rather than treating it as unset", async () => {
    // `--clear-voice-transport` sends null. A truthiness check here would drop
    // it and leave the override in place — the opposite of what was asked.
    const stored = mockHttp({ ...CURRENT_LIVE_RELEASE, voiceTransport: "media-stream" });
    await new ReleaseClient(stored).updateInWorkspace(WL, RELEASE, { voiceTransport: null });
    expect("voiceTransport" in bodyOf(stored)).toBe(true);
    expect(bodyOf(stored).voiceTransport).toBeNull();
  });

  it("forwards a tool + voice pair", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      ttsToolOverride: "deepgram-tts",
      ttsVoiceOverride: "aura-2-draco-en",
    });
    const body = bodyOf(http);
    expect(body.ttsToolOverride).toBe("deepgram-tts");
    expect(body.ttsVoiceOverride).toBe("aura-2-draco-en");
  });

  it("lets an explicit tool + voice beat the stored browser-local/Daniel", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      ttsToolOverride: "deepgram-tts",
      ttsVoiceOverride: "aura-2-draco-en",
    });
    const body = bodyOf(http);
    expect(body.ttsToolOverride).not.toBe("browser-local");
    expect(body.ttsVoiceOverride).not.toBe("Daniel");
  });

  it("preserves the stored values when the caller names none of them", async () => {
    // Carry-forward must still work: this handler overwrites unset fields, so
    // omitting the keys entirely would wipe the release's voice config.
    await client.updateInWorkspace(WL, RELEASE, { name: "unchanged" });
    const body = bodyOf(http);
    expect(body.ttsToolOverride).toBe("browser-local");
    expect(body.ttsVoiceOverride).toBe("Daniel");
    expect("voiceTransport" in body).toBe(false);
  });
});
