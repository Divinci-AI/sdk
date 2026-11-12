/**
 * Free-Chat Gate namespace — the keyless, Release-configurable
 * email-gated public chat (Divinci.ai homepage, DrFurman.ai landing
 * page, and any future SDK consumer).
 *
 * Replaces the legacy {@link HomepageChatNamespace} which is pinned to
 * one Release via env var. This namespace takes the Release id per
 * call so any whitelabel with `freeChatGate.mode !== "none"` can
 * drive its own consumer chat.
 *
 * Modes (configured server-side on the Release):
 *   - "none"               → no gate; callers should use the regular
 *                            anonymous-chat endpoint instead
 *   - "captcha-only"       → Turnstile only; start() returns a token
 *                            immediately
 *   - "captcha+otp"        → Turnstile + email + 6-digit OTP; call
 *                            start() then verifyOtp()
 *   - "captcha+magic-link" → Turnstile + email + magic link; call
 *                            start() then poll state() after the
 *                            visitor clicks the link in their email
 *
 * Browser-only flow recommended via the @divinci-ai/embed-client
 * <FreeChatGate> React component which wraps this namespace's
 * primitives. Use this namespace directly when you need a non-React
 * integration.
 *
 * Server-side anti-abuse stack (always-on for non-"none" modes):
 *   - Turnstile captcha (per-start)
 *   - Disposable-domain rejection
 *   - Per-email lifetime quota (Redis INCR, atomic)
 *   - Per-device backstop (fingerprint + monthly cap)
 *   - Spend cap per Release (cents/day)
 */
import { BaseNamespace } from "../base.js";
import type { MessageFeedbackInput } from "@divinci-ai/types";

const TOKEN_STORAGE_PREFIX = "divinci-fcg:";

export type FreeChatGateMode =
  | "none"
  | "captcha-only"
  | "captcha+otp"
  | "captcha+magic-link";

export interface FreeChatGateStartArgs {
  releaseId: string;
  /** Required unless mode is `none` (no-op). */
  turnstileToken?: string;
  /** Required for OTP + magic-link modes. */
  email?: string;
  /** Magic-link only — where to send the visitor after they click. */
  redirectTo?: string;
  /**
   * Optional marketing opt-in (GDPR). When true, the verified email may be
   * added to the release's marketing list (CRM). Default/absent → the email
   * is still stored as a contact but not marked a marketing contact.
   */
  marketingConsent?: boolean;
}

export type FreeChatGateStartResult =
  | {
      status: "ready";
      mode: FreeChatGateMode;
      nextStep: "chat";
      /** Immediate token for captcha-only mode. */
      token: string;
    }
  | {
      status: "sent";
      mode: FreeChatGateMode;
      nextStep: "otp" | "link";
    };

export interface FreeChatGateVerifyOtpResult {
  token: string;
  mode: FreeChatGateMode;
}

export interface FreeChatGateStateResult {
  mode: FreeChatGateMode;
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  expiresAt: number;
}

export interface FreeChatGateTranscriptMessage {
  msgPrefix?: string;
  prompt: string;
  promptTimestamp: number;
  response: string;
  responseTimestamp: number;
  context: Array<{ content: string }>;
  products?: unknown[];
  /**
   * Where the assistant text came from. `"local"` = generated on the visitor's
   * device (delegated inference) — the signature attests only that the release
   * ACCEPTED the text, not that it produced it. `"cloud"` / absent = release-
   * authored. Consumers should not present a `"local"` turn as release-authored.
   */
  provenance?: "cloud" | "local";
}

export interface FreeChatGateSendResult {
  reply: string;
  remaining: number;
  transcript: FreeChatGateTranscriptMessage[];
}

/**
 * One supported chat-response language for a Release. Mirrors the
 * platform `PlatformLanguage` shape but is declared locally so the SDK
 * stays free of an `@divinci-ai/models` dependency.
 *
 * - `code`        BCP-47 tag (e.g. "es", "zh-hans") — use as the switcher
 *                 option value + URL/`lang` hint.
 * - `englishName` what the server matches against — pass THIS to
 *                 {@link FreeChatGateNamespace.setLanguage}.
 * - `autonym`     the language in its own script — render THIS in the UI.
 * - `dir`         "ltr" | "rtl" for layout.
 */
export interface FreeChatGateLanguage {
  code: string;
  englishName: string;
  autonym: string;
  dir: "ltr" | "rtl";
}

export interface FreeChatGateSupportedLanguagesResult {
  /** The languages this Release will honor, in platform display order. */
  languages: FreeChatGateLanguage[];
  /** The default language code (always "en"). */
  default: string;
}

/**
 * Site Control (v1) — an executable action the deployed assistant may emit (via
 * a fenced `divinci-action` block) for the SDK/embed to run. Mirrors the
 * server's SiteActionDescriptor shape; declared locally so the client SDK stays
 * free of an `@divinci-ai/models` dependency.
 */
export interface SiteActionParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
}
export interface SiteActionDescriptor {
  name: string;
  description: string;
  category: "navigation" | "query" | "mutation" | "utility";
  parameters: SiteActionParameter[];
  /** A mutation ALWAYS requires user confirmation before the handler runs. */
  requiresConfirmation: boolean;
  /** What the handler should do, discriminated by kind. */
  target:
    | { kind: "navigate" }
    | { kind: "submitForm"; route: string; action?: string };
}

export interface FreeChatGateSpeakResult {
  /** Public URL of the synthesized audio. Assign to an <audio> src. */
  url: string;
  /** MIME type of the audio at `url` (e.g. "audio/mpeg"). */
  mimetype: string;
  /** The speaker used, as configured on the release. */
  voice: string | null;
  /** Audio encoding (currently always "mp3"). */
  encoding: string;
  /** Characters actually spoken — may be less than the reply, see below. */
  textLength: number;
  /** True when the audio already existed and no synthesis was billed. */
  cached: boolean;
}

export interface FreeChatGateConfigResult {
  mode: FreeChatGateMode;
  /** "" when mode is "none" (no Turnstile needed). */
  turnstileSiteKey: string;
  /** Executable site-control actions; [] unless the release opted in (THE WALL). */
  siteActions: SiteActionDescriptor[];
}

export class FreeChatGateNamespace extends BaseNamespace {
  private token: string | null = null;
  private releaseId: string | null = null;
  private transcript: FreeChatGateTranscriptMessage[] = [];
  private signiture = "";
  /** English name of the response language to request, or null for default (English). */
  private language: string | null = null;

  /**
   * Fetch the languages a Release supports for chat responses — the
   * resolved set a language switcher should offer so it reflects the
   * Release config rather than a hardcoded list. Public + unauthenticated;
   * safe to call before the gate flow (the switcher renders pre-chat).
   *
   * Render each option's `autonym` and, on selection, pass the chosen
   * option's `englishName` to {@link setLanguage}.
   */
  async getSupportedLanguages(
    releaseId: string,
  ): Promise<FreeChatGateSupportedLanguagesResult> {
    const qs = new URLSearchParams({ releaseId });
    return this.httpClient.get<FreeChatGateSupportedLanguagesResult>(
      `/ai-chat/free-chat-gate/languages?${qs}`,
      { skipValidation: true },
    );
  }

  /**
   * Fetch the gate's mode + the EFFECTIVE Turnstile sitekey for a Release at
   * runtime, so a widget/embed/landing page renders the right Turnstile
   * (platform or the customer's BYO sitekey) without hardcoding it at build
   * time. Public + unauthenticated; safe to call before the gate flow.
   * `turnstileSiteKey` is "" when mode is "none" (no Turnstile needed).
   */
  async getConfig(releaseId: string): Promise<FreeChatGateConfigResult> {
    const qs = new URLSearchParams({ releaseId });
    const raw = await this.httpClient.get<Partial<FreeChatGateConfigResult>>(
      `/ai-chat/free-chat-gate/config?${qs}`,
      { skipValidation: true },
    );
    // Tolerate older servers that predate siteActions (v1.4c) — default to [].
    return {
      mode: raw.mode as FreeChatGateMode,
      turnstileSiteKey: raw.turnstileSiteKey ?? "",
      siteActions: raw.siteActions ?? [],
    };
  }

  /**
   * Set the response language for subsequent {@link send} calls. Pass a
   * language's `englishName` (from {@link getSupportedLanguages}) — e.g.
   * "Spanish". Pass null (or "English") to clear back to the default.
   *
   * The server only honors the value if it is in the Release's supported
   * set (exact, allowlist-guarded match); an unsupported value is
   * silently ignored server-side, so the chat never breaks on a bad
   * language string.
   */
  setLanguage(languageEnglishName: string | null): void {
    const v = languageEnglishName?.trim();
    this.language = v && v.toLowerCase() !== "english" ? v : null;
  }

  /** The currently-requested response language English name, or null. */
  getLanguage(): string | null {
    return this.language;
  }

  /**
   * Kick off the gate flow. Returns the token immediately for
   * captcha-only mode; for OTP/magic-link modes the visitor must
   * complete out-of-band (paste the OTP code or click the email link)
   * before chat-send works.
   */
  async start(
    args: FreeChatGateStartArgs,
  ): Promise<FreeChatGateStartResult> {
    const res = await this.httpClient.post<FreeChatGateStartResult>(
      "/ai-chat/free-chat-gate/start",
      args,
      { skipValidation: true },
    );
    // captcha-only: server returned an immediate token — store it.
    if (res.status === "ready" && "token" in res && res.token) {
      this.setToken(args.releaseId, res.token);
    } else {
      // Remember which release the in-flight verification belongs to
      // so verifyOtp() defaults work without the caller threading
      // releaseId through every call.
      this.releaseId = args.releaseId;
    }
    return res;
  }

  /**
   * Step 2 for `captcha+otp` — exchange a 6-digit code for the gate
   * token. On success the token is persisted (in-memory + localStorage
   * keyed by releaseId).
   */
  async verifyOtp(args: {
    releaseId?: string;
    email: string;
    otpCode: string;
  }): Promise<FreeChatGateVerifyOtpResult> {
    const releaseId = args.releaseId ?? this.releaseId;
    if (!releaseId) {
      throw new Error(
        "verifyOtp() requires releaseId — either pass it or call start() first.",
      );
    }
    const res = await this.httpClient.post<FreeChatGateVerifyOtpResult>(
      "/ai-chat/free-chat-gate/verify",
      { releaseId, email: args.email, otpCode: args.otpCode },
      { skipValidation: true },
    );
    this.setToken(releaseId, res.token);
    return res;
  }

  /**
   * Read the current quota state without mutating anything. Used by
   * the embed-client to render "you have N messages remaining today"
   * copy after the gate flow completes.
   */
  async state(args?: {
    releaseId?: string;
    token?: string;
  }): Promise<FreeChatGateStateResult> {
    const releaseId = args?.releaseId ?? this.releaseId;
    const token = args?.token ?? this.token;
    if (!releaseId || !token) {
      throw new Error(
        "state() requires both releaseId and a verified token — call start()/verifyOtp() first.",
      );
    }
    const qs = new URLSearchParams({ releaseId, token });
    return this.httpClient.get<FreeChatGateStateResult>(
      `/ai-chat/free-chat-gate/state?${qs}`,
      { skipValidation: true },
    );
  }

  /**
   * Send a chat message. Requires a verified token (either from
   * start() in captcha-only mode, verifyOtp() in OTP mode, or
   * setToken() to restore one from localStorage in magic-link mode
   * after the redirect).
   */
  async send(
    prompt: string,
    opts?: { signal?: AbortSignal },
  ): Promise<FreeChatGateSendResult> {
    if (!this.token) {
      throw new Error(
        "Gate not verified. Call start() (captcha-only), verifyOtp() (OTP mode), or setToken() (magic-link mode after redirect) before send().",
      );
    }
    const res = await this.httpClient.post<{
      transcript: FreeChatGateTranscriptMessage[];
      signiture: string;
      remaining: number;
    }>(
      "/ai-chat/free-chat-gate/chat-send",
      {
        token: this.token,
        prevSigniture: this.signiture,
        newPrompt: prompt,
        transcript: this.transcript,
        // Response-language request — server honors it only against the
        // Release's allowlist (see setLanguage). Omitted when default.
        ...(this.language ? { language: this.language } : {}),
      },
      { skipValidation: true, signal: opts?.signal },
    );
    this.transcript = res.transcript ?? [];
    this.signiture = res.signiture ?? "";
    const last = this.transcript[this.transcript.length - 1];
    return {
      reply: last?.response ?? "",
      remaining: res.remaining ?? 0,
      transcript: this.transcript,
    };
  }

  /**
   * Delegated-inference turn for a GATED release: same gate token + per-email
   * quota as send(), but the release runs its full pipeline server-side (RAG +
   * persona + moderation on prepare; post-gen style-rewrite + signed transcript
   * on complete) and ONLY the language-model call is run by `generate` — e.g.
   * the visitor's on-device Gemma via the Divinci Local Inference extension.
   * Mirrors anonymousChat.sendDelegated() but over the gate endpoints, so it
   * works for releases behind the Free-Chat Gate (which block /anonymous-chat/*).
   *
   *   await c.freeChatGate.sendDelegated(prompt, (messages) =>
   *     window.divinci.chat({ messages }).then((r) => r.fullText));
   */
  async sendDelegated(
    prompt: string,
    generate: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<string>,
    opts?: { signal?: AbortSignal },
  ): Promise<FreeChatGateSendResult> {
    if (!this.token) {
      throw new Error(
        "Gate not verified. Call start() (captcha-only), verifyOtp() (OTP mode), or setToken() (magic-link mode after redirect) before sendDelegated().",
      );
    }
    // 1. PREPARE: release assembles the prompt (RAG + persona) + moderates input.
    const prep = await this.httpClient.post<{
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      context: Array<{ content: string }>;
    }>(
      "/ai-chat/free-chat-gate/prepare",
      {
        token: this.token,
        prevSigniture: this.signiture,
        newPrompt: prompt,
        transcript: this.transcript,
        ...(this.language ? { language: this.language } : {}),
      },
      { skipValidation: true, signal: opts?.signal },
    );
    // 2. GENERATE locally (on-device).
    const response = await generate(prep.messages);
    // 3. COMPLETE: release post-gen loops + append + sign the turn; burns quota.
    const res = await this.httpClient.post<{
      transcript: FreeChatGateTranscriptMessage[];
      signiture: string;
      remaining: number;
    }>(
      "/ai-chat/free-chat-gate/complete",
      {
        token: this.token,
        prevSigniture: this.signiture,
        newPrompt: prompt,
        response,
        context: prep.context,
        transcript: this.transcript,
      },
      { skipValidation: true, signal: opts?.signal },
    );
    this.transcript = res.transcript ?? [];
    this.signiture = res.signiture ?? "";
    const last = this.transcript[this.transcript.length - 1];
    return {
      reply: last?.response ?? "",
      remaining: res.remaining ?? 0,
      transcript: this.transcript,
    };
  }

  /**
   * Restore a prior conversation (e.g. from localStorage) so send() continues it
   * with the correct signed-transcript continuity. The gate session re-arms on
   * the next send (Turnstile re-issues a token); only the signed transcript +
   * signature need restoring here.
   */
  hydrate(transcript: FreeChatGateTranscriptMessage[], signiture: string): void {
    this.transcript = Array.isArray(transcript) ? transcript : [];
    this.signiture = typeof signiture === "string" ? signiture : "";
  }

  /** The running signed transcript + signature (for persistence). */
  getState(): { transcript: FreeChatGateTranscriptMessage[]; signiture: string } {
    return { transcript: this.transcript, signiture: this.signiture };
  }

  /**
   * Stash this conversation under a one-time handoff token so it can travel into
   * the full web app (chat.divinci.app), where the logged-in user claims it via
   * anonymous-to-owned and continues where they left off. Returns the token to
   * put in the handoff URL (?divinciHandoff=<token>). Requires a sent message.
   *
   * Pass `opts.releaseId` when the conversation was RESTORED (e.g. from
   * localStorage) rather than sent this session: getConfig() does not set
   * `this.releaseId` — only start()/setToken() do — so without the override a
   * restored, un-re-sent conversation would wrongly throw "requires a sent
   * message" even though it has a transcript + signature.
   */
  async createHandoff(opts?: { releaseId?: string }): Promise<{ token: string; expiresInSeconds: number }> {
    const releaseId = opts?.releaseId ?? this.releaseId;
    if (!releaseId || this.transcript.length === 0) {
      throw new Error("createHandoff() requires a sent message — call send() first.");
    }
    return this.httpClient.post<{ token: string; expiresInSeconds: number }>(
      "/ai-chat/handoff",
      { releaseId, prevSigniture: this.signiture, transcript: this.transcript },
      { skipValidation: true },
    );
  }

  /**
   * Accept the release's current published Terms of Service for the gate
   * token's verified identity. Call when send() rejects with a 403
   * TERMS_NOT_ACCEPTED (a {@link TermsNotAcceptedError} when routed through
   * the SDK error mapper — its details carry tosId, version, title and the
   * markdown content to render), then retry the send.
   *
   * Uses the public release-scoped accept endpoint with the gate token as
   * identity proof — no API key or JWT needed on this keyless surface.
   */
  async acceptTerms(input: { tosId: string; version: number }): Promise<{ required: boolean }> {
    if (!this.token || !this.releaseId) {
      throw new Error(
        "Gate not verified. Complete the gate flow (start/verifyOtp/setToken) before acceptTerms().",
      );
    }
    return this.httpClient.post<{ required: boolean }>(
      `/white-label-release/${encodeURIComponent(this.releaseId)}/terms-of-service/accept`,
      {
        tosId: input.tosId,
        version: input.version,
        freeChatToken: this.token,
      },
      { skipValidation: true },
    );
  }

  /**
   * Submit thumbs/feedback for one assistant message in the current gated
   * conversation. Uses the gate's internally-tracked signed transcript +
   * signature (set by the most recent send()), so the caller only needs the
   * message index and the feedback. Routes to the same /anonymous-feedback
   * endpoint as anonymous chat (the gate's transcript is signed identically).
   *
   * Only thumbs-down or feedback-bearing submissions are recorded server-side
   * (negative-only gate); a positive-only vote is a no-op there.
   *
   * @param messageIndex index of the exchange in the signed transcript.
   * @example
   * ```typescript
   * await client.freeChatGate.submitFeedback(0, { sentiment: -1, feedback: "off-topic" });
   * ```
   */
  async submitFeedback(
    messageIndex: number,
    input: MessageFeedbackInput = {},
  ): Promise<void> {
    if (!this.releaseId || !this.signiture || this.transcript.length === 0) {
      throw new Error(
        "submitFeedback() requires a sent message — call send() first so a signed transcript exists.",
      );
    }
    await this.httpClient.post(
      "/ai-chat/anonymous-feedback",
      {
        releaseId: this.releaseId,
        transcript: this.transcript,
        signiture: this.signiture,
        messageIndex,
        feedback: input.feedback,
        sentiment: input.sentiment,
      },
      { skipValidation: true },
    );
  }

  /**
   * Synthesize speech for one assistant reply in the current gated
   * conversation, and return a URL you can play.
   *
   * Like {@link submitFeedback}, this takes an INDEX into the gate's signed
   * transcript rather than text. That is a deliberate constraint, not an
   * inconvenience: the server will only speak a reply the release itself
   * signed, so the endpoint can be public without becoming free
   * text-to-speech on the release owner's wallet. There is no way to have it
   * speak arbitrary text, and no `text` parameter to reach for.
   *
   * The voice comes from release configuration (`ttsVoiceOverride`, falling
   * back to the whitelabel default, then Cloudflare Aura-2's `phoebe`) — it is
   * not a per-call choice, so audio stays consistent across a conversation.
   *
   * Long replies are trimmed to roughly 1800 characters at a sentence
   * boundary, and markdown (code blocks, link URLs, emphasis markers) is
   * stripped before synthesis — check `textLength` against the reply if you
   * need to know whether the visitor heard all of it. Repeat calls for the
   * same reply are served from cache (`cached: true`) and bill nothing.
   *
   * @param messageIndex index of the exchange in the signed transcript —
   *   the same index {@link submitFeedback} takes.
   * @example
   * ```typescript
   * const { reply } = await client.freeChatGate.send("What is Divinci?");
   * const { url } = await client.freeChatGate.speak(0);
   * await new Audio(url).play();
   * ```
   */
  async speak(messageIndex: number): Promise<FreeChatGateSpeakResult> {
    if (!this.token) {
      throw new Error(
        "speak() requires a verified gate session — call start()/verifyOtp() first.",
      );
    }
    if (!this.signiture || this.transcript.length === 0) {
      throw new Error(
        "speak() requires a sent message — call send() first so a signed transcript exists.",
      );
    }
    if (
      !Number.isInteger(messageIndex) ||
      messageIndex < 0 ||
      messageIndex >= this.transcript.length
    ) {
      throw new Error(
        `speak(): messageIndex ${messageIndex} is out of range for a transcript of ${this.transcript.length}.`,
      );
    }
    return this.httpClient.post<FreeChatGateSpeakResult>(
      "/ai-chat/free-chat-gate/tts",
      {
        token: this.token,
        transcript: this.transcript,
        signiture: this.signiture,
        messageIndex,
      },
      { skipValidation: true },
    );
  }

  /** Whether a verified gate token is currently held. */
  isVerified(): boolean {
    return this.token !== null;
  }

  /**
   * Restore a previously-issued token (e.g. from localStorage on
   * page load, or from the redirect URL after a magic-link click).
   * The releaseId is also stored so subsequent state() / verifyOtp()
   * calls have a default.
   */
  setToken(releaseId: string, token: string): void {
    this.token = token;
    this.releaseId = releaseId;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          `${TOKEN_STORAGE_PREFIX}${releaseId}`,
          JSON.stringify({ token, verified: true }),
        );
      }
    } catch {
      /* storage may be unavailable / blocked */
    }
  }

  /**
   * Load a token previously stored under `releaseId`. Returns whether
   * one was found.
   */
  loadStoredToken(releaseId: string): boolean {
    try {
      if (typeof localStorage === "undefined") return false;
      const raw = localStorage.getItem(`${TOKEN_STORAGE_PREFIX}${releaseId}`);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { token?: unknown };
      if (typeof parsed?.token !== "string") return false;
      this.token = parsed.token;
      this.releaseId = releaseId;
      return true;
    } catch {
      return false;
    }
  }

  /** The running transcript (for rendering history). */
  getTranscript(): ReadonlyArray<FreeChatGateTranscriptMessage> {
    return this.transcript;
  }

  /** Clear token + conversation (e.g. on "start over" / sign-out). */
  reset(): void {
    const r = this.releaseId;
    this.token = null;
    this.releaseId = null;
    this.transcript = [];
    this.signiture = "";
    this.language = null;
    try {
      if (typeof localStorage !== "undefined" && r) {
        localStorage.removeItem(`${TOKEN_STORAGE_PREFIX}${r}`);
      }
    } catch {
      /* ignore */
    }
  }
}
