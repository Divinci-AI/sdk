/**
 * Release types
 */

import type { ObjectId, ResourceMetadata } from "./common.js";

/**
 * Release status
 */
export type ReleaseStatus = "draft" | "active" | "archived";

/**
 * Release authentication mode
 */
export type ReleaseAuthMode = "anonymous" | "required" | "optional";

/**
 * A reference to an AI model assistant on a release — the same shape used for
 * the primary `assistant` and each entry of the `fallbackAssistants` chain.
 */
export interface WhiteLabelReleaseAssistant {
  /** Assistant / model id (matches a catalog model id). */
  id: string;
  /** Whether `id` refers to a fine-tuned model rather than a base model. */
  finetune: boolean;
}

/**
 * A whitelabel release (deployment configuration)
 */
export interface Release {
  /** Release ID (normalized from `_id` by the SDK) */
  id: ObjectId;
  /**
   * Release title (wire field name is `title`).
   * @deprecated Use `title` — the API wire sends `title`, not `name`.
   * The client SDK normalizes `title` → `name` for backwards compatibility.
   */
  name?: string;
  /** Release title (wire field name) */
  title: string;
  /** Release status */
  status: ReleaseStatus;
  /**
   * Workspace ID (declared). Wire sends `whitelabel` (the raw ObjectId string).
   * @deprecated Use `whitelabel` — present on wire; `workspaceId` is an alias.
   */
  workspaceId?: ObjectId;
  /** Workspace ID as returned by wire (same value as `workspaceId`) */
  whitelabel?: string;
  /** URL-safe release slug */
  slug?: string;
  /** Release description */
  description?: string;
  /** Category tag */
  category?: string;
  /**
   * Authentication mode. Not always present on wire; use `allowAnonymousChat`
   * for anonymous-access gating.
   */
  authMode?: ReleaseAuthMode;
  /** Primary AI model assistant for this release */
  assistant?: WhiteLabelReleaseAssistant;
  /**
   * Ordered fallback model chain. When the primary model returns a retryable
   * failure (provider 429 / capacity / 5xx / timeout), generation retries with
   * these models in order — first success wins. Absent/empty = no fallback.
   */
  fallbackAssistants?: WhiteLabelReleaseAssistant[];
  /** Release configuration (not always present on ux routes) */
  config?: ReleaseConfig;
  /** Theme configuration */
  theme?: ReleaseTheme;
  /** Allowed origins for CORS */
  allowedOrigins?: string[];
  /** RAG vector index IDs attached to this release */
  ragIndexes?: string[];
  /** Whether anonymous chat is permitted */
  allowAnonymousChat?: boolean;
  /** Max messages per anonymous chat session */
  maxAnonymousChatMessages?: number;
  /** Whether the release can reply (not pinned/paused) */
  canReply?: boolean;
  /** Whether a server-signed HMAC is required on anonymous-chat requests */
  requireSignedAnonymousChat?: boolean;
  /** Whether this release is pinned to the workspace homepage */
  pinned?: boolean;
  /** MCP server exposure for this release (see ReleaseMcpConfig) */
  mcpConfig?: ReleaseMcpConfig;
  /** Resource metadata (present on server-SDK routes) */
  metadata?: ResourceMetadata;
}

/**
 * MCP server exposure for a release. When `enabled`, the release is served
 * as its own MCP server at `https://mcp.divinci.app/{whitelabelId}/mcp`.
 * Mirrors WhiteLabelReleaseMcpConfig in @divinci-ai/models.
 */
export interface ReleaseMcpConfig {
  /** Whether MCP access is enabled for this release */
  enabled: boolean;
  /** Which tools to expose via MCP (empty/unset = all release tools) */
  exposedTools?: string[];
  /** Allowed MCP scopes (subset of platform scopes) */
  allowedScopes?: string[];
  /** Rate limits specific to MCP access */
  mcpRateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  /** Whether anonymous MCP access is allowed */
  allowAnonymousMcp?: boolean;
  /** Maximum spend per token in cents (billing safety cap) */
  maxSpendPerTokenCents?: number;
}

/**
 * Release configuration
 */
export interface ReleaseConfig {
  /** AI model to use */
  model?: string;
  /** System prompt */
  systemPrompt?: string;
  /** Max tokens per response */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** RAG collection IDs to use */
  ragCollectionIds?: ObjectId[];
  /** Enable context bubbles */
  contextBubbles?: boolean;
  /** Enable product recommendations */
  productRecommendations?: boolean;
  /** Enable help requests */
  helpRequests?: boolean;
  /** Enable notifications */
  notifications?: boolean;
  /** Enable metrics tracking */
  metrics?: boolean;
  /** Welcome message */
  welcomeMessage?: string;
  /** Chat disclaimer */
  chatDisclaimer?: string;
  /** Conversation starters */
  conversationStarters?: string[];
  /**
   * BYOK record ID. If set, inference for this release routes through the
   * referenced BYOK provider (currently only `kind: "openai-compatible"`)
   * instead of the platform default. The release stays workspace-scoped;
   * the BYOK record must belong to the same workspace.
   *
   * Phase 3 of the as-above-so-below-rts SDK integration. See
   * strategy/implementation/2026-05-05-phase3-byok-openai-compatible.md
   */
  byokId?: ObjectId;
}

/**
 * Release theme configuration
 */
/**
 * Per-release theme override. Mirrors ThemeConfig in @divinci-ai/models.
 * When set on a release (UpdateReleaseOptions.themeOverride) it takes priority
 * over the workspace (whitelabel) theme for that release. Color values must be
 * safe CSS colors (hex or rgb/rgba) — the server (castThemeOverride) rejects
 * anything else. `preset` is the only required field.
 */
export interface ReleaseThemeConfig {
  /** Preset name. "custom" enables the `colors` overrides. */
  preset:
    | "default" | "dark" | "light" | "high-contrast"
    | "ocean" | "forest" | "sunset" | "midnight" | "custom";
  /** Optional theme metadata. */
  name?: string;
  subtitle?: string;
  description?: string;
  quote?: string;
  /** Color overrides (chiefly applied when preset === "custom"). Hex/rgba only. */
  colors?: {
    primaryDark?: string;
    primary?: string;
    primaryLight?: string;
    accent?: string;
    backgroundStart?: string;
    backgroundMid?: string;
    backgroundEnd?: string;
    chatBgStart?: string;
    chatBgEnd?: string;
    buttonBg?: string;
    buttonText?: string;
    aiMessageBg?: string;
    userMessageBg?: string;
  };
  /** Web-safe font overrides. */
  fonts?: {
    heading?: string;
    body?: string;
    code?: string;
  };
  /** Dark-mode preference. */
  darkMode?: "auto" | "light" | "dark";
}

export interface ReleaseTheme {
  /** Primary color (hex) */
  primaryColor?: string;
  /** Secondary color (hex) */
  secondaryColor?: string;
  /** Background color (hex) */
  backgroundColor?: string;
  /** Text color (hex) */
  textColor?: string;
  /** Font family */
  fontFamily?: string;
  /** Logo URL */
  logoUrl?: string;
  /** Favicon URL */
  faviconUrl?: string;
  /** Dark mode enabled */
  darkMode?: boolean;
  /** Custom CSS */
  customCss?: string;
}

/**
 * Options for creating a release
 */
export interface CreateReleaseOptions {
  /** Release name */
  name: string;
  /** Workspace ID */
  workspaceId: ObjectId;
  /** Authentication mode */
  authMode?: ReleaseAuthMode;
  /** Release configuration */
  config?: Partial<ReleaseConfig>;
  /** Theme configuration */
  theme?: Partial<ReleaseTheme>;
  /**
   * Per-release theme override (priority over the workspace theme for this
   * release). `null` clears the override (inherit workspace theme); an object
   * sets it. Server-validated by castThemeOverride. Draft-only, like other
   * release config.
   */
  themeOverride?: ReleaseThemeConfig | null;
  /** Allowed origins */
  allowedOrigins?: string[];
  /** Ordered fallback model chain (see Release.fallbackAssistants). */
  fallbackAssistants?: WhiteLabelReleaseAssistant[];
}

/**
 * Vertex / Google AI Studio context caching mode for a Release.
 * See ContextCacheConfig in @divinci-ai/models for full semantics.
 */
export type ContextCacheMode = "off" | "implicit-only" | "explicit";

export interface ContextCacheUpdate {
  mode: ContextCacheMode;
  /** Hard TTL minutes for explicit caches (5-360, default 60). Ignored when adaptiveTtl=true. */
  explicitTtlMinutes?: number;
  /** Server picks TTL from rolling traffic when true. */
  adaptiveTtl?: boolean;
  /** Cache the system prompt + tools (default true when mode=explicit). */
  cacheSystemPrompt?: boolean;
  /** Cache long RAG grounding documents — Phase 4 feature. */
  cacheGroundingDocs?: boolean;
}

/**
 * Contextual call-to-action card input (stored as a referenced ChatCTA
 * sub-document). `link-out` opens `targetUrl` in a new tab; the card shows when
 * a reply contains any `triggerKeywords` (case-insensitive, first match wins).
 */
export interface ChatCTAInput {
  title: string;
  teaserText: string;
  buttonLabel?: string;
  triggerKeywords: string[];
  ctaType: "link-out" | "email-gated-download";
  active?: boolean;
  imageUrl?: string;
  /** Required for ctaType "link-out". */
  targetUrl?: string;
  /** email-gated-download (v2). */
  assetUrl?: string;
  successMessage?: string;
  crmDestination?: string;
  /**
   * Trigger cadence (all optional; defaults = keyword trigger, once per
   * thread). "interval" fires every `intervalMessages` assistant replies
   * regardless of content; "keywords-or-interval" fires on either.
   */
  triggerMode?: "keywords" | "interval" | "keywords-or-interval";
  /** Fire on every Nth assistant reply (1-100). Required for interval modes. */
  intervalMessages?: number;
  /** Don't fire before the Nth assistant reply (1-based). */
  minMessagesBeforeFirst?: number;
  /** Max fires per conversation (default 1). */
  maxPerThread?: number;
  /** Min assistant replies between fires when maxPerThread > 1. */
  cooldownMessages?: number;
  /** Inline-form fields for email-gated-download (email always collected). */
  formFields?: Array<"email" | "name" | "phone">;
  /** Consent/disclaimer line under the inline form. */
  consentText?: string;
  /** Require a Turnstile solve on the inline-form submit. */
  requireCaptcha?: boolean;
  /**
   * Optional double-write: also push captured leads into the customer's OWN
   * Constant Contact list (in addition to the platform CRM ingest), so their
   * native list automation fires. `constantContactAccessToken` is write-only
   * — omit to leave the currently stored token unchanged, pass "" to clear
   * it, or a new token to set it. Never returned by GET/list calls.
   */
  constantContactListId?: string;
  constantContactAccessToken?: string;
}

/**
 * Options for updating a release
 */
/**
 * Twilio voice architecture for a release's phone calls. Mirrors
 * `VoiceTransport` in `@divinci-ai/models`; duplicated rather than imported
 * because the public SDK types package must not depend on the server models.
 */
export type VoiceTransport = "conversation-relay" | "media-stream";

export const VOICE_TRANSPORTS: ReadonlyArray<VoiceTransport> = [
  "conversation-relay",
  "media-stream",
];

/**
 * A spend window on a release pricing tier: a duration plus the spend ceiling
 * allowed within it.
 *
 * `limitNanoUSD` is a DECIMAL STRING, not a number — nano-USD exceeds the
 * precision of a JS number at real dollar amounts, so it is carried as a string
 * end to end and parsed to a bigint only at spend-enforcement time. `"-1"`
 * means unlimited.
 *
 * Mirrors `ReleasePricingWindow` in `@divinci-ai/models`; duplicated rather than
 * imported for the same reason as `VoiceTransport` — the public SDK types
 * package must not depend on the server models.
 */
export interface ReleasePricingWindow {
  /** Window duration in milliseconds (e.g. 86400000 = 1 day). */
  durationMs: number;
  /** Max spend in nano-USD as a decimal string; `"-1"` = unlimited. */
  limitNanoUSD: string;
}

/**
 * Prompt-moderation config. Every one of the three keys is REQUIRED by the
 * release routes — there is no partial update, so read the current value and
 * send the whole object back. Mirrors `PromptModerationConfig` in
 * `@divinci-ai/models`.
 */
export interface PromptModerationConfigInput {
  noHarmful: {
    on: boolean;
    title: string;
    /**
     * Llama Guard codes treated as SAFE for this release, e.g. `["S6"]` for a
     * medical or legal assistant. Only the waivable codes (S5-S8, S13) have any
     * effect; the floor (S1-S4, S9-S12) is applied at decision time and cannot
     * be waived from config.
     *
     * OMITTING this key DROPS an existing waiver and still returns 200 — the
     * cast keeps only the keys it is told about. Always send the waiver you
     * want to keep.
     */
    allowedCategories?: string[];
  };
  onTopic: { title: string; minimumTokens: number; minimumContext: number };
  /** Custom moderator references. Any output key returning true BLOCKS. */
  custom: Array<{ id: string; title: string }>;
}

/** Notification-flagger config. Flaggers notify; they never block. */
export interface NotificationFlaggerConfigInput {
  custom: Array<{ id: string; title: string }>;
  helpRequests: { enabled: boolean };
}

/**
 * De-identification config. Mirrors `DeIdentificationConfig` in
 * `@divinci-ai/models`, minus `failClosed` — the route's schema is strict and
 * rejects that key, so every release is fail-closed in practice.
 */
export interface DeIdentificationConfigInput {
  enabled: boolean;
  /** `obi-roberta` passes validation but has NO registered engine: selecting it
   *  fails every message closed. Use `presidio` or `stanford`. */
  engine: "presidio" | "stanford" | "obi-roberta";
  strategy: "replace" | "redact" | "hybrid";
  /** Empty = detect ALL categories (the safe default). */
  piiCategories?: string[];
  preserveContext?: boolean;
  /** Accepted and stored, but no code path persists the original text. */
  storeOriginal?: boolean;
  customPatterns?: Array<{ name: string; pattern: string; replacement: string }>;
}

/** Which languages the release advertises and will answer in. */
export interface SupportedLanguagesConfigInput {
  mode: "model-default" | "custom";
  /** BCP-47 codes when mode is "custom". Filtered to platform codes, and `en`
   *  is always force-included. Ignored for "model-default". */
  codes?: string[];
}

/** Whether replies may include diagrams / generated images. */
export interface ResponseTypeConfigInput {
  preset: "text-only" | "text+diagrams" | "text+images" | "text+diagrams+images" | "custom";
  /** Only read when `preset` is "custom". */
  allowedTypes?: Array<"text" | "diagram" | "image">;
  /** "advisory" = prompt guidance only; "strict" = strips disallowed content
   *  from the response after generation. */
  enforcement?: "advisory" | "strict";
}

/** Recency weighting for RAG chunk ranking (release > vector > workspace). */
export interface RagRecencyInput {
  enabled: boolean;
  /** Blend weight in (0,1]. Unset → 0.3. */
  weight?: number;
  /** Exponential-decay half-life in days, >= 1. Unset → 180. */
  halfLifeDays?: number;
}

/** Site Control — THE WALL. `deriveSiteActions` returns [] unless `enabled`. */
export interface SiteControlInput {
  enabled: boolean;
  allowedCategories?: Array<"navigation" | "query" | "mutation" | "utility">;
  allowList?: string[];
  blockList?: string[];
}

/** Per-release TTS behaviour, merged over the workspace config. */
export interface TtsConfigOverrideInput {
  cacheEnabled?: boolean;
  streamingEnabled?: boolean;
  ssmlEnabled?: boolean;
  maxTextLength?: number;
}

/**
 * A single paid, spend-based membership tier on a release. An end user pays via
 * Stripe to move up a tier, which raises their per-window spend allowance — the
 * release owner's wallet still funds inference (a window-unlock model).
 *
 * Mirrors `ReleasePricingTier` in `@divinci-ai/models`.
 */
export interface ReleasePricingTier {
  /** URL-friendly slug, unique within the release's tier array. */
  slug: string;
  /** Display name (1–100 chars). */
  name: string;
  /** Spend-based window limits — at least one. */
  windowValidations: ReleasePricingWindow[];
  /** Price in the smallest currency unit (cents). 0/absent = a free tier. */
  priceCents?: number;
  /** ISO currency code; defaults to `"usd"`. */
  currency?: string;
  /** Stripe Product id — written back by the price-sync step, not by you. */
  stripeProductId?: string;
  /** Stripe recurring Price id — written back by the price-sync step. Required
   *  before an end user can check out this tier. */
  stripePriceId?: string;
  /** Display/order index. */
  order: number;
  /** Tier a logged-in-but-unpaid user falls into. Exactly one tier should set
   *  it; the resolver falls back to the first tier when none does. */
  isDefault?: boolean;
}

export interface UpdateReleaseOptions {
  /** Release name */
  name?: string;
  /**
   * Unified tool/skill loop config for this release. Merged server-side over
   * the existing `skillConfig` (shallow), so sending only `catalogSkills`
   * leaves `enabled` / `toolCallingAssistant` intact.
   *
   * `catalogSkills` maps a WhitelabelSkill INSTANCE id (not the catalog
   * `integrationId`) to the action names it may run — `[]` means all of them.
   * The instance must be `draftState: "ready"` and owned by the same
   * whitelabel, or the release's schema validators reject the save.
   *
   * NOTE this field is typed deliberately rather than being cast in at the
   * call site: it was previously set on this options object via
   * `(updates as Record<string, unknown>)` in the CLI, and because nothing on
   * the SDK side forwarded it, `--catalog-skills` was parsed, validated, and
   * then silently dropped before the wire for the life of the flag. A cast is
   * what let a missing field look like a present one.
   */
  skillConfig?: {
    enabled?: boolean;
    maxToolIterations?: number;
    catalogSkills?: Record<string, string[]>;
    mcpSkills?: Record<string, string[]>;
    toolCallingAssistant?: { id: string };
    /** Ordered fallback chain for the tool loop — see SkillConfig in @divinci-ai/models. */
    fallbackToolCallingAssistants?: { id: string }[];
  } | null;
  /**
   * Twilio architecture for this release's phone calls.
   *
   * `"conversation-relay"` — Twilio performs STT + TTS, limited to the
   * providers Twilio integrates (Google / Amazon / ElevenLabs).
   * `"media-stream"` — Divinci receives raw μ-law audio and runs Deepgram Flux
   * STT + Deepgram Aura TTS itself. Required for a Deepgram voice, and for
   * mid-call voice switching, neither of which ConversationRelay can serve.
   * `null` clears the override so calls use the default architecture.
   *
   * Typed here for the same reason `skillConfig` is: the CLI set this through
   * `(updates as Record<string, unknown>)` and the SDK body-builder — an
   * explicit allowlist — never forwarded it, so `--voice-transport` parsed,
   * validated, and was dropped before the wire. The flag reported success and
   * the release did not change. The cast is what made a missing field look
   * present; do not reintroduce one.
   */
  voiceTransport?: VoiceTransport | null;
  /**
   * TTS tool for this release (e.g. `"deepgram-tts"`, `"browser-local"`).
   * Inherited from the white label's default when unset.
   *
   * Tool and voice belong together: `ttsVoiceOverride` is only meaningful for
   * the tool that owns it, so setting one without the other can pair a voice id
   * with a provider it does not belong to. Send both, or neither.
   */
  ttsToolOverride?: string | null;
  /**
   * Voice id for `ttsToolOverride`. On the media-stream transport this is an
   * Aura model id (`aura-2-draco-en`); anything that is not shaped like one
   * falls back to the telephony default rather than failing the call.
   */
  ttsVoiceOverride?: string | null;
  /**
   * STT (speech-to-text) tool for this release — the engine that transcribes
   * the user. `"@cf/openai/whisper-large-v3-turbo"` runs on the platform key;
   * `"@openai/whisper-1"` and `"deepgram-nova-3"` bill to your own provider key
   * and produce no transcript until that key is registered on the workspace.
   * `null` clears the override so the white label's default applies.
   *
   * Both release update routes are tri-state on this key, so omitting it leaves
   * the stored value untouched — it is forwarded from `options` only, never
   * echoed back from the GET.
   */
  sttToolOverride?: string | null;
  /**
   * Paid, spend-based membership tiers defined ON this release. A non-empty set
   * **overrides** the workspace's default tier set for this release rather than
   * extending it; `null` (or an empty array) clears it and restores the
   * workspace behaviour.
   *
   * Setting `priceCents` does not create anything at Stripe. Run the
   * `pricing-tiers/sync` route afterwards to mint the Stripe Product/Price and
   * populate `stripePriceId` — a tier without one cannot be checked out.
   */
  pricingTiers?: ReleasePricingTier[] | null;

  // ---------------------------------------------------------------------
  // Release configuration that was previously PRESERVED but not settable.
  //
  // Every field below is accepted by `castDraftBody`, which BOTH release
  // update routes share — so each works on a draft and on a published
  // release alike. They were absent from this interface, which meant the
  // SDK carried them forward untouched and offered no way to change them;
  // the dedicated per-field routes (/moderation, /deidentification,
  // /notification-flaggers) were the only path.
  // ---------------------------------------------------------------------

  /** Human-readable description. */
  description?: string;
  /** The primary assistant model. `finetune` marks a fine-tuned variant. */
  assistant?: { id: string; finetune?: boolean };

  /** Blocks messages before generation. See PromptModerationConfigInput —
   *  all three keys are required together. */
  promptModeration?: PromptModerationConfigInput;
  /** Escalates conversations to your team. Never blocks. */
  notificationFlaggers?: NotificationFlaggerConfigInput;
  /** Strips PII before storage, retrieval, moderation and generation. */
  deIdentification?: DeIdentificationConfigInput;

  /** Languages the release advertises. Unset → derived from the model, which
   *  gives an UNRECOGNISED model the ~9-language core set rather than all 36. */
  supportedLanguages?: SupportedLanguagesConfigInput;

  /**
   * System instruction re-injected before EVERY message (vs `threadPrefix`,
   * injected once at thread start). Pass a plain string: the client creates the
   * message-prefix sub-document and references it, and PATCHes the existing one
   * when the release already has it so `versionHistory` is preserved.
   *
   * It costs its tokens on every turn, so prefer `threadPrefix` for anything
   * that does not genuinely decay over a long conversation.
   */
  msgPrefix?: string;
  /** Per-release active-status overrides for globally-managed welcome messages
   *  — the mechanism for A/B testing welcome copy without duplicating it. */
  chatWelcomeMessageOverrides?: Array<{ messageId: string; active: boolean }>;
  /** Whether replies may include diagrams / images. */
  responseTypeConfigOverride?: ResponseTypeConfigInput | null;

  /** Recency weighting for RAG ranking. */
  ragRecency?: RagRecencyInput;
  /** How source citations render: `full` (title + hover preview), `title`, or
   *  `hidden`. Presentation only — it does not change what was retrieved. */
  ragContextDisplayMode?: "hidden" | "title" | "full";
  /** Require RAG context for a reply (sent as `showRagContextTags`). */
  requireRagContext?: boolean;
  /** Attach a saved vector GROUP instead of individual `ragIndexes`. The two are
   *  mutually exclusive — setting a group disables the individual list. */
  ragVectorGroupId?: string | null;
  /** Pipeline id for the RAG output workflow. */
  outputPipelineId?: string | null;
  /** Pipeline id for the product-recommendation workflow. */
  productOutputPipelineId?: string | null;

  /** Navigate / submit forms on the embedded customer site. Off is the default,
   *  and `enabled` is the authorization wall over the crawl-derived manifest. */
  siteControl?: SiteControlInput;

  /** Daily spend backstop in cents, checked before escrow. Unset → uncapped. */
  spendCapCentsPerDay?: number;

  /** Per-release TTS behaviour, merged over the workspace config. */
  ttsConfigOverride?: TtsConfigOverrideInput | null;

  /** Post-generation style rewriting of the assistant's reply. */
  styleRewriteEnabled?: boolean;
  /** How a rewritten reply reaches the client while streaming. */
  streamRewritePolicy?: "stream-then-correct" | "buffer-rewrite";

  /**
   * BM25 + vector hybrid retrieval (and content-chunk hybrid). Shape mirrors
   * `castOptionalHybridSearchConfig` on the release update routes — nested
   * objects are validated there, not re-mirrored as deep Zod here (avoids
   * silent drift between SDK and server casters).
   *
   * Note: the server caster treats a falsy value as "no change" (null does
   * **not** clear hybrid search — omit the key to leave it alone).
   */
  hybridSearchConfig?: {
    bm25?: { enabled?: boolean; topK?: number; boost?: number; minScore?: number };
    rrf?: { enabled?: boolean; k?: number; exactMatchBoost?: number };
    contentBM25?: { enabled?: boolean; topK?: number; boost?: number; minScore?: number };
    contentRrf?: { enabled?: boolean; k?: number; exactMatchBoost?: number };
    enableIntentDetection?: boolean;
    libraryComponents?: {
      bm25ComponentId?: string;
      rrfComponentId?: string;
      rerankerComponentId?: string;
    };
  };
  /**
   * Dimension A: which retrieval strategy this release uses. `null` clears.
   * `fixedStrategy` is only meaningful when `mode` is `"fixed"`.
   */
  retrievalRouting?: {
    enabled?: boolean;
    mode?: "auto" | "fixed";
    fixedStrategy?: "vector" | "hybrid" | "pageindex" | "none";
    allowEndUserOverride?: boolean;
  } | null;
  /**
   * Dimension B: route questions across releases. `null` clears.
   * `allowlist` is release ids this one may hand off to.
   */
  crossReleaseRouting?: {
    enabled?: boolean;
    mode?: "suggest" | "auto";
    minConfidence?: number;
    allowlist?: string[];
  } | null;

  /** Release status */
  status?: ReleaseStatus;
  /** Authentication mode */
  authMode?: ReleaseAuthMode;
  /** Release configuration */
  config?: Partial<ReleaseConfig>;
  /** Theme configuration */
  theme?: Partial<ReleaseTheme>;
  /**
   * Per-release theme override (priority over the workspace theme for this
   * release). `null` clears the override (inherit workspace theme); an object
   * sets it. Server-validated by castThemeOverride. Draft-only, like other
   * release config.
   */
  themeOverride?: ReleaseThemeConfig | null;
  /** Allowed origins */
  allowedOrigins?: string[];
  /** Vertex context caching toggle. */
  contextCache?: ContextCacheUpdate;
  /** Ordered fallback model chain (see Release.fallbackAssistants). */
  fallbackAssistants?: WhiteLabelReleaseAssistant[];
  /**
   * Require a valid landing-page HMAC signature on anonymous-chat requests
   * for this release (see public-api verify-landing-page-hmac middleware).
   */
  requireSignedAnonymousChat?: boolean;
  /** Whether anonymous (no-login) chat is permitted for this release. */
  allowAnonymousChat?: boolean;
  /** Max messages per anonymous chat session. */
  maxAnonymousChatMessages?: number;
  /** MCP server exposure for this release (see ReleaseMcpConfig). */
  mcpConfig?: ReleaseMcpConfig;
  /** RAG vector indexes attached to this release (replaces the full list). */
  ragIndexes?: Array<{ id: string }>;
  /**
   * Origins whose messages do NOT count against this release's usage quota —
   * a quota EXEMPTION for staging/local builds, not an access grant and not a
   * CORS allowlist. (An earlier version of this comment described it as the
   * latter; the enforcement lives in the anonymous/membership quota middleware,
   * which uses the list solely to skip metering.)
   *
   * Accepts an exact host (`staging.example.com`), a single-label wildcard
   * (`*.dev.example.com`), or the literals `localhost` / `127.0.0.1`.
   *
   * Listing a public origin does not buy unmetered chat: the exemption applies
   * only when the request's `X-Embed-Origin` agrees with the browser's own
   * `Origin` header (which JavaScript cannot forge), a mismatch is logged as a
   * spoofing attempt and falls through to normal quota, and activations are
   * rate-limited per release+IP per hour.
   *
   * Replaces the full list. Set it before publishing — a published release is
   * locked for draft edits.
   */
  testingDomains?: string[];
  /**
   * Free-Chat Gate config for this release. `{ mode: "none" }` disables the gate
   * (open anonymous chat); `"captcha-only"` requires a Turnstile token;
   * `"captcha+otp"` / `"captcha+magic-link"` add a verification step. Replaces the
   * full gate object. Note: a non-"none" mode requires a Turnstile sitekey valid
   * for the embedding origin, so docs sites on origins outside the platform
   * Turnstile allowlist should use `"none"`.
   */
  freeChatGate?: { mode: string; [key: string]: unknown } | null;
  /**
   * Per-release cap on how many chunks survive the cross-index RAG merge-rerank
   * before reaching the LLM (per-tenant override for the global
   * RAG_RERANK_MAX_CHUNKS default). Lower = fewer prompt tokens / faster prefill,
   * at the cost of fewer grounding sources. 0 disables the trim; omit to use the
   * platform default (8).
   */
  rerankMaxChunks?: number;
  /**
   * Pre-emptive RAG gate (Tier 1). `mode: "heuristic"` skips RAG retrieval for
   * messages that don't need grounding (greetings/acks/chit-chat), saving
   * retrieval latency + prompt tokens. `mode: "always"` (default) always
   * retrieves. `minChars` (default 4) is the trimmed-length floor below which a
   * message skips; `skipPatterns` adds case-insensitive regexes on top of the
   * baked-in greeting/ack defaults. Never skips when the release requires
   * grounding (on-topic minimumContext/minimumTokens > 0).
   */
  ragTrigger?: {
    mode?: "always" | "heuristic";
    minChars?: number;
    skipPatterns?: string[];
  };
  /**
   * Cloudflare AI Gateway routing for this release. When `enabled`, gateway-
   * routable providers (Workers AI `@cf/…`, Google AI Studio Gemini) proxy
   * through the CF AI Gateway — adding gateway-level caching + observability.
   * NOTE: Vertex AI fine-tunes call Vertex directly and do NOT route through
   * the gateway. `useDefaultGateway` (default true) uses Divinci's gateway
   * (`gatewayId: "divinci-ai-gateway"`); set a `gatewayId` + `customAccountId`
   * to bring your own.
   */
  aiGateway?: {
    enabled: boolean;
    gatewayId?: string;
    useDefaultGateway?: boolean;
    useWhiteLabelDefaults?: boolean;
    customAccountId?: string;
  };
  /**
   * Response-level semantic cache. When `enabled`, a repeated/paraphrased
   * prompt reuses the cached final answer and SKIPS the LLM — ideal for fixed
   * conversation-starter prompts (sub-second, model-agnostic). `ttlSeconds`
   * bounds freshness; `similarityThreshold` (0-1) controls how close a
   * paraphrase must be to hit. `null` clears the config.
   */
  publicResponseCache?: {
    enabled: boolean;
    ttlSeconds?: number;
    similarityThreshold?: number;
  } | null;
  /**
   * Product sub-reply + inline-decoration config (replaces the global
   * PRODUCT_SUB_REPLIES_ENABLED env var). When a reply cites/mentions a catalog
   * product, the server can spawn a product sub-reply and decorate the product
   * name inline. `retroMatch` retroactively scans the reply TEXT for catalog
   * mentions even when the product chunk wasn't in the RAG context this turn;
   * `mode` picks the matching strategy. `null` clears the config.
   */
  productSubReplies?: {
    enabled?: boolean;
    retroMatch?: {
      enabled?: boolean;
      mode?: "name-mention" | "bm25-full" | "rag-candidates";
    };
    maxProducts?: number;
    matchThreshold?: number;
  } | null;
  /**
   * New system-prompt text. Stored as a referenced sub-document — passing a
   * value creates a new ThreadPrefix doc and replaces the release's
   * reference; the prior version remains in the sub-doc's history.
   */
  threadPrefix?: string;
  /**
   * New suggested-prompt conversation starters (1-3 strings). Stored as a
   * referenced sub-document; passing a value replaces the full list.
   */
  conversationStarters?: string[];
  /**
   * New chat disclaimer text. Stored as a referenced sub-document; passing a
   * value creates a new version and replaces the release's reference.
   */
  chatDisclaimer?: string;
  /**
   * New chat welcome message text. Stored as a referenced sub-document;
   * passing a value replaces the release's reference.
   */
  chatWelcomeMessage?: string;
  /**
   * Contextual call-to-action card. Stored as a referenced ChatCTA
   * sub-document; passing a value replaces the release's reference. The card
   * renders inline in chat when a reply matches its `triggerKeywords`.
   */
  chatCTA?: ChatCTAInput;
  /**
   * Versioned Terms of Service reference (the "I Agree" legal gate, separate
   * from chatDisclaimer). `null` clears the gate for this release; an object
   * sets it; omitting the field entirely leaves the existing reference
   * untouched (the server route is tri-state-safe on this field).
   */
  termsOfService?: { id: string } | null;
}

/**
 * Options for listing releases
 */
export interface ListReleasesOptions {
  /** Filter by workspace ID */
  workspaceId?: ObjectId;
  /** Filter by status */
  status?: ReleaseStatus;
  /** Limit results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}
