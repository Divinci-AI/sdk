import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import type { ContextCacheMode, UpdateReleaseOptions, ContextCacheUpdate, WhiteLabelReleaseAssistant, ChatCTAInput, ReleaseThemeConfig } from "@divinci-ai/types";
import { VOICE_TRANSPORTS } from "@divinci-ai/types";

const CONTEXT_CACHE_MODES: ContextCacheMode[] = ["off", "implicit-only", "explicit"];

const MAX_FALLBACK_ASSISTANTS = 5;

/**
 * Parse + shape-validate the --fallback-assistants JSON. Accepts a JSON array
 * of `{ id: string, finetune: boolean }`. Throws a friendly CLI error on any
 * malformed entry so the user sees the problem before the request is sent.
 */
/**
 * Parse + shape-validate the --catalog-skills JSON.
 *
 * Shape is `Record<WhitelabelSkill._id, actionName[]>` — NOT the catalog id.
 * `sms-release` is a catalog *definition*; what goes here is the id of an
 * INSTANCE of it created for this whitelabel (see `skill_create`). Passing a
 * catalog id is the most likely mistake, so it is called out explicitly rather
 * than left to a server-side "unowned skill id" rejection.
 */
/**
 * Merge --mcp-* flags onto a release's EXISTING mcpConfig.
 *
 * Exported and pure so the merge can be tested by calling it, rather than by
 * reading the handler and believing it. The property that matters is negative —
 * that setting one flag does not drop the others — and a negative property is
 * exactly what an eyeball misses.
 *
 * ⚠️ Why a merge at all: server-side `castOptionalMcpConfig` REBUILDS the
 * object from what it receives, and the SDK lets `options.mcpConfig` overwrite
 * `current.mcpConfig` wholesale. Sending `{ enabled: true }` alone would
 * therefore erase an existing exposedTools list AND an existing
 * maxSpendPerTokenCents. Silently dropping a spend cap while changing something
 * unrelated is the failure this function exists to prevent.
 *
 * Throws on incoherent input, with the fix in the message.
 */
export function mergeMcpConfig(
  existing: Record<string, unknown>,
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  if (opts.mcpEnabled !== undefined) merged.enabled = Boolean(opts.mcpEnabled);
  // `enabled` is required by the type. Carry the existing value, or make the
  // operator say so — rather than defaulting to false and quietly turning MCP
  // off as a side effect of a rate-limit change.
  if (typeof merged.enabled !== "boolean") {
    throw new Error(
      "This release has no MCP config yet — pass --mcp-enabled alongside the other --mcp-* flags.",
    );
  }

  const csv = (v: unknown) => String(v).split(",").map((x) => x.trim()).filter(Boolean);
  if (opts.mcpExposedTools !== undefined) merged.exposedTools = csv(opts.mcpExposedTools);
  if (opts.mcpAllowedScopes !== undefined) merged.allowedScopes = csv(opts.mcpAllowedScopes);

  const posInt = (flag: string, v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${flag} must be a positive integer`);
    return n;
  };
  if (opts.mcpRatePerMinute !== undefined || opts.mcpRatePerDay !== undefined) {
    const rl = (merged.mcpRateLimit ?? {}) as Record<string, unknown>;
    merged.mcpRateLimit = {
      requestsPerMinute: opts.mcpRatePerMinute !== undefined
        ? posInt("mcp-rate-per-minute", opts.mcpRatePerMinute)
        : (typeof rl.requestsPerMinute === "number" ? rl.requestsPerMinute : 60),
      requestsPerDay: opts.mcpRatePerDay !== undefined
        ? posInt("mcp-rate-per-day", opts.mcpRatePerDay)
        : (typeof rl.requestsPerDay === "number" ? rl.requestsPerDay : 10000),
    };
  }

  if (opts.mcpAllowAnonymous !== undefined) merged.allowAnonymousMcp = Boolean(opts.mcpAllowAnonymous);
  if (opts.mcpMaxSpendCents !== undefined) {
    merged.maxSpendPerTokenCents = posInt("mcp-max-spend-cents", opts.mcpMaxSpendCents);
  }

  // Mirrors the server's coherence rule, checked against the MERGED value so
  // turning anonymity on is fine when a cap already exists. Local so the
  // operator gets the reason and the fix instead of "Bad mcpConfig" — the same
  // argument as --voice-transport validating locally.
  if (merged.allowAnonymousMcp === true) {
    const cap = merged.maxSpendPerTokenCents;
    if (typeof cap !== "number" || cap <= 0) {
      throw new Error(
        "--mcp-allow-anonymous requires a positive --mcp-max-spend-cents: " +
        "anonymous MCP access without a spend cap exposes your wallet to the public.",
      );
    }
  }

  return merged;
}

export function parseCatalogSkills(raw: string): Record<string, string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('--catalog-skills must be valid JSON, e.g. \'{"<skillInstanceId>":["sendSms"]}\'');
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error('--catalog-skills must be a JSON object mapping skill instance id -> action names');
  }
  const out: Record<string, string[]> = {};
  for (const [id, actions] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(actions) || actions.some((a) => typeof a !== "string")) {
      throw new Error(`--catalog-skills: "${id}" must map to an array of action-name strings`);
    }
    if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(id) && !/^[0-9a-f]{24}$/i.test(id)) {
      throw new Error(
        `--catalog-skills: "${id}" looks like a CATALOG id, not a skill INSTANCE id. `
        + "Create an instance first (skill_create), then use its _id here.",
      );
    }
    out[id] = actions as string[];
  }
  return out;
}

/**
 * Parse + shape-validate `--assistant`, the release's PRIMARY model.
 *
 * Accepts either a bare model id (`@cf/google/gemma-4-26b-a4b-it`) or the full
 * `{"id":...,"finetune":...}` object that `--fallback-assistants` takes. The
 * bare form is the common case and defaults `finetune:false`, matching what the
 * web model-picker sends.
 *
 * WHY THIS EXISTS: `release update` could set the fallback CHAIN but not the
 * PRIMARY, so changing a release's main model meant hand-rolling a
 * GET-merge-POST against `/white-label/<wl>/release/<id>/update` — and that
 * route assigns `assistant` UNCONDITIONALLY, so a caller who forgot to echo a
 * field back would silently wipe it. The SDK has supported `options.assistant`
 * all along (@divinci-ai/types UpdateReleaseOptions); only this flag was
 * missing, which made the safe path the hard one.
 */
export function parsePrimaryAssistant(raw: string): WhiteLabelReleaseAssistant {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("--assistant must be a model id or a JSON object");
  }
  // Bare id — the common case.
  if (!trimmed.startsWith("{")) {
    return { id: trimmed, finetune: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      '--assistant must be a model id (e.g. "@cf/google/gemma-4-26b-a4b-it") '
      + 'or JSON like \'{"id":"...","finetune":false}\'',
    );
  }
  const o = parsed as Record<string, unknown>;
  if (!o || typeof o.id !== "string" || o.id.length === 0) {
    throw new Error('--assistant JSON must have a non-empty string "id"');
  }
  if (o.finetune !== undefined && typeof o.finetune !== "boolean") {
    throw new Error('--assistant "finetune" must be a boolean when present');
  }
  return { id: o.id, finetune: o.finetune === true };
}

export function parseFallbackAssistants(raw: string): WhiteLabelReleaseAssistant[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('--fallback-assistants must be valid JSON, e.g. \'[{"id":"@cf/moonshotai/kimi-k2.6","finetune":false}]\'');
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--fallback-assistants must be a JSON array");
  }
  if (parsed.length > MAX_FALLBACK_ASSISTANTS) {
    throw new Error(`--fallback-assistants accepts at most ${MAX_FALLBACK_ASSISTANTS} entries`);
  }
  return parsed.map((item, i) => {
    const o = item as Record<string, unknown>;
    if (!o || typeof o.id !== "string" || o.id.length === 0 || typeof o.finetune !== "boolean") {
      throw new Error(`--fallback-assistants[${i}] must be { "id": string, "finetune": boolean }`);
    }
    return { id: o.id, finetune: o.finetune };
  });
}

const THEME_PRESETS = [
  "default", "dark", "light", "high-contrast", "ocean", "forest", "sunset", "midnight", "custom",
] as const;
type ThemePresetName = typeof THEME_PRESETS[number];

/** Validate a --theme-preset value against the allowed presets. */
export function validateThemePreset(raw: string): ThemePresetName {
  if (!(THEME_PRESETS as readonly string[]).includes(raw)) {
    throw new Error(`--theme-preset must be one of: ${THEME_PRESETS.join(", ")}`);
  }
  return raw as ThemePresetName;
}

/**
 * Parse + shape-validate the --theme-override JSON into a ThemeConfig. Requires
 * a valid `preset`; colors/fonts are passed through (the server's
 * castThemeOverride does the strict CSS-safety validation). Throws a friendly
 * CLI error before the request is sent.
 */
export function parseThemeOverride(raw: string): ReleaseThemeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('--theme-override must be valid JSON, e.g. \'{"preset":"custom","colors":{"primary":"#2e7d32"}}\'');
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--theme-override must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.preset !== "string" || !(THEME_PRESETS as readonly string[]).includes(o.preset)) {
    throw new Error(`--theme-override.preset must be one of: ${THEME_PRESETS.join(", ")}`);
  }
  // The single cast, at the parse boundary where `unknown` legitimately becomes
  // typed and only after `preset` — the one required field — has been checked.
  // Colors and fonts stay pass-through: the server's castThemeOverride is the
  // authority on CSS safety, and duplicating it here would only drift.
  return o as unknown as ReleaseThemeConfig;
}

export function registerReleaseUpdateCommand(parent: Command): void {
  parent
    .command("update <releaseId>")
    .description("Update a release")
    .option("--name <name>", "New release name")
    .option(
      "--rag-indexes <ids>",
      "Comma-separated RAG vector ids to attach (replaces the release's full list)",
    )
    .option("--status <status>", "New release status")
    .option(
      "--skills-enabled",
      "Enable the skill/tool loop for this release. Required before ANY skill (sendSms, sendEmail, ...) can be offered to the model — without it the loop is inert and the assistant may claim actions it cannot perform.",
    )
    .option(
      "--no-skills-enabled",
      "Disable the skill/tool loop for this release",
    )
    .option(
      "--catalog-skills <json>",
      'Skill instances to enable, as JSON `{"<skillInstanceId>":["actionName"]}`. NOTE: keyed by the WhitelabelSkill INSTANCE id, not the catalog id (create an instance first). Replaces the current map.',
    )
    .option(
      "--testing-domains <origins>",
      "Comma-separated origins whose messages do NOT count against this release's usage quota — a quota exemption for staging/local builds, not a CORS allowlist and not an access grant. Accepts an exact host, a single-label wildcard (*.dev.example.com), or localhost/127.0.0.1. The exemption applies only when X-Embed-Origin agrees with the browser's own Origin header, so listing a public domain does not buy unmetered chat. Set BEFORE publishing — a published release is locked. Pass '' to clear.",
    )
    .option(
      "--gate-mode <mode>",
      "Free-Chat Gate: 'none' (open anonymous chat), 'captcha-only', 'captcha+otp', or 'captcha+magic-link'. Non-'none' modes need a Turnstile sitekey valid for the embedding origin — docs sites on origins outside the platform Turnstile allowlist should use 'none'. MERGES into the existing gate object (quota/turnstile/crm/brand are preserved).",
    )
    .option(
      "--gate-per-device-lifetime <n>",
      "Free-Chat Gate: lifetime messages allowed per device (default 3). The 'device' is sha256(client IP) with no cookie or fingerprint component, so everyone behind one NAT shares a counter, and the Redis key's TTL is ~90 days. Raise this for demo surfaces.",
    )
    .option(
      "--gate-per-email-lifetime <n>",
      "Free-Chat Gate: lifetime messages allowed per verified email (default 1).",
    )
    .option(
      "--gate-window-count <n>",
      "Free-Chat Gate: messages allowed inside the post-verify window (default 5).",
    )
    .option(
      "--gate-window-hours <n>",
      "Free-Chat Gate: length of the post-verify window in hours (default 24).",
    )
    .option(
      "--context-cache-mode <mode>",
      "Vertex context caching: off | implicit-only | explicit",
    )
    .option(
      "--context-cache-ttl-minutes <minutes>",
      "Hard TTL for explicit cache resources (5-360, default 60)",
    )
    .option(
      "--adaptive-ttl",
      "Server picks TTL from rolling 7-day traffic instead of the hard value",
    )
    .option(
      "--no-cache-system-prompt",
      "When mode=explicit, do NOT cache the Release's system prompt + tools",
    )
    .option(
      "--assistant <id-or-json>",
      "Primary model for this release, e.g. '@cf/google/gemma-4-26b-a4b-it'. Accepts a bare model id (finetune:false) or '{\"id\":\"...\",\"finetune\":true}'. Set --fallback-assistants alongside it to define the whole chain in one call.",
    )
    .option(
      "--fallback-assistants <json>",
      'Ordered fallback model chain as JSON, e.g. \'[{"id":"@cf/moonshotai/kimi-k2.6","finetune":false}]\' (max 5). Pass \'[]\' to clear.',
    )
    .option(
      "--require-signed-anonymous-chat",
      "Require a valid landing-page HMAC signature on anonymous-chat requests for this release",
    )
    .option(
      "--no-require-signed-anonymous-chat",
      "Disable the landing-page HMAC requirement for this release",
    )
    .option(
      "--rerank-max-chunks <n>",
      "Per-release cap on RAG chunks sent to the LLM after cross-index merge-rerank (0 = disable trim; omit = platform default 8). Lower = faster/cheaper, fewer sources.",
    )
    .option(
      "--rag-trigger <mode>",
      "Pre-emptive RAG gate: 'heuristic' skips retrieval for greetings/acks/chit-chat (faster, fewer tokens); 'always' (default) always retrieves. Never skips when the release requires grounding (on-topic).",
    )
    .option(
      "--rag-trigger-min-chars <n>",
      "With --rag-trigger heuristic: trimmed-length floor below which a message skips RAG (default 4). Short topic words still retrieve.",
    )
    .option(
      "--ai-gateway",
      "Enable Cloudflare AI Gateway routing for gateway-routable providers (Workers AI @cf/…, Gemini AI Studio) — adds gateway caching + observability. Vertex fine-tunes call Vertex directly and are unaffected.",
    )
    .option(
      "--no-ai-gateway",
      "Disable Cloudflare AI Gateway routing for this release",
    )
    .option(
      "--mcp-enabled",
      "Serve this release as an MCP server at https://mcp.divinci.app/{whitelabelId}/mcp. The MCP Worker only serves releases with this ON.",
    )
    .option("--no-mcp-enabled", "Stop serving this release over MCP")
    .option(
      "--mcp-exposed-tools <names>",
      "Comma-separated MCP tool names to expose (unset = all release tools). Rejected server-side if a name is not a served tool.",
    )
    .option("--mcp-allowed-scopes <scopes>", "Comma-separated MCP scopes to allow (subset of platform scopes)")
    .option("--mcp-rate-per-minute <n>", "MCP requests per minute for this release")
    .option("--mcp-rate-per-day <n>", "MCP requests per day for this release")
    .option(
      "--mcp-allow-anonymous",
      "Allow UNAUTHENTICATED MCP access. Requires --mcp-max-spend-cents > 0: this attaches your wallet to a public endpoint.",
    )
    .option("--no-mcp-allow-anonymous", "Require authentication for MCP access")
    .option(
      "--mcp-max-spend-cents <n>",
      "Billing safety cap, in cents, per MCP token. Mandatory whenever anonymous access is on.",
    )
    .option(
      "--response-cache",
      "Enable the response-level semantic cache: a repeated/paraphrased prompt reuses the cached answer and SKIPS the LLM (sub-second, model-agnostic — ideal for conversation starters).",
    )
    .option(
      "--no-response-cache",
      "Disable the response-level semantic cache for this release",
    )
    .option(
      "--response-cache-ttl <seconds>",
      "With --response-cache: TTL in seconds for a cached response before it must be regenerated.",
    )
    .option(
      "--product-sub-replies",
      "Enable product sub-replies + inline product decoration for this release (replaces the global PRODUCT_SUB_REPLIES_ENABLED env var).",
    )
    .option(
      "--no-product-sub-replies",
      "Disable product sub-replies for this release.",
    )
    .option(
      "--retro-match <mode>",
      "Retroactively scan the reply TEXT for catalog-product mentions: 'name-mention' (precision), 'bm25-full' (recall), 'rag-candidates' (this turn's retrieved products), or 'off' to disable.",
    )
    .option(
      "--max-products <n>",
      "With product sub-replies: max products surfaced per reply (default 1).",
    )
    .option(
      "--match-threshold <0-1>",
      "With product sub-replies: score threshold a product must clear to surface (default 0.5).",
    )
    .option(
      "--theme-preset <preset>",
      "Set a per-release theme that overrides the workspace theme for THIS release (e.g. 'light' to fix a release that renders unreadably on a light embed). One of: default, dark, light, high-contrast, ocean, forest, sunset, midnight, custom.",
    )
    .option(
      "--theme-override <json>",
      'Advanced: full per-release ThemeConfig as JSON, e.g. \'{"preset":"custom","colors":{"primary":"#2e7d32","primaryDark":"#1b5e20"}}\'. Overrides --theme-preset.',
    )
    .option(
      "--clear-theme-override",
      "Clear the per-release theme override so this release inherits the workspace theme again.",
    )
    .option(
      "--thread-prefix <text>",
      "New system-prompt text. Creates a new ThreadPrefix sub-document and replaces the release's reference.",
    )
    .option(
      "--conversation-starters <json>",
      'New suggested-prompt conversation starters as a JSON array of 1-3 strings, e.g. \'["What is...", "How do I..."]\'. Replaces the full list.',
    )
    .option(
      "--chat-disclaimer <text>",
      "New chat disclaimer text. Creates a new version and replaces the release's reference.",
    )
    .option(
      "--chat-welcome-message <text>",
      "New chat welcome message text. Replaces the release's reference.",
    )
    .option(
      "--chat-cta <json>",
      'Contextual CTA card as JSON, e.g. \'{"title":"Interested in investing?","teaserText":"Get our free guide","triggerKeywords":["investing","1031"],"ctaType":"link-out","targetUrl":"https://...","active":true}\'. Replaces the release\'s reference.',
    )
    .option(
      "--clear-terms-of-service",
      "Clear the release's Terms of Service gate (the 'I Agree' legal modal) so it no longer requires acceptance. The release's chatDisclaimer banner is unaffected.",
    )
    .option(
      "--voice-transport <transport>",
      "Twilio architecture for phone calls: 'conversation-relay' (default — Twilio does STT/TTS, limited to Google/Amazon/ElevenLabs voices) or 'media-stream' (Divinci runs Deepgram Flux STT + Deepgram Aura TTS; required for a Deepgram voice). Requires DEEPGRAM_API_KEY on the voice services.",
    )
    .option(
      "--clear-voice-transport",
      "Clear the per-release voice transport so calls use the default ConversationRelay architecture again.",
    )
    .option(
      "--tts-tool <tool>",
      "TTS tool for this release (e.g. 'deepgram-tts', 'browser-local', 'elevenlabs-tts'). On phone calls a Deepgram voice also requires --voice-transport media-stream.",
    )
    .option(
      "--tts-voice <voice>",
      "Voice id for --tts-tool. For deepgram-tts on a call this is an Aura model id, e.g. 'aura-2-draco-en'. Set it together with --tts-tool: a voice id means nothing outside its own provider.",
    )
    .option(
      "--clear-tts-tool",
      "Clear the per-release TTS tool AND voice, inheriting the white label's defaults. Both are cleared together because they are only meaningful as a pair.",
    )
    .action(async (releaseId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        // Resolved up front because the Free-Chat Gate merge below has to READ
        // the release before it can layer changes onto the existing gate.
        const workspaceId = requireWorkspaceId(config);

        const updates: UpdateReleaseOptions = {};
        if (opts.name) updates.name = opts.name;
        if (opts.status) updates.status = opts.status;
        // skillConfig — merged server-side (update-draft spreads over the
        // existing object), so sending only the sub-fields the operator named
        // leaves everything else intact. Enabling without a toolCallingAssistant
        // is fine: the server auto-fills it from the release's own assistant.
        {
          const skillConfig: NonNullable<UpdateReleaseOptions["skillConfig"]> = {};
          if (opts.skillsEnabled !== undefined) skillConfig.enabled = Boolean(opts.skillsEnabled);
          if (opts.catalogSkills !== undefined) {
            skillConfig.catalogSkills = parseCatalogSkills(String(opts.catalogSkills));
          }
          if (Object.keys(skillConfig).length > 0) {
            // Assigned through the typed field, NOT `updates as Record<string,
            // unknown>`. The cast that used to be here is why this flag shipped
            // inert: UpdateReleaseOptions had no `skillConfig`, the SDK's body
            // allowlist had no `skillConfig`, and the cast asserted the gap
            // away. Keep this typed so deleting the SDK's forwarding line
            // breaks the build instead of the release.
            updates.skillConfig = skillConfig;
          }
        }
        if (opts.testingDomains !== undefined) {
          // CORS allowlist for the release's anonymous chat (Divinci Docs embed
          // sites). Empty string clears. SDK passes it through to the draft update.
          // Typed assignment, not `updates as Record<string, unknown>` — see
          // the skillConfig note above. The field is real and forwarded today;
          // the cast was the only thing that would have let it stop being so
          // without the build noticing.
          updates.testingDomains = String(opts.testingDomains)
            .split(",").map((s: string) => s.trim()).filter(Boolean);
        }
        // Assigned through the TYPED field, never `updates as Record<string,
        // unknown>`. The cast that used to be here is why this flag shipped
        // inert for its whole life: UpdateReleaseOptions had no
        // `voiceTransport`, the SDK's body allowlist had no `voiceTransport`,
        // and the cast asserted both gaps away — so the flag parsed, validated,
        // printed success, and changed nothing. Identical to the
        // `--catalog-skills` bug, one field over. Keep these typed so deleting
        // the SDK's forwarding line breaks the build instead of the release.
        if (opts.clearVoiceTransport) {
          updates.voiceTransport = null;
        } else if (opts.voiceTransport !== undefined) {
          // Validate here as well as server-side: a typo that reached the API
          // as an unknown value would be rejected, but catching it locally
          // gives the operator the valid list instead of "Bad voiceTransport".
          if (!VOICE_TRANSPORTS.includes(opts.voiceTransport)) {
            throw new Error(`--voice-transport must be one of: ${VOICE_TRANSPORTS.join(", ")}`);
          }
          updates.voiceTransport = opts.voiceTransport;
        }
        // TTS tool + voice. Deliberately settable together: a voice id is
        // provider-specific, so pairing one tool's voice with another tool is
        // how you get a call that drops or silently falls back to a default.
        if (opts.clearTtsTool) {
          updates.ttsToolOverride = null;
          updates.ttsVoiceOverride = null;
        } else {
          if (opts.ttsTool !== undefined) updates.ttsToolOverride = String(opts.ttsTool);
          if (opts.ttsVoice !== undefined) updates.ttsVoiceOverride = String(opts.ttsVoice);
          if (opts.ttsVoice !== undefined && opts.ttsTool === undefined) {
            console.warn(
              "⚠️  --tts-voice without --tts-tool: the voice is interpreted by whichever tool " +
              "the release already uses. If that is not the tool the voice belongs to, the call " +
              "falls back to a default voice rather than failing, so this can look like it worked.",
            );
          }
        }
        // ── Free-Chat Gate ────────────────────────────────────────────────
        // MERGE, never replace. This used to be `updates.freeChatGate =
        // { mode }`, which silently discarded quota, turnstile, crm and brand
        // — so setting a mode reset perDeviceLifetime to the default and
        // dropped a BYO Turnstile secretRef with no warning. We read the
        // current gate first and layer changes on top.
        const gateQuotaOpts: Array<[string, string]> = [
          ["gatePerDeviceLifetime", "perDeviceLifetime"],
          ["gatePerEmailLifetime", "perEmailLifetime"],
          ["gateWindowCount", "postVerifyWindowCount"],
          ["gateWindowHours", "postVerifyWindowHours"],
        ];
        const touchesGate =
          opts.gateMode !== undefined ||
          gateQuotaOpts.some(([flag])=> opts[flag] !== undefined);

        if (touchesGate) {
          if (opts.gateMode !== undefined) {
            const GATE_MODES = ["none", "captcha-only", "captcha+otp", "captcha+magic-link"];
            if (!GATE_MODES.includes(opts.gateMode)) {
              throw new Error(`--gate-mode must be one of: ${GATE_MODES.join(", ")}`);
            }
          }

          const baseUrl = config.apiUrl.replace(/\/+$/, "");
          const res = await fetch(
            `${baseUrl}/white-label/${workspaceId}/release/${releaseId}`,
            { headers: { Authorization: `Bearer ${config.accessToken}` } },
          );
          const body = await res.text();
          if (!res.ok) {
            throw new Error(
              `Could not read the current gate config (HTTP ${res.status}): ${body.substring(0, 300)}`,
            );
          }
          let current: { freeChatGate?: Record<string, unknown> };
          try { current = JSON.parse(body); }
          catch { throw new Error(`Non-JSON release response: ${body.substring(0, 200)}`); }

          const existing = (current.freeChatGate ?? {}) as Record<string, unknown>;
          const existingQuota = (existing.quota ?? {}) as Record<string, unknown>;
          const quota: Record<string, unknown> = { ...existingQuota };

          for (const [flag, field] of gateQuotaOpts) {
            if (opts[flag] === undefined) continue;
            const n = Number(opts[flag]);
            if (!Number.isInteger(n) || n < 0) {
              throw new Error(`--${flag.replace(/[A-Z]/g, (c)=> "-" + c.toLowerCase())} must be a non-negative integer`);
            }
            quota[field] = n;
          }

          // `mode` is required by the API shape, so carry the existing one
          // forward when only quota flags were passed.
          const mergedMode = opts.gateMode !== undefined
            ? String(opts.gateMode)
            : (typeof existing.mode === "string" ? existing.mode : undefined);
          if (mergedMode === undefined) {
            throw new Error(
              "This release has no Free-Chat Gate configured yet — pass --gate-mode alongside the quota flags.",
            );
          }

          updates.freeChatGate = {
            ...existing,
            mode: mergedMode,
            ...(Object.keys(quota).length > 0 ? { quota } : {}),
          };
        }
        // MCP exposure for this release.
        //
        // ⚠️ READ-MODIFY-WRITE, and that is not politeness. Server-side
        // `castOptionalMcpConfig` REBUILDS the object from what it receives, and
        // the SDK lets `options.mcpConfig` overwrite `current.mcpConfig`
        // wholesale — so sending `{ enabled: true }` alone would silently drop
        // an existing exposedTools list AND an existing maxSpendPerTokenCents.
        // Dropping a spend cap by setting an unrelated flag is the failure this
        // merge exists to prevent. Same shape as the gate-config merge above.
        {
          const mcpFlags = [
            "mcpEnabled", "mcpExposedTools", "mcpAllowedScopes",
            "mcpRatePerMinute", "mcpRatePerDay", "mcpAllowAnonymous", "mcpMaxSpendCents",
          ];
          if (mcpFlags.some((f) => opts[f] !== undefined)) {
            const baseUrl = config.apiUrl.replace(/\/+$/, "");
            const res = await fetch(
              `${baseUrl}/white-label/${workspaceId}/release/${releaseId}`,
              { headers: { Authorization: `Bearer ${config.accessToken}` } },
            );
            const body = await res.text();
            if (!res.ok) {
              throw new Error(
                `Could not read the current MCP config (HTTP ${res.status}): ${body.substring(0, 300)}`,
              );
            }
            let currentRelease: { mcpConfig?: Record<string, unknown> };
            try { currentRelease = JSON.parse(body); }
            catch { throw new Error(`Non-JSON release response: ${body.substring(0, 200)}`); }

            updates.mcpConfig = mergeMcpConfig(
              (currentRelease.mcpConfig ?? {}) as Record<string, unknown>,
              opts as Record<string, unknown>,
            ) as unknown as NonNullable<UpdateReleaseOptions["mcpConfig"]>;
          }
        }
        if (opts.ragIndexes !== undefined) {
          // F10 (dogfood): attach RAG vectors without dropping to the raw API.
          updates.ragIndexes = String(opts.ragIndexes)
            .split(",").map((id: string) => id.trim()).filter(Boolean)
            .map((id: string) => ({ id }));
        }
        if (opts.assistant !== undefined) {
          // Typed field, never `updates as Record<string, unknown>` — the cast
          // is what let --catalog-skills and --voice-transport ship inert.
          updates.assistant = parsePrimaryAssistant(String(opts.assistant));
        }
        if (opts.fallbackAssistants !== undefined) {
          updates.fallbackAssistants = parseFallbackAssistants(opts.fallbackAssistants);
        }
        // Per-release theme override. Precedence: --clear wins, then explicit
        // JSON, then the preset convenience flag. null clears (inherit workspace).
        if (opts.clearThemeOverride) {
          updates.themeOverride = null;
        } else if (opts.themeOverride !== undefined) {
          updates.themeOverride = parseThemeOverride(opts.themeOverride);
        } else if (opts.themePreset !== undefined) {
          updates.themeOverride = { preset: validateThemePreset(opts.themePreset) };
        }
        // commander maps --require-signed-anonymous-chat → true and
        // --no-require-signed-anonymous-chat → false; absent → undefined.
        if (opts.requireSignedAnonymousChat !== undefined) {
          updates.requireSignedAnonymousChat = opts.requireSignedAnonymousChat;
        }
        if (opts.rerankMaxChunks !== undefined) {
          const n = Number(opts.rerankMaxChunks);
          if (!Number.isInteger(n) || n < 0) {
            throw new Error("--rerank-max-chunks must be a non-negative integer (0 disables the trim)");
          }
          updates.rerankMaxChunks = n;
        }
        if (opts.ragTrigger !== undefined) {
          if (opts.ragTrigger !== "always" && opts.ragTrigger !== "heuristic") {
            throw new Error("--rag-trigger must be 'always' or 'heuristic'");
          }
          const ragTrigger: { mode: "always" | "heuristic"; minChars?: number } = { mode: opts.ragTrigger };
          if (opts.ragTriggerMinChars !== undefined) {
            const mc = Number(opts.ragTriggerMinChars);
            if (!Number.isInteger(mc) || mc < 0) {
              throw new Error("--rag-trigger-min-chars must be a non-negative integer");
            }
            ragTrigger.minChars = mc;
          }
          updates.ragTrigger = ragTrigger;
        }
        // Product sub-replies. The flags build the config object (same replace
        // semantics as --rag-trigger: unset sub-fields fall to server defaults).
        // commander: --product-sub-replies → true, --no-product-sub-replies → false.
        {
          const psr: NonNullable<UpdateReleaseOptions["productSubReplies"]> = {};
          let touched = false;
          if (opts.productSubReplies !== undefined) {
            psr.enabled = opts.productSubReplies;
            touched = true;
          }
          if (opts.retroMatch !== undefined) {
            const m = opts.retroMatch as string;
            if (!["off", "name-mention", "bm25-full", "rag-candidates"].includes(m)) {
              throw new Error("--retro-match must be one of: off | name-mention | bm25-full | rag-candidates");
            }
            psr.retroMatch = m === "off"
              ? { enabled: false }
              : { enabled: true, mode: m as "name-mention" | "bm25-full" | "rag-candidates" };
            touched = true;
          }
          if (opts.maxProducts !== undefined) {
            const n = Number(opts.maxProducts);
            if (!Number.isInteger(n) || n < 1) {
              throw new Error("--max-products must be an integer >= 1");
            }
            psr.maxProducts = n;
            touched = true;
          }
          if (opts.matchThreshold !== undefined) {
            const t = Number(opts.matchThreshold);
            if (!Number.isFinite(t) || t < 0 || t > 1) {
              throw new Error("--match-threshold must be a number between 0 and 1");
            }
            psr.matchThreshold = t;
            touched = true;
          }
          if (touched) updates.productSubReplies = psr;
        }
        // commander maps --ai-gateway → true, --no-ai-gateway → false; absent → undefined.
        if (opts.aiGateway !== undefined) {
          updates.aiGateway = {
            enabled: opts.aiGateway === true,
            // Make this a RELEASE-specific decision, not "inherit the whitelabel".
            // The runtime treats undefined useWhiteLabelDefaults as "use the
            // release's enabled", but the web UI defaults the "Use whitelabel
            // defaults" checkbox to CHECKED when undefined — so set it false
            // explicitly so the UI reflects the enabled release-level setting.
            useWhiteLabelDefaults: false,
            useDefaultGateway: true,
            // No hardcoded gatewayId — the resolver falls back to the per-env
            // CLOUDFLARE_AI_GATEWAY_ID (e.g. divinci-ai-gateway-01 on staging),
            // so the same release config is correct across environments. (BYO
            // custom gateways set customAccountId + gatewayId explicitly.)
          };
        }
        // --response-cache → true, --no-response-cache → false; absent → undefined.
        if (opts.responseCache !== undefined) {
          const prc: { enabled: boolean; ttlSeconds?: number } = { enabled: opts.responseCache === true };
          if (opts.responseCacheTtl !== undefined) {
            const ttl = Number(opts.responseCacheTtl);
            if (!Number.isInteger(ttl) || ttl <= 0) {
              throw new Error("--response-cache-ttl must be a positive integer (seconds)");
            }
            prc.ttlSeconds = ttl;
          }
          updates.publicResponseCache = prc;
        }

        if (opts.threadPrefix !== undefined) {
          updates.threadPrefix = opts.threadPrefix;
        }
        if (opts.conversationStarters !== undefined) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(opts.conversationStarters);
          } catch {
            throw new Error('--conversation-starters must be valid JSON, e.g. \'["What is...", "How do I..."]\'');
          }
          if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3 || !parsed.every((s) => typeof s === "string" && s.length > 0)) {
            throw new Error("--conversation-starters must be a JSON array of 1-3 non-empty strings");
          }
          updates.conversationStarters = parsed as string[];
        }
        if (opts.chatDisclaimer !== undefined) {
          updates.chatDisclaimer = opts.chatDisclaimer;
        }
        if (opts.chatWelcomeMessage !== undefined) {
          updates.chatWelcomeMessage = opts.chatWelcomeMessage;
        }
        // Commander camelCases "--chat-cta" to opts.chatCta (NOT chatCTA).
        if (opts.chatCta !== undefined) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(opts.chatCta);
          } catch {
            throw new Error("--chat-cta must be valid JSON (a CTA object)");
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("--chat-cta must be a JSON object");
          }
          const cta = parsed as Record<string, unknown>;
          if (typeof cta.title !== "string" || typeof cta.teaserText !== "string") {
            throw new Error("--chat-cta requires string \"title\" and \"teaserText\"");
          }
          if (cta.ctaType !== "link-out" && cta.ctaType !== "email-gated-download") {
            throw new Error("--chat-cta \"ctaType\" must be \"link-out\" or \"email-gated-download\"");
          }
          updates.chatCTA = cta as unknown as ChatCTAInput;
        }
        if (opts.clearTermsOfService) {
          updates.termsOfService = null;
        }

        if (opts.contextCacheMode) {
          if (!CONTEXT_CACHE_MODES.includes(opts.contextCacheMode)) {
            throw new Error(
              `--context-cache-mode must be one of: ${CONTEXT_CACHE_MODES.join(", ")}`,
            );
          }
          const cc: ContextCacheUpdate = { mode: opts.contextCacheMode as ContextCacheMode };
          if (opts.contextCacheTtlMinutes !== undefined) {
            const ttl = Number(opts.contextCacheTtlMinutes);
            if (!Number.isFinite(ttl) || ttl < 5 || ttl > 360) {
              throw new Error("--context-cache-ttl-minutes must be 5-360");
            }
            cc.explicitTtlMinutes = ttl;
          }
          if (opts.adaptiveTtl === true) cc.adaptiveTtl = true;
          // commander turns --no-cache-system-prompt into cacheSystemPrompt=false
          if (opts.cacheSystemPrompt === false) cc.cacheSystemPrompt = false;
          updates.contextCache = cc;
        }

        // Always use the workspace-scoped admin endpoint (OAuth-friendly). The
        // alternative client.releases.update() hits the api-key-only
        // /api/v1/releases/:id route (requireAPIKey), which 401s under the CLI's
        // OAuth auth — so require a workspace and never fall back to it.
        // (workspaceId is resolved at the top of this action.)

        const data = await withSpinner("Updating release...", () =>
          client.releases.updateInWorkspace(workspaceId, releaseId, updates)
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
