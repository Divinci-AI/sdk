import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReleaseClient } from "../src/releases/index.js";
import { ServerHttpClient } from "../src/http-client.js";

/**
 * The widening of `UpdateReleaseOptions` to cover the fields that
 * `updateInWorkspace` previously PRESERVED but could not SET.
 *
 * This is the harder half of the silent-drop family. `skillConfig` and the
 * voice fields were invisible because the builder never read them from
 * `options`. These were worse: `promptModeration`, `notificationFlaggers` and
 * `deIdentification` were ALREADY in the wire body, spread in from
 * `current.*` — so the request looked complete, the response described a
 * release with a moderation config, and the config was simply the stored one.
 * A caller had no way to tell their value had been discarded.
 *
 * The fix is ordering: the `options.*` spreads sit AFTER the `current.*`
 * carry-forwards, so a supplied value wins. Every assertion here therefore
 * checks that an explicit value BEATS a different stored one — asserting only
 * that the key is present would pass against the bug.
 *
 * Both release update routes share `castDraftBody`, so each field below works
 * on a draft and on a published release alike.
 */

const WL = "6a321d7a0004d6561592719b";
const RELEASE = "6a321d7a0004d6561592719e";

/** A release whose stored config differs from everything the tests send. */
const CURRENT_LIVE_RELEASE = {
  _id: RELEASE,
  slug: "default-1592719b",
  title: "Dr. Fuhrman AI",
  description: "stored description",
  status: "available",
  allowAnonymousChat: true,
  maxAnonymousChatMessages: 20,
  assistant: { id: "stored-assistant", finetune: true },
  promptModeration: {
    noHarmful: { on: true, title: "stored", allowedCategories: ["S6"] },
    onTopic: { title: "stored", minimumTokens: 0, minimumContext: 0 },
    custom: [],
  },
  notificationFlaggers: { custom: [], helpRequests: { enabled: false } },
  deIdentification: { enabled: false, engine: "presidio", strategy: "redact" },
};

function mockHttp(current: Record<string, unknown> = CURRENT_LIVE_RELEASE) {
  return {
    get: vi.fn().mockResolvedValue(current),
    post: vi.fn().mockResolvedValue({ _id: RELEASE }),
    put: vi.fn(),
    patch: vi.fn().mockResolvedValue({ _id: "sub_doc_id" }),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

type PostCalls = { mock: { calls: [string, Record<string, unknown>][] } };
/** The release-update body is the LAST post: prompt-ref sub-docs post first. */
const bodyOf = (http: ServerHttpClient) => {
  const calls = (http.post as unknown as PostCalls).mock.calls;
  return calls[calls.length - 1][1];
};

describe("updateInWorkspace — Safety fields beat the stored config", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("lets an explicit promptModeration beat the carried-forward one", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      promptModeration: {
        noHarmful: { on: false, title: "mine", allowedCategories: ["S5"] },
        onTopic: { title: "mine", minimumTokens: 10, minimumContext: 1 },
        custom: [{ id: "mod_1", title: "Competitors" }],
      },
    });
    const sent = bodyOf(http).promptModeration as typeof CURRENT_LIVE_RELEASE.promptModeration;
    expect(sent.noHarmful.title).toBe("mine");
    expect(sent.noHarmful.on).toBe(false);
    expect(sent.onTopic.minimumContext).toBe(1);
  });

  it("carries the harm-category waiver through verbatim", async () => {
    // Omitting allowedCategories server-side DROPS the waiver, so the client
    // must not lose it in transit either — an assistant that silently resumes
    // refusing its own domain is the symptom, and it appears much later.
    await client.updateInWorkspace(WL, RELEASE, {
      promptModeration: {
        noHarmful: { on: true, title: "t", allowedCategories: ["S6", "S13"] },
        onTopic: { title: "t", minimumTokens: 0, minimumContext: 0 },
        custom: [],
      },
    });
    const sent = bodyOf(http).promptModeration as typeof CURRENT_LIVE_RELEASE.promptModeration;
    expect(sent.noHarmful.allowedCategories).toEqual(["S6", "S13"]);
  });

  it("lets an explicit deIdentification beat the stored disabled one", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      deIdentification: {
        enabled: true,
        engine: "presidio",
        strategy: "redact",
        piiCategories: ["PERSON", "US_SSN"],
      },
    });
    const sent = bodyOf(http).deIdentification as { enabled: boolean; piiCategories: string[] };
    expect(sent.enabled).toBe(true);
    expect(sent.piiCategories).toEqual(["PERSON", "US_SSN"]);
  });

  it("lets an explicit notificationFlaggers beat the stored one", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      notificationFlaggers: {
        custom: [{ id: "flag_1", title: "Escalate" }],
        helpRequests: { enabled: true },
      },
    });
    const sent = bodyOf(http).notificationFlaggers as NotificationFlaggersShape;
    expect(sent.helpRequests.enabled).toBe(true);
    expect(sent.custom).toHaveLength(1);
  });

  it("still preserves all three when the caller names none", async () => {
    await client.updateInWorkspace(WL, RELEASE, { name: "unchanged" });
    const body = bodyOf(http);
    expect((body.promptModeration as { noHarmful: { title: string } }).noHarmful.title).toBe("stored");
    expect(body.deIdentification).toEqual(CURRENT_LIVE_RELEASE.deIdentification);
    expect(body.notificationFlaggers).toEqual(CURRENT_LIVE_RELEASE.notificationFlaggers);
  });
});

type NotificationFlaggersShape = { custom: unknown[]; helpRequests: { enabled: boolean } };

describe("updateInWorkspace — the rest of the widened surface", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("forwards supportedLanguages", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      supportedLanguages: { mode: "custom", codes: ["en", "es"] },
    });
    expect(bodyOf(http).supportedLanguages).toEqual({ mode: "custom", codes: ["en", "es"] });
  });

  it("lets an explicit assistant beat the stored model", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      assistant: { id: "gemini-3-5-flash", finetune: false },
    });
    const sent = bodyOf(http).assistant as { id: string };
    expect(sent.id).toBe("gemini-3-5-flash");
    expect(sent.id).not.toBe("stored-assistant");
  });

  it("renames requireRagContext to the wire key showRagContextTags", async () => {
    // The release field and the wire key differ. Sending the release spelling
    // would be silently ignored by the cast.
    await client.updateInWorkspace(WL, RELEASE, { requireRagContext: true });
    const body = bodyOf(http);
    expect(body.showRagContextTags).toBe(true);
    expect("requireRagContext" in body).toBe(false);
  });

  it("forwards the RAG presentation + ranking knobs", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      ragContextDisplayMode: "title",
      ragRecency: { enabled: true, weight: 0.5, halfLifeDays: 90 },
      ragVectorGroupId: "grp_abc",
    });
    const body = bodyOf(http);
    expect(body.ragContextDisplayMode).toBe("title");
    expect(body.ragRecency).toEqual({ enabled: true, weight: 0.5, halfLifeDays: 90 });
    expect(body.ragVectorGroupId).toBe("grp_abc");
  });

  it("forwards siteControl, which had NO other typed path", async () => {
    // siteControl appeared in neither the SDK nor the CLI before this, so the
    // API body was the only way to set it.
    await client.updateInWorkspace(WL, RELEASE, {
      siteControl: { enabled: true, allowedCategories: ["navigation"] },
    });
    expect(bodyOf(http).siteControl).toEqual({
      enabled: true,
      allowedCategories: ["navigation"],
    });
  });

  it("forwards responseTypeConfigOverride, including null to clear it", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      responseTypeConfigOverride: { preset: "text-only", enforcement: "strict" },
    });
    expect(bodyOf(http).responseTypeConfigOverride).toEqual({
      preset: "text-only", enforcement: "strict",
    });

    vi.clearAllMocks();
    const h2 = mockHttp();
    await new ReleaseClient(h2).updateInWorkspace(WL, RELEASE, {
      responseTypeConfigOverride: null,
    });
    expect("responseTypeConfigOverride" in bodyOf(h2)).toBe(true);
    expect(bodyOf(h2).responseTypeConfigOverride).toBeNull();
  });

  it("forwards spendCapCentsPerDay, including 0", async () => {
    // 0 is falsy and meaningful; a truthiness check would drop it.
    await client.updateInWorkspace(WL, RELEASE, { spendCapCentsPerDay: 0 });
    expect("spendCapCentsPerDay" in bodyOf(http)).toBe(true);
    expect(bodyOf(http).spendCapCentsPerDay).toBe(0);
  });

  it("forwards the pipeline ids and the rewrite knobs", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      outputPipelineId: "pipe_1",
      productOutputPipelineId: "pipe_2",
      styleRewriteEnabled: true,
      streamRewritePolicy: "buffer-rewrite",
    });
    const body = bodyOf(http);
    expect(body.outputPipelineId).toBe("pipe_1");
    expect(body.productOutputPipelineId).toBe("pipe_2");
    expect(body.styleRewriteEnabled).toBe(true);
    expect(body.streamRewritePolicy).toBe("buffer-rewrite");
  });

  it("forwards ttsConfigOverride alongside the tool + voice pair", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      ttsToolOverride: "deepgram-tts",
      ttsVoiceOverride: "aura-2-draco-en",
      ttsConfigOverride: { streamingEnabled: true, maxTextLength: 4000 },
    });
    expect(bodyOf(http).ttsConfigOverride).toEqual({
      streamingEnabled: true, maxTextLength: 4000,
    });
  });
});

describe("updateInWorkspace — nested retrieval fields beat the stored config", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => {
    http = mockHttp({
      ...CURRENT_LIVE_RELEASE,
      hybridSearchConfig: { bm25: { enabled: false } },
      retrievalRouting: { enabled: false, mode: "fixed", fixedStrategy: "vector" },
      crossReleaseRouting: { enabled: false, mode: "suggest" },
    });
    client = new ReleaseClient(http);
  });
  afterEach(() => vi.clearAllMocks());

  it("forwards hybridSearchConfig from options (not only the stored value)", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      hybridSearchConfig: {
        bm25: { enabled: true, topK: 20 },
        rrf: { enabled: true, k: 60 },
      },
    });
    expect(bodyOf(http).hybridSearchConfig).toEqual({
      bm25: { enabled: true, topK: 20 },
      rrf: { enabled: true, k: 60 },
    });
  });

  it("forwards retrievalRouting and allows null to clear", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      retrievalRouting: {
        enabled: true,
        mode: "auto",
        allowEndUserOverride: false,
      },
    });
    expect(bodyOf(http).retrievalRouting).toEqual({
      enabled: true,
      mode: "auto",
      allowEndUserOverride: false,
    });

    vi.clearAllMocks();
    const h2 = mockHttp({
      ...CURRENT_LIVE_RELEASE,
      retrievalRouting: { enabled: true, mode: "auto" },
    });
    await new ReleaseClient(h2).updateInWorkspace(WL, RELEASE, {
      retrievalRouting: null,
    });
    expect("retrievalRouting" in bodyOf(h2)).toBe(true);
    expect(bodyOf(h2).retrievalRouting).toBeNull();
  });

  it("forwards crossReleaseRouting and allows null to clear", async () => {
    await client.updateInWorkspace(WL, RELEASE, {
      crossReleaseRouting: {
        enabled: true,
        mode: "auto",
        minConfidence: 0.7,
        allowlist: ["rel_a", "rel_b"],
      },
    });
    expect(bodyOf(http).crossReleaseRouting).toEqual({
      enabled: true,
      mode: "auto",
      minConfidence: 0.7,
      allowlist: ["rel_a", "rel_b"],
    });

    vi.clearAllMocks();
    const h2 = mockHttp({
      ...CURRENT_LIVE_RELEASE,
      crossReleaseRouting: { enabled: true, mode: "suggest" },
    });
    await new ReleaseClient(h2).updateInWorkspace(WL, RELEASE, {
      crossReleaseRouting: null,
    });
    expect(bodyOf(h2).crossReleaseRouting).toBeNull();
  });
});

describe("updateInWorkspace — msgPrefix is a sub-document, not a string field", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: ReleaseClient;
  beforeEach(() => { http = mockHttp(); client = new ReleaseClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("POSTs a message-prefix sub-doc and references its id", async () => {
    const h = mockHttp();
    (h.post as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ _id: "mp_new" });
    await new ReleaseClient(h).updateInWorkspace(WL, RELEASE, {
      msgPrefix: "Always answer in bullet points.",
    });

    const calls = (h.post as unknown as PostCalls).mock.calls;
    const subDoc = calls.find(([url]) => url.includes("/message-prefix"));
    expect(subDoc, "expected a POST to the message-prefix endpoint").toBeTruthy();
    expect(bodyOf(h).msgPrefix).toEqual({ id: "mp_new" });
  });

  it("sends `prefix` as a STRING, not an array", async () => {
    // thread-prefix casts prefix as string[] and message-prefix casts it as a
    // plain string. Mirroring thread-prefix here — the natural thing to do —
    // is a 400 from a route that looks identical.
    const h = mockHttp();
    (h.post as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ _id: "mp_new" });
    await new ReleaseClient(h).updateInWorkspace(WL, RELEASE, { msgPrefix: "Be terse." });

    const calls = (h.post as unknown as PostCalls).mock.calls;
    const [, body] = calls.find(([url]) => url.includes("/message-prefix"))!;
    expect(body.prefix).toBe("Be terse.");
    expect(Array.isArray(body.prefix)).toBe(false);
  });

  it("PATCHes the existing sub-doc instead of orphaning a new one", async () => {
    // Editing in place is what preserves versionHistory; a fresh POST on every
    // call would leave a trail of history-less documents.
    const h = mockHttp({ ...CURRENT_LIVE_RELEASE, msgPrefix: { id: "mp_existing" } });
    await new ReleaseClient(h).updateInWorkspace(WL, RELEASE, { msgPrefix: "Updated." });

    const patches = (h.patch as unknown as PostCalls).mock.calls;
    expect(patches.some(([url]) => url.includes("/message-prefix/mp_existing"))).toBe(true);
    const posts = (h.post as unknown as PostCalls).mock.calls;
    expect(posts.some(([url]) => url.includes("/message-prefix"))).toBe(false);
  });
});
