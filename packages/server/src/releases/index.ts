/**
 * Release Client
 *
 * Server-side release management operations
 */

import type {
  Release,
  CreateReleaseOptions,
  UpdateReleaseOptions,
  ListReleasesOptions,
  PaginatedResponse,
} from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

/**
 * Keys of `UpdateReleaseOptions` that `updateInWorkspace` deliberately does
 * NOT put on the wire, because the release update route does not read them.
 *
 * Exported so the guard test can assert this list plus the forwarded keys
 * covers the whole interface — i.e. that no field can be added to
 * `UpdateReleaseOptions` and then quietly dropped by this body-builder, which
 * is exactly how `skillConfig` and the three voice fields shipped inert.
 */
export const UNFORWARDED_UPDATE_FIELDS = [
  "allowedOrigins",
  "authMode",
  "config",
  "theme",
] as const satisfies ReadonlyArray<keyof UpdateReleaseOptions>;

/**
 * Release client for server-side operations
 */
export class ReleaseClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List releases for a workspace
   */
  async list(
    workspaceId: string,
    options: Omit<ListReleasesOptions, "workspaceId"> = {}
  ): Promise<PaginatedResponse<Release>> {
    // Mounted route is GET /api/v1/releases (api/v1/index.ts). The workspace is
    // resolved from the api-key by injectWhitelabel, not the URL — the
    // workspaceId arg is kept for API stability but not part of the path.
    void workspaceId;
    return this.httpClient.get<PaginatedResponse<Release>>(
      `/api/v1/releases`,
      {
        status: options.status,
        limit: options.limit,
        cursor: options.cursor,
      }
    );
  }

  /**
   * Get a release by ID
   */
  async get(releaseId: string): Promise<Release> {
    return this.httpClient.get<Release>(`/api/v1/releases/${releaseId}`);
  }

  /**
   * Create a new release draft.
   *
   * Routes to the consumer v1 endpoint `POST /api/v1/releases` (mounted in
   * api/v1/index.ts via mountConsumerRoute("/releases", …)). The target
   * workspace is resolved from the api-key by the injectWhitelabel middleware,
   * NOT from the URL — so the path carries no workspaceId. `options.workspaceId`
   * is still sent in the body and harmlessly ignored by castDraftBody.
   *
   * Carries `fallbackAssistants` end-to-end: createReleaseDraft forwards it to
   * the model constructor (fixed in the fallback-chain close-out).
   */
  async create(options: CreateReleaseOptions): Promise<Release> {
    return this.httpClient.post<Release>(
      `/api/v1/releases`,
      options
    );
  }

  /**
   * Update a release via the consumer v1 API (requires an api-key with
   * `release:write` permission). Use updateInWorkspace() instead when
   * authenticating with an OAuth user token — that hits the JWT-friendly
   * internal admin endpoint, which is the same one the web UI uses.
   *
   * NOTE — this is NOT a partial PATCH. The underlying handler
   * (updateReleaseDraft → castDraftBody) requires a full body and rejects with
   * "Bad assistant" if `assistant` is absent. So `update(id, { fallbackAssistants })`
   * alone will 400. To change only `fallbackAssistants` (or any single field),
   * use `updateInWorkspace()`, which GET-then-merges the full doc first. The CLI
   * already routes fallback changes through `updateInWorkspace` for this reason.
   */
  async update(releaseId: string, options: UpdateReleaseOptions): Promise<Release> {
    return this.httpClient.patch<Release>(`/api/v1/releases/${releaseId}`, options);
  }

  /**
   * Update a release through the workspace-scoped admin endpoint. Works
   * with OAuth user tokens (the same auth path the web admin UI uses).
   * Preserves existing fields by GET-then-merge — the underlying handler
   * (updateActiveRelease / updateReleaseDraft) overwrites unset config
   * fields, so partial PATCH semantics require us to round-trip the full
   * doc.
   */
  async updateInWorkspace(
    workspaceId: string, releaseId: string, options: UpdateReleaseOptions,
  ): Promise<Release>{
    // Fields the type advertises that this body-builder does NOT forward and
    // the release route does not accept. They are part of the wider Release
    // shape (they exist on `Release` and on create), so removing them from
    // `UpdateReleaseOptions` would be a breaking type change for callers who
    // are, today, getting nothing at all.
    //
    // Throwing is the point. Twice now — `--catalog-skills` and
    // `--voice-transport` — a field the caller named was dropped between the
    // options object and the wire, and BOTH reported success. A silent no-op
    // is the failure mode this whole file has been bitten by; a caller who
    // names one of these deserves to hear about it in the same second.
    const unsupported = UNFORWARDED_UPDATE_FIELDS.filter((k) => options[k] !== undefined);
    if (unsupported.length > 0) {
      throw new Error(
        `ReleaseClient.updateInWorkspace does not support: ${unsupported.join(", ")}. `
        + "The release update route ignores these fields, so sending them would "
        + "silently change nothing. Remove them from the call.",
      );
    }
    // Admin GET (not the public /white-label-release expand endpoint) so we
    // don't round-trip _expanded* fields or other read-only metadata that can
    // trigger Mongoose cast errors on save. workspaceId must be the full
    // 24-char whitelabel ObjectId (e.g. 68891c30ccac8c217d6250f1), not a
    // short alias — a truncated id makes findById throw Cast to ObjectId.
    const current = await this.httpClient.get<Record<string, unknown>>(
      `/white-label/${workspaceId}/release/${releaseId}`,
    );

    // Prompt-ref fields (threadPrefix, conversationStarters, chatDisclaimer,
    // chatWelcomeMessage) are stored on the release as `{ id }` references to
    // sub-documents, not raw strings — create the sub-doc via its own
    // endpoint, then reference its id. Mirrors the MCP `release_update`
    // tool's PROMPT_REF_FIELDS handling (workers/mcp-server/src/tools/releases.ts).
    const PROMPT_REF_FIELDS: Array<{
      value: unknown;
      endpoint: string;
      releaseField: string;
      buildBody: (v: unknown) => Record<string, unknown>;
    }> = [
      { value: options.conversationStarters, endpoint: "conversation-starter", releaseField: "conversationStarter", buildBody: (v) => ({ starters: v }) },
      { value: options.threadPrefix, endpoint: "thread-prefix", releaseField: "threadPrefix", buildBody: (v) => ({ prefix: [v] }) },
      // NOTE the shape difference from thread-prefix directly above: the
      // thread-prefix route casts `prefix` as string[], the message-prefix
      // route casts it as a plain string. Wrapping this one in an array —
      // the obvious thing to do by symmetry — is a 400.
      { value: options.msgPrefix, endpoint: "message-prefix", releaseField: "msgPrefix", buildBody: (v) => ({ prefix: v }) },
      { value: options.chatDisclaimer, endpoint: "chat-disclaimer", releaseField: "chatDisclaimer", buildBody: (v) => ({ disclaimer: v }) },
      { value: options.chatWelcomeMessage, endpoint: "chat-welcome-message", releaseField: "chatWelcomeMessage", buildBody: (v) => ({ message: v }) },
      // ChatCTA carries a full object body (not a single string), so buildBody
      // passes it through to the /chat-cta create/update endpoint verbatim.
      { value: options.chatCTA, endpoint: "chat-cta", releaseField: "chatCTA", buildBody: (v) => v as Record<string, unknown> },
    ];
    const refOverrides: Record<string, { id: string }> = {};
    for (const f of PROMPT_REF_FIELDS) {
      if (f.value === undefined) continue;
      // Reuse the release's EXISTING sub-document via PATCH when one is
      // already referenced — thread-prefix, message-prefix, and
      // chat-disclaimer's PATCH routes auto-archive the prior value into
      // versionHistory + bump version, so editing in place preserves
      // history (matching how the web admin UI edits these resources).
      // Only POST a brand-new doc the first time a field is set, so a
      // repeated `release update --thread-prefix` doesn't orphan a fresh
      // history-less document on every call.
      const existingId = (current as Record<string, { id?: string } | undefined>)[f.releaseField]?.id;
      const refRes = existingId
        ? await this.httpClient.patch<{ _id?: string; id?: string }>(
          `/white-label/${workspaceId}/${f.endpoint}/${existingId}`,
          f.buildBody(f.value),
        )
        : await this.httpClient.post<{ _id?: string; id?: string }>(
          `/white-label/${workspaceId}/${f.endpoint}`,
          f.buildBody(f.value),
        );
      const refId = refRes._id ?? refRes.id ?? existingId;
      if (!refId) {
        throw new Error(`Failed to create ${f.endpoint} sub-document — no id returned`);
      }
      refOverrides[f.releaseField] = { id: refId };
    }

    const body: Record<string, unknown> = {
      slug: current.slug,
      title: options.name ?? current.title,
      description: current.description ?? "",
      allowAnonymousChat: current.allowAnonymousChat,
      maxAnonymousChatMessages: current.maxAnonymousChatMessages,
      assistant: current.assistant,
      promptModeration: current.promptModeration,
      notificationFlaggers: current.notificationFlaggers,
      deIdentification: current.deIdentification,
      ...(current.threadPrefix !== undefined && { threadPrefix: current.threadPrefix }),
      ...(current.msgPrefix !== undefined && { msgPrefix: current.msgPrefix }),
      ...(current.conversationStarter !== undefined && { conversationStarter: current.conversationStarter }),
      ...(current.chatDisclaimer !== undefined && { chatDisclaimer: current.chatDisclaimer }),
      ...(current.chatWelcomeMessage !== undefined && { chatWelcomeMessage: current.chatWelcomeMessage }),
      ...(current.chatWelcomeMessageOverrides !== undefined && {
        chatWelcomeMessageOverrides: current.chatWelcomeMessageOverrides,
      }),
      ...((current as { chatCTA?: unknown }).chatCTA !== undefined && { chatCTA: (current as { chatCTA?: unknown }).chatCTA }),
      ...(current.ragIndex !== undefined && { ragIndex: current.ragIndex }),
      ...(current.ragIndexes !== undefined && { ragIndexes: current.ragIndexes }),
      ...(current.ragVectorGroupId !== undefined && { ragVectorGroupId: current.ragVectorGroupId }),
      ...(current.rerankMaxChunks !== undefined && { rerankMaxChunks: current.rerankMaxChunks }),
      ...(current.ragTrigger !== undefined && { ragTrigger: current.ragTrigger }),
      ...(typeof current.requireRagContext === "boolean" && {
        showRagContextTags: current.requireRagContext,
      }),
      ...(current.ragContextDisplayMode !== undefined && {
        ragContextDisplayMode: current.ragContextDisplayMode,
      }),
      ...(current.hybridSearchConfig !== undefined && { hybridSearchConfig: current.hybridSearchConfig }),
      ...(current.contextCache !== undefined && { contextCache: current.contextCache }),
      ...(current.publicResponseCache !== undefined && { publicResponseCache: current.publicResponseCache }),
      ...((current as { productSubReplies?: unknown }).productSubReplies !== undefined && { productSubReplies: (current as { productSubReplies?: unknown }).productSubReplies }),
      ...(current.aiGateway !== undefined && { aiGateway: current.aiGateway }),
      ...(current.spendCapCentsPerDay !== undefined && { spendCapCentsPerDay: current.spendCapCentsPerDay }),
      ...(current.testingDomains !== undefined && { testingDomains: current.testingDomains }),
      ...(current.mcpConfig !== undefined && { mcpConfig: current.mcpConfig }),
      ...(current.freeChatGate !== undefined && { freeChatGate: current.freeChatGate }),
      ...(current.supportedLanguages !== undefined && { supportedLanguages: current.supportedLanguages }),
      ...(current.outputPipelineId !== undefined && { outputPipelineId: current.outputPipelineId }),
      ...(current.productOutputPipelineId !== undefined && {
        productOutputPipelineId: current.productOutputPipelineId,
      }),
      ...(current.ttsToolOverride !== undefined && { ttsToolOverride: current.ttsToolOverride }),
      ...(current.ttsVoiceOverride !== undefined && { ttsVoiceOverride: current.ttsVoiceOverride }),
      ...(current.ttsConfigOverride !== undefined && { ttsConfigOverride: current.ttsConfigOverride }),
      ...(current.voiceTransport !== undefined && { voiceTransport: current.voiceTransport }),
      ...(current.themeOverride !== undefined && { themeOverride: current.themeOverride }),
      ...(current.fallbackAssistants !== undefined && { fallbackAssistants: current.fallbackAssistants }),
      ...(typeof current.requireSignedAnonymousChat === "boolean" && {
        requireSignedAnonymousChat: current.requireSignedAnonymousChat,
      }),
      ...(options.contextCache !== undefined && { contextCache: options.contextCache }),
      ...(options.fallbackAssistants !== undefined && { fallbackAssistants: options.fallbackAssistants }),
      ...(options.requireSignedAnonymousChat !== undefined && {
        requireSignedAnonymousChat: options.requireSignedAnonymousChat,
      }),
      ...(options.rerankMaxChunks !== undefined && { rerankMaxChunks: options.rerankMaxChunks }),
      ...(options.ragTrigger !== undefined && { ragTrigger: options.ragTrigger }),
      ...(options.aiGateway !== undefined && { aiGateway: options.aiGateway }),
      ...(options.publicResponseCache !== undefined && { publicResponseCache: options.publicResponseCache }),
      ...(options.productSubReplies !== undefined && { productSubReplies: options.productSubReplies }),
      ...(options.allowAnonymousChat !== undefined && { allowAnonymousChat: options.allowAnonymousChat }),
      ...(options.maxAnonymousChatMessages !== undefined && {
        maxAnonymousChatMessages: options.maxAnonymousChatMessages,
      }),
      ...(options.mcpConfig !== undefined && { mcpConfig: options.mcpConfig }),
      ...(options.ragIndexes !== undefined && { ragIndexes: options.ragIndexes }),
      ...(options.testingDomains !== undefined && { testingDomains: options.testingDomains }),
      ...(options.freeChatGate !== undefined && { freeChatGate: options.freeChatGate }),
      // Per-release theme override — options wins over the preserved current
      // value (later spread). null clears server-side (inherit workspace theme).
      ...(options.themeOverride !== undefined && { themeOverride: options.themeOverride }),
      // Prompt-ref overrides (threadPrefix, conversationStarter, chatDisclaimer,
      // chatWelcomeMessage) — newly-created sub-doc refs win over preserved current.
      ...refOverrides,
      // Terms of Service reference — NOT preserved from `current` above (the
      // route is tri-state-safe: omitting this key leaves the release's
      // existing reference untouched). Only included when the caller
      // explicitly passes a value, so `null` clears and a value sets.
      ...(options.termsOfService !== undefined && { termsOfService: options.termsOfService }),
      // Skill/tool loop config. NOT preserved from `current`: both release
      // update handlers are tri-state on this key (omitting it leaves the
      // stored skillConfig untouched, and an object is MERGED over it), so
      // echoing `current.skillConfig` back would only risk re-writing a value
      // another writer changed between our GET and our POST.
      //
      // Forwarding it at all is the fix for a silent drop: the CLI's
      // `--catalog-skills` flag has always parsed and validated its JSON, and
      // this body-builder — an explicit allowlist — had no `skillConfig` key,
      // so the flag never reached the wire. Nothing failed; the release simply
      // did not change. See the field's doc comment in @divinci-ai/types.
      ...(options.skillConfig !== undefined && { skillConfig: options.skillConfig }),
      // Voice fields, forwarded for exactly the same reason as skillConfig
      // above — and they were missing for exactly the same reason. Each is
      // carried forward from `current` further up, so WITHOUT these three lines
      // the caller's value was overwritten by the stored one and
      // `--voice-transport` / a voice change silently did nothing while
      // reporting success.
      //
      // Placed after the carry-forward spreads deliberately: later keys win, so
      // an explicitly supplied value overrides the stored one. `null` is a
      // meaningful value here (it CLEARS the override), which is why these test
      // `!== undefined` rather than truthiness.
      ...(options.voiceTransport !== undefined && { voiceTransport: options.voiceTransport }),
      ...(options.ttsToolOverride !== undefined && { ttsToolOverride: options.ttsToolOverride }),
      ...(options.ttsVoiceOverride !== undefined && { ttsVoiceOverride: options.ttsVoiceOverride }),
      // STT completes the voice pair. It was missing for the same reason its
      // TTS siblings were, and stayed missing a round longer because it is not
      // carried forward from `current` either — so unlike `ttsToolOverride`,
      // grepping the builder for the field found NOTHING at all rather than a
      // carry-forward that merely looked like support.
      //
      // Not echoed back from `current` deliberately: both release update routes
      // are tri-state on this key (omitting it leaves the stored value alone),
      // so carrying it forward would only risk re-writing a value another
      // writer changed between our GET and our POST — the same reasoning as
      // `skillConfig` above. `null` is meaningful (it CLEARS the override),
      // hence `!== undefined` rather than truthiness.
      ...(options.sttToolOverride !== undefined && { sttToolOverride: options.sttToolOverride }),
      // Pricing tiers, tri-state on both routes for the same reason, so also
      // forwarded from `options` only. `null` clears the set and restores the
      // workspace's default tiers.
      ...(options.pricingTiers !== undefined && { pricingTiers: options.pricingTiers }),

      // ---------------------------------------------------------------
      // Release configuration that used to be preserve-only.
      //
      // All of these are accepted by `castDraftBody`, which BOTH update
      // routes share, so each works on a draft and a published release
      // alike. They sit AFTER the `current.*` carry-forward spreads on
      // purpose: later keys win, so an explicitly supplied value beats the
      // stored one. That ordering is the whole fix — `promptModeration`,
      // `notificationFlaggers` and `deIdentification` were already in the
      // body via carry-forward, which is precisely why passing them did
      // nothing and looked like it had worked.
      // ---------------------------------------------------------------
      ...(options.description !== undefined && { description: options.description }),
      ...(options.assistant !== undefined && { assistant: options.assistant }),
      ...(options.promptModeration !== undefined && { promptModeration: options.promptModeration }),
      ...(options.notificationFlaggers !== undefined && { notificationFlaggers: options.notificationFlaggers }),
      ...(options.deIdentification !== undefined && { deIdentification: options.deIdentification }),
      ...(options.supportedLanguages !== undefined && { supportedLanguages: options.supportedLanguages }),
      ...(options.chatWelcomeMessageOverrides !== undefined && {
        chatWelcomeMessageOverrides: options.chatWelcomeMessageOverrides,
      }),
      ...(options.responseTypeConfigOverride !== undefined && {
        responseTypeConfigOverride: options.responseTypeConfigOverride,
      }),
      ...(options.ragRecency !== undefined && { ragRecency: options.ragRecency }),
      ...(options.ragContextDisplayMode !== undefined && {
        ragContextDisplayMode: options.ragContextDisplayMode,
      }),
      // The release field is `requireRagContext`; the wire key is
      // `showRagContextTags` (the carry-forward above performs the same
      // rename in reverse). Keep the two spellings aligned.
      ...(options.requireRagContext !== undefined && {
        showRagContextTags: options.requireRagContext,
      }),
      ...(options.ragVectorGroupId !== undefined && { ragVectorGroupId: options.ragVectorGroupId }),
      ...(options.outputPipelineId !== undefined && { outputPipelineId: options.outputPipelineId }),
      ...(options.productOutputPipelineId !== undefined && {
        productOutputPipelineId: options.productOutputPipelineId,
      }),
      ...(options.siteControl !== undefined && { siteControl: options.siteControl }),
      ...(options.spendCapCentsPerDay !== undefined && {
        spendCapCentsPerDay: options.spendCapCentsPerDay,
      }),
      ...(options.ttsConfigOverride !== undefined && { ttsConfigOverride: options.ttsConfigOverride }),
      ...(options.styleRewriteEnabled !== undefined && {
        styleRewriteEnabled: options.styleRewriteEnabled,
      }),
      ...(options.streamRewritePolicy !== undefined && {
        streamRewritePolicy: options.streamRewritePolicy,
      }),
      // Nested retrieval routing — accepted by castDraftBody; previously only
      // carried forward from `current`, so callers could not set them via the
      // SDK (same preserve-only trap as promptModeration). null clears
      // retrievalRouting / crossReleaseRouting; hybridSearchConfig has no
      // clear-via-null path on the server caster (falsy → no change).
      ...(options.hybridSearchConfig !== undefined && {
        hybridSearchConfig: options.hybridSearchConfig,
      }),
      ...(options.retrievalRouting !== undefined && {
        retrievalRouting: options.retrievalRouting,
      }),
      ...(options.crossReleaseRouting !== undefined && {
        crossReleaseRouting: options.crossReleaseRouting,
      }),
    };
    // Drafts reject the /update route with 423 ("document is locked") — they
    // have their own endpoint. Route by the status we just fetched.
    const updatePath = current.status === "draft"
      ? `/white-label/${workspaceId}/release/${releaseId}`
      : `/white-label/${workspaceId}/release/${releaseId}/update`;
    return this.httpClient.post<Release>(updatePath, body);
  }

  /**
   * Delete a release (draft)
   */
  async delete(releaseId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/releases/${releaseId}`);
  }

  /**
   * Activate a release (set status to "active")
   */
  async activate(releaseId: string): Promise<Release> {
    return this.update(releaseId, { status: "active" });
  }

  /**
   * Archive a release (set status to "archived")
   */
  async archive(releaseId: string): Promise<Release> {
    return this.update(releaseId, { status: "archived" });
  }

  /**
   * Clone a release — NOT available via the v1 consumer API.
   *
   * `api/v1/routes/releases.ts` mounts only list/create/get/update/delete +
   * publish/activate/rollback/gate; there is no clone route. Release cloning is
   * the internal "fork as draft" admin operation
   * (`POST /white-label/:workspaceId/release/:releaseId/fork-as-draft`), which
   * requires a workspace + OAuth context this consumer method doesn't carry.
   * Throws a clear error instead of issuing a request that always 404s.
   */
  async clone(releaseId: string, newName: string): Promise<Release> {
    throw new Error(
      `releases.clone() is not supported via the v1 API (no clone route). ` +
      `To clone "${releaseId}" as "${newName}", use the workspace admin fork endpoint: ` +
      `POST /white-label/:workspaceId/release/${releaseId}/fork-as-draft.`,
    );
  }

  /**
   * Get release analytics — NOT available via the v1 consumer API.
   *
   * There is no `/releases/:id/analytics` route in `api/v1/routes/releases.ts`.
   * Throws a clear error instead of issuing a request that always 404s.
   *
   * @deprecated Use `divinci.analytics` (workspace-scoped product analytics:
   * metrics / trends / experiments / funnel / trackEvents) or
   * `divinci.metrics` (pipeline telemetry + alert configs) instead.
   */
  async getAnalytics(
    releaseId: string,
    options: ReleaseAnalyticsOptions = {}
  ): Promise<ReleaseAnalytics> {
    void options;
    throw new Error(
      `releases.getAnalytics() is not available in the v1 API ` +
      `(no /releases/${releaseId}/analytics route). Use divinci.analytics ` +
      `(workspace-scoped product analytics: metrics/trends/experiments/funnel) ` +
      `or divinci.metrics (pipeline telemetry) instead.`,
    );
  }
}

/**
 * Release analytics options
 */
export interface ReleaseAnalyticsOptions {
  /** Time period */
  period?: "day" | "week" | "month";
  /** Start date (ISO string) */
  startDate?: string;
  /** End date (ISO string) */
  endDate?: string;
}

/**
 * Release analytics data
 */
export interface ReleaseAnalytics {
  /** Release ID */
  releaseId: string;
  /** Period */
  period: string;
  /** Total conversations */
  totalConversations: number;
  /** Total messages */
  totalMessages: number;
  /** Unique users */
  uniqueUsers: number;
  /** Average messages per conversation */
  avgMessagesPerConversation: number;
  /** Average response time (ms) */
  avgResponseTimeMs: number;
  /** Total tokens used */
  totalTokens: number;
  /** Daily breakdown */
  dailyBreakdown: Array<{
    date: string;
    conversations: number;
    messages: number;
    users: number;
  }>;
}
