/**
 * The embeddable "Ask Divinci" widget: builds its own DOM, injects its styles,
 * and drives an anonymous Divinci Release chat. Relocated verbatim from the
 * sdk.divinci.ai docs assistant — the only seams are this mount() wrapper (which
 * builds the markup + reads options instead of data-attributes) and the
 * per-tenant `app` overrides. See ./pure for the unit-tested render/classify
 * helpers and ./styles for the injected stylesheet.
 */
import { DivinciClient } from "@divinci-ai/client";

/** 8 samples of silent WAV. Played on click to mark an <audio> element
 *  user-initiated BEFORE the multi-second synthesis request — otherwise
 *  play() afterwards is rejected by autoplay policy and the visitor gets the
 *  fallback voice instead of the one that was just synthesized. */
const SILENT_UNLOCK_WAV =
  "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";
import {
  renderMarkdown,
  escapeHtml,
  ipAvatarHtml,
  sourceTitle,
  sourceExcerpt,
  classifyModerationError,
  isRateLimitError,
  stripMarkdownForSpeech,
  reactionsStorageKey,
  messageReactionKey,
  toggleReaction,
  normalizeLocalPolicy,
  localToggleState,
  shouldRouteLocal,
  localFallbackAllowed,
  type SourceItem,
  type LocalModelPolicy,
} from "./pure.js";
import { STYLES } from "./styles.js";
import {
  docsSessionUrl,
  isFirstPartyDocsParentOrigin,
  isTrustedChatOrigin,
  parseDocsSessionMessage,
} from "./session.js";

/** The window.divinci surface the Divinci Local Inference extension injects. */
interface DivinciLocalApi {
  chat(
    req: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }> },
    handlers?: { onToken?: (delta: string) => void; signal?: AbortSignal },
  ): Promise<{ fullText: string }>;
}
function getLocalExt(): DivinciLocalApi | null {
  const d = (window as unknown as { divinci?: DivinciLocalApi }).divinci;
  return d && typeof d.chat === "function" ? d : null;
}

export interface MountOptions {
  /** The Divinci Release id this widget chats against. Required. */
  releaseId: string;
  /** API origin. Default https://api.divinci.app. */
  apiUrl?: string;
  /** Header + panel title. Default "Ask Divinci". */
  title?: string;
  /** Launcher pill label. Default "Ask Divinci". */
  launcherLabel?: string;
  /** First assistant bubble. Default a generic greeting. */
  greeting?: string;
  /** Input placeholder. Default "Ask a question…". */
  placeholder?: string;
  /** Assistant avatar image src. Default "/favicon.png". */
  avatarSrc?: string;
  /** Page-aware conversation starters, shown as clickable chips under the
   *  greeting while the conversation is empty. Clicking one sends its `message`
   *  (which is also subject to `pageContext` injection on the first turn). */
  suggestions?: Array<{ label: string; message: string }>;
  /** Hidden context grounding the assistant in the current page. Prepended ONCE
   *  to the user's first message before it's sent — never shown in the chat
   *  (it's stripped from the displayed bubble and from restored transcripts). */
  pageContext?: string;
  /** Per-tenant destinations for the Divinci-specific affordances. */
  app?: {
    /** "Continue in the app" / handoff target. Default: apiUrl with api.->chat. */
    webAppUrl?: string;
    /** Where the IP-avatar "Sign up" CTA links. Default `${webAppUrl}/signup`. */
    signupUrl?: string;
    /** Whether the dock starts open on first visit. Default true. */
    defaultOpen?: boolean;
  };
  /**
   * On-device routing policy when the Divinci Local Inference extension is
   * present (window.divinci). Release-admin controlled.
   *   - "off":      never use local.
   *   - "fallback": (default) local-first when the extension is present + the
   *                 visitor keeps the on-device toggle on; cloud on local error.
   *   - "prefer":   local-only when present (no cloud fallback).
   */
  localModel?: LocalModelPolicy;
}

export interface WidgetController {
  open(): void;
  close(): void;
  reset(): void;
  destroy(): void;
}

interface ResolvedText {
  title: string;
  launcherLabel: string;
  greeting: string;
  placeholder: string;
  avatarSrc: string;
}

function widgetMarkup(
  o: ResolvedText,
  suggestions: Array<{ label: string; message: string }>,
): string {
  const suggestionsHtml = suggestions.length
    ? `
          <div class="da-suggestions" id="da-suggestions">
            ${suggestions
              .map(
                (s) =>
                  `<button type="button" class="da-suggestion" data-message="${escapeHtml(
                    s.message,
                  )}">${escapeHtml(s.label)}</button>`,
              )
              .join("")}
          </div>`
    : "";
  return `
      <button
        type="button"
        class="da-launcher"
        id="da-launcher"
        aria-label="Ask Divinci"
        aria-expanded="false"
      >
        <span class="da-avatar da-avatar--launcher">
          <img src="${o.avatarSrc}" alt="Divinci" width="32" height="32" />
          <span class="da-status" data-live="unknown" title="Checking…" aria-live="polite"></span>
        </span>
        <span>${o.launcherLabel}</span>
      </button>

      <section class="da-panel" id="da-panel" role="dialog" aria-label="Docs assistant" hidden>
        <header class="da-header">
          <div class="da-avatar">
            <img src="${o.avatarSrc}" alt="Divinci" width="32" height="32" />
            <span class="da-status" data-live="unknown" title="Checking…" aria-live="polite"></span>
          </div>
          <div class="da-title">
            <strong>${o.title}</strong>
          </div>
          <button type="button" class="da-icon-btn da-local-toggle" id="da-local-toggle" aria-label="Run on this device" aria-pressed="false" title="Run on-device (local Gemma via the Divinci extension)" hidden>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12z"/></svg>
          </button>
          <button type="button" class="da-icon-btn da-sound-toggle" id="da-sound" aria-label="Turn sound on" aria-pressed="false" title="Read replies aloud" hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          </button>
          <button type="button" class="da-icon-btn" id="da-expand" aria-label="Expand to center" aria-pressed="false" title="Expand to center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
          </button>
          <button type="button" class="da-icon-btn" id="da-reset" aria-label="Start over" title="Start over">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          </button>
          <button type="button" class="da-icon-btn" id="da-close" aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="da-messages" id="da-messages" aria-live="polite">
          <div class="da-msg da-msg-assistant">
            <div class="da-avatar da-avatar--msg"><img src="${o.avatarSrc}" alt="Divinci" width="28" height="28" /></div>
            <div class="da-msg-col">
              <div class="da-bubble">${o.greeting}</div>
            </div>
          </div>${suggestionsHtml}
        </div>

        <!-- Handoff: continue this conversation in the full Divinci web app, or
             get a coding-agent brief. Shown after the first exchange. The × tucks
             the buttons away to a restore tab so the transcript reclaims the space. -->
        <div class="da-handoff" id="da-handoff" hidden>
          <div class="da-handoff-inner">
          <div class="da-handoff-content">
          <div class="da-handoff-head">
            <button type="button" class="da-handoff-collapse" id="da-handoff-collapse" aria-label="Hide these options" title="Hide">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="da-handoff-row">
            <button type="button" class="da-handoff-btn" id="da-handoff-btn" title="Continue in the Divinci web application">
              <span class="da-handoff-label"><span class="da-handoff-text">Divinci app</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <span class="da-handoff-desc">Continue in the Divinci web application</span>
            </button>
            <button type="button" class="da-handoff-btn da-handoff-btn--alt" id="da-codegen-btn" title="Summarize a handoff document for your code editor">
              <span class="da-handoff-label"><span class="da-handoff-text">Code editor</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" /></svg></span>
              <span class="da-handoff-desc">Summarize a handoff document for your code editor</span>
            </button>
          </div>
          </div>
          </div>
        </div>
        <!-- Restore tab: appears at the right when the handoff bar is collapsed. -->
        <button type="button" class="da-handoff-restore" id="da-handoff-restore" hidden aria-label="Show continue / handoff options" title="Continue / handoff">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 18l-6-6 6-6" /><path d="M19 18l-6-6 6-6" /></svg>
        </button>


        <!-- Invisible Cloudflare Turnstile mounts here (interaction-only: no UI
             unless CF demands a challenge). -->
        <div class="da-turnstile" id="da-turnstile"></div>

        <form class="da-input-row" id="da-form">
          <input
            type="text"
            id="da-input"
            class="da-input"
            placeholder="${o.placeholder}"
            autocomplete="off"
            aria-label="Your question"
          />
          <button type="submit" class="da-send" id="da-send" aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </form>
`;
}

let stylesInjected = false;

export function mount(
  target: HTMLElement | null | undefined,
  options: MountOptions,
): WidgetController {
  const noop: WidgetController = { open() {}, close() {}, reset() {}, destroy() {} };
  const releaseId = options.releaseId || "";
  if (!releaseId) return noop; // nothing to chat against
  const apiUrl = (options.apiUrl || "https://api.divinci.app").replace(/\/+$/, "");
  const o: ResolvedText = {
    title: options.title ?? "Ask Divinci",
    launcherLabel: options.launcherLabel ?? "Ask Divinci",
    greeting: options.greeting ?? "Hi! Ask me anything — I answer from this site's content.",
    placeholder: options.placeholder ?? "Ask a question…",
    avatarSrc: options.avatarSrc ?? "/favicon.png",
  };

  // Page-aware extras (both optional, both additive).
  const suggestions = Array.isArray(options.suggestions)
    ? options.suggestions.filter(
        (s) => s && typeof s.label === "string" && typeof s.message === "string" && s.label && s.message,
      )
    : [];
  const pageContext = (options.pageContext || "").trim();

  // The hidden context block is wrapped in sentinels so it can be stripped from
  // any displayed/restored transcript — it must never appear in a chat bubble.
  const CTX_OPEN = "<<<DIVINCI_PAGE_CONTEXT>>>";
  const CTX_CLOSE = "<<<END_PAGE_CONTEXT>>>";
  function wrapWithContext(ctx: string, prompt: string): string {
    return `${CTX_OPEN}\nThe user is reading this Divinci documentation page. Use the following context to ground your answer; do not mention or repeat this context block.\n\n${ctx}\n${CTX_CLOSE}\n\n${prompt}`;
  }
  function stripContext(text: string): string {
    const close = text.indexOf(CTX_CLOSE);
    if (text.indexOf(CTX_OPEN) === -1 || close === -1) return text;
    return text.slice(close + CTX_CLOSE.length).replace(/^\s+/, "");
  }
  let firstUserMessageSent = false;

  // Inject the stylesheet once per page.
  if (!stylesInjected) {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-divinci-embed", "");
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
    stylesInjected = true;
  }

  // Build the widget DOM and attach it to the host (body by default).
  const host = target || document.body;
  const root = document.createElement("div");
  root.id = "divinci-docs-assistant";
  root.innerHTML = widgetMarkup(o, suggestions);
  host.appendChild(root);

  // ─── relocated widget logic (was DocsAssistant.astro init()) ───────────────
    const launcher = document.getElementById("da-launcher") as HTMLButtonElement;
    const panel = document.getElementById("da-panel") as HTMLElement;
    const closeBtn = document.getElementById("da-close") as HTMLButtonElement;
    const resetBtn = document.getElementById("da-reset") as HTMLButtonElement;
    const expandBtn = document.getElementById("da-expand") as HTMLButtonElement;
    const form = document.getElementById("da-form") as HTMLFormElement;
    const input = document.getElementById("da-input") as HTMLInputElement;
    const sendBtn = document.getElementById("da-send") as HTMLButtonElement;
    const messages = document.getElementById("da-messages") as HTMLElement;
    const suggestionsEl = document.getElementById("da-suggestions");
    function hideSuggestions(): void { if (suggestionsEl) suggestionsEl.hidden = true; }
    function showSuggestions(): void { if (suggestionsEl) suggestionsEl.hidden = false; }
    const handoffBar = document.getElementById("da-handoff") as HTMLElement;
    const handoffBtn = document.getElementById("da-handoff-btn") as HTMLButtonElement;
    const handoffCollapseBtn = document.getElementById("da-handoff-collapse") as HTMLButtonElement;
    const handoffRestoreBtn = document.getElementById("da-handoff-restore") as HTMLButtonElement;
    // Whether the handoff bar is tucked away to its restore tab. Persisted so the
    // choice survives navigation; only ever relevant once a conversation exists.
    const HANDOFF_COLLAPSED_KEY = `divinci-docs-handoff-collapsed:${releaseId}`;
    let handoffCollapsed = (() => {
      try { return localStorage.getItem(HANDOFF_COLLAPSED_KEY) === "1"; } catch { return false; }
    })();
    // Both the launcher and the open-panel header carry a `.da-status` dot.
    const statusDots = Array.from(root.querySelectorAll<HTMLElement>(".da-status"));

    const client = new DivinciClient({ baseUrl: apiUrl, releaseId });
    let busy = false;
    let signedIn = false;

    function applyHostToken(token: string): void {
      signedIn = true;
      void client.setToken(token);
      root.querySelectorAll<HTMLAnchorElement>("a.da-ip-avatar").forEach((a) => {
        a.title = "Signed in to Divinci";
        const label = a.querySelector(".da-ip-signup");
        if (label) label.textContent = "Signed in";
      });
    }

    function listenForHostSession(expectedOrigin: string, timeoutMs: number): Promise<string | null> {
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", onMsg);
          resolve(null);
        }, timeoutMs);
        function onMsg(ev: MessageEvent): void {
          if (ev.origin !== expectedOrigin) return;
          const parsed = parseDocsSessionMessage(ev.data);
          if (!parsed) return;
          window.clearTimeout(timer);
          window.removeEventListener("message", onMsg);
          resolve(parsed.authenticated ? parsed.token : null);
        }
        window.addEventListener("message", onMsg);
      });
    }

    async function probeHostSession(): Promise<void> {
      if (!isFirstPartyDocsParentOrigin(location.origin)) return;
      if (!isTrustedChatOrigin(new URL(webAppUrl).origin)) return;
      const expectedOrigin = new URL(webAppUrl).origin;
      const iframe = document.createElement("iframe");
      iframe.src = docsSessionUrl(webAppUrl, location.origin);
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("tabindex", "-1");
      iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
      const tokenPromise = listenForHostSession(expectedOrigin, 2500);
      document.body.appendChild(iframe);
      try {
        const token = await tokenPromise;
        if (token) applyHostToken(token);
      } finally {
        iframe.remove();
      }
    }

    function connectHostSessionPopup(): Promise<string | null> {
      if (!isFirstPartyDocsParentOrigin(location.origin)) return Promise.resolve(null);
      if (!isTrustedChatOrigin(new URL(webAppUrl).origin)) return Promise.resolve(null);
      const expectedOrigin = new URL(webAppUrl).origin;
      const popup = window.open(
        docsSessionUrl(webAppUrl, location.origin),
        "divinci-docs-session",
        "width=480,height=640",
      );
      if (!popup) {
        window.open(`${webAppUrl.replace(/\/+$/, "")}/`, "_blank", "noopener,noreferrer");
        return Promise.resolve(null);
      }
      return listenForHostSession(expectedOrigin, 120000);
    }

    // ─── On-device routing (Divinci Local Inference extension) ───────────────
    // Local-first when the extension injects window.divinci and the visitor keeps
    // the on-device toggle on; cloud fallback per the release-admin policy.
    const localPolicy = normalizeLocalPolicy(options.localModel);
    const LOCAL_PREF_KEY = `divinci-docs-local-model:${releaseId}`;
    const localToggleBtn = document.getElementById("da-local-toggle") as HTMLButtonElement | null;
    let localOn = false;
    function readLocalPref(): boolean | null {
      try {
        const v = localStorage.getItem(LOCAL_PREF_KEY);
        return v == null ? null : v === "1";
      } catch {
        return null;
      }
    }
    function refreshLocalToggle(): void {
      const { show, on } = localToggleState(localPolicy, !!getLocalExt(), readLocalPref());
      localOn = on;
      if (!localToggleBtn) return;
      localToggleBtn.hidden = !show;
      localToggleBtn.setAttribute("aria-pressed", String(on));
      localToggleBtn.classList.toggle("da-local-toggle--on", on);
      localToggleBtn.title = on
        ? "On-device: answering with local Gemma (click to use the cloud)"
        : "Run on-device with the Divinci extension (click to enable)";
    }
    localToggleBtn?.addEventListener("click", () => {
      localOn = !localOn;
      try {
        localStorage.setItem(LOCAL_PREF_KEY, localOn ? "1" : "0");
      } catch {
        /* storage off */
      }
      refreshLocalToggle();
    });
    refreshLocalToggle();
    // The extension may inject window.divinci a moment after the widget mounts.
    window.setTimeout(refreshLocalToggle, 800);

    // Delegated inference: the RELEASE runs its full pipeline server-side (RAG +
    // persona + moderation + post-gen + signed transcript); ONLY the LLM call is
    // run on-device by the extension. This is what makes local answers as grounded
    // as cloud ones (not a flimsy page-text bypass). Gated releases aren't
    // supported on this path → cloud fallback handles them.
    async function localChatSend(
      prompt: string,
      signal?: AbortSignal,
      onToken?: (delta: string) => void,
    ): Promise<{ reply: string; context?: SourceItem[]; provenance?: "cloud" | "local" }> {
      const ext = getLocalExt();
      if (!ext) throw new Error("Local model unavailable");
      // Thread the abort signal + token stream into the on-device generation so
      // Stop actually interrupts it and the bubble fills live (the extension
      // honors handlers.signal / handlers.onToken).
      const generate = (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) =>
        ext.chat({ messages }, { signal, onToken }).then((r) => r.fullText || "(no response)");
      // Gated releases delegate over the gate endpoints (a verified token gates
      // prepare/complete); open releases use the anonymous-chat surface. Either
      // way the release runs RAG + persona + moderation server-side — only the
      // LLM call runs on-device.
      const result = gated
        ? await (async () => { await ensureGate(); return client.freeChatGate.sendDelegated(prompt, generate, { signal }); })()
        : await client.anonymousChat.sendDelegated(prompt, generate, { signal });
      const last = result.transcript[result.transcript.length - 1];
      // Server stamps provenance:"local" on the signed turn; default to "local"
      // since this path always delegated the LLM call on-device.
      return { reply: result.reply, context: last?.context as SourceItem[] | undefined, provenance: last?.provenance ?? "local" };
    }

    // Stop / cancel an in-flight turn. While a send is running the send button
    // becomes a Stop button that aborts the request (signal is threaded through
    // the SDK's send() → fetch). The paper-plane markup is captured here so Stop
    // mode can swap to a square and back without duplicating the SVG.
    let inflight: AbortController | null = null;
    const sendIconHtml = sendBtn.innerHTML;
    const stopIconHtml =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>';
    function setSendMode(mode: "send" | "stop"): void {
      sendBtn.dataset.mode = mode;
      sendBtn.innerHTML = mode === "stop" ? stopIconHtml : sendIconHtml;
      sendBtn.setAttribute("aria-label", mode === "stop" ? "Stop generating" : "Send");
      sendBtn.title = mode === "stop" ? "Stop generating" : "Send";
    }
    // The send button is a submit; in Stop mode a click aborts instead. We abort
    // here and let the (no-op, busy-guarded) form submit follow harmlessly.
    sendBtn.addEventListener("click", () => {
      if (sendBtn.dataset.mode === "stop" && inflight) inflight.abort();
    });

    // Full web app URL for handoff: api.<env>.divinci.app → chat.<env>.divinci.app.
    // Per-tenant override via options.app.webAppUrl so a third-party docs site
    // points at ITS product's signed-in app, not Divinci's.
    const webAppUrl = options.app?.webAppUrl
      || apiUrl.replace(/\/+$/, "").replace(/^https?:\/\/api\./, "https://chat.");

    // Where the IP-avatar "Sign up" CTA links (override via options.app.signupUrl).
    const signupUrl = options.app?.signupUrl || `${webAppUrl}/signup`;
    const loginUrl = `${webAppUrl.replace(/\/+$/, "")}/`;
    void probeHostSession();
    // Remember whether the user has the dock open across pages + sessions. Default
    // (unset) is open: the assistant greets every first-time visitor.
    const PANEL_OPEN_KEY = `divinci-docs-chat-open:${releaseId}`;
    // Remember the side-dock vs. center-expanded choice too (default: docked).
    const PANEL_EXPANDED_KEY = `divinci-docs-chat-expanded:${releaseId}`;

    // Handoff: stash the conversation under a one-time token + open the full app
    // (chat.divinci.app) where the user claims it (anonymous-to-owned) and the
    // assistant continues where they left off.
    handoffBtn.addEventListener("click", async () => {
      if (handoffBtn.disabled) return;
      const label = handoffBtn.querySelector(".da-handoff-text");
      const orig = label?.textContent;
      handoffBtn.disabled = true;
      if (label) label.textContent = "Preparing…";
      // Open the destination tab SYNCHRONOUSLY inside the click gesture. If we
      // wait until after the await below, the browser treats the window.open as
      // an unsolicited popup and blocks it. We navigate this tab once the token
      // is ready, or close it on failure. (No `noopener` here — that would make
      // window.open return null and we'd lose the handle; we navigate straight
      // to our own first-party chat app.)
      const appTab = window.open("about:blank", "_blank");
      try {
        // Build the handoff explicitly from the active namespace's persisted
        // transcript + the releaseId we already know — do NOT rely on the gated
        // namespace's createHandoff(), whose guard requires `this.releaseId`.
        // That field is set only by start()/setToken(), never by getConfig(), so
        // a RESTORED conversation (hydrated transcript, no fresh send this load)
        // would throw "requires a sent message". The /ai-chat/handoff endpoint
        // needs only releaseId + transcript + signature — no gate token.
        const ns = gated ? client.freeChatGate : client.anonymousChat;
        const { transcript, signiture } = ns.getState();
        if (!transcript.length) throw new Error("no conversation to hand off");
        const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/ai-chat/handoff`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ releaseId, prevSigniture: signiture, transcript }),
        });
        const body = await res.text();
        if (!res.ok) throw new Error(`handoff ${res.status}: ${body.slice(0, 200)}`);
        let token: string | undefined;
        try { ({ token } = JSON.parse(body) as { token?: string }); }
        catch { throw new Error(`handoff: non-JSON response (${res.status}): ${body.slice(0, 200)}`); }
        if (!token) throw new Error("handoff returned no token");
        const url = `${webAppUrl}/ai-chat?divinciHandoff=${encodeURIComponent(token)}`;
        if (appTab) appTab.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
        if (label) label.textContent = "Opened in app ✓";
        setTimeout(() => { if (label && orig) label.textContent = orig; handoffBtn.disabled = false; }, 2500);
      } catch (err) {
        if (appTab) appTab.close();
        if (label) label.textContent = "Couldn't open — try again";
        setTimeout(() => { if (label && orig) label.textContent = orig; handoffBtn.disabled = false; }, 2500);
        // eslint-disable-next-line no-console
        console.error("[docs-assistant] handoff failed", err);
      }
    });

    // Code-editor handoff: clicking "Code editor" asks the Release agent to write
    // a handoff brief AS A NORMAL CHAT TURN — added to the (signed) transcript so
    // the conversation continues afterward, rendered in the same style as any
    // reply. Copy / Download / MCP-config actions are appended below it.
    const codegenBtn = document.getElementById("da-codegen-btn") as HTMLButtonElement;

    // Handoff-brief idempotency. Generating a brief is a billed model turn that
    // appends to the signed transcript, so re-clicking "Code editor" when nothing
    // has changed should re-surface the existing brief, not regenerate it. We
    // remember the transcript signature at the moment the last brief was written
    // (+ its whitelabelId for the MCP snippets); if the current signature still
    // matches, the brief is current. Persisted with the conversation so this
    // holds across reloads too.
    let lastBriefSig: string | null = null;
    let lastBriefWhitelabelId = "";

    // Keep in sync with BRIEF_PROMPT in release-handoff-brief.ts — the server
    // stores this as the user turn, so the shown request matches the transcript.
    const HANDOFF_BRIEF_PROMPT =
      "Prepare a handoff brief I can paste into my coding agent (Claude Code, Cursor, etc.) to keep building with the Divinci SDK — cover the goal, the packages and install commands, the key APIs we discussed, starter code, the docs you cited, and a next-steps checklist, in Markdown.";

    // A labelled, copy-able snippet block (the agent configs + the brief reuse it).
    function snippetBlock(label: string, text: string, primary = false): HTMLElement {
      const wrap = document.createElement("div");
      const row = document.createElement("div");
      row.className = "da-codegen-actions";
      const tag = document.createElement("span");
      tag.className = "da-codegen-hint";
      tag.style.flex = "1 1 auto";
      tag.textContent = label;
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = `da-codegen-action${primary ? " da-codegen-action--primary" : ""}`;
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); copyBtn.textContent = "Copied ✓"; }
        catch { copyBtn.textContent = "Copy failed"; }
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
      });
      row.append(tag, copyBtn);
      const pre = document.createElement("pre");
      pre.className = "da-brief";
      pre.textContent = text;
      wrap.append(row, pre);
      return wrap;
    }

    // Append the handoff actions (copy brief / download / MCP config) to the chat,
    // directly after the brief message — so they live with the conversation.
    function appendHandoffActions(brief: string, whitelabelId: string): void {
      const block = document.createElement("div");
      block.className = "da-handoff-actions";
      const actions = document.createElement("div");
      actions.className = "da-codegen-actions";
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "da-codegen-action da-codegen-action--primary";
      copyBtn.textContent = "Copy brief";
      copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(brief); copyBtn.textContent = "Copied ✓"; }
        catch { copyBtn.textContent = "Copy failed"; }
        setTimeout(() => { copyBtn.textContent = "Copy brief"; }, 2000);
      });
      const dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "da-codegen-action";
      dlBtn.textContent = "Download .md";
      dlBtn.addEventListener("click", () => {
        const blob = new Blob([brief], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "DIVINCI_SDK_HANDOFF.md";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      actions.append(copyBtn, dlBtn);
      block.append(actions);

      // Live docs over MCP: a release-scoped, anonymous Divinci MCP server so the
      // agent can keep querying these docs (search_knowledge) while it codes —
      // grounded in the same content, no account needed. Collapsed by default.
      if (whitelabelId) {
        const mcpHost = apiUrl.replace(/\/+$/, "").replace(/^https?:\/\/api\./, "https://mcp.");
        const mcpUrl = `${mcpHost}/${whitelabelId}/mcp`;
        const details = document.createElement("details");
        details.className = "da-mcp-details";
        const summary = document.createElement("summary");
        summary.textContent = "Connect your agent to the live SDK docs (MCP)";
        details.append(
          summary,
          snippetBlock("Claude Code", `claude mcp add --transport http divinci-sdk ${mcpUrl}`),
          snippetBlock(
            "Cursor / Windsurf / Cline (mcp.json)",
            JSON.stringify({ mcpServers: { "divinci-sdk": { url: mcpUrl } } }, null, 2),
          ),
        );
        block.append(details);
      }
      messages.append(block);
      messages.scrollTop = messages.scrollHeight;
    }

    // Re-surface the most recent brief's action bar (scroll to it, flash the
    // button) without regenerating — used when nothing changed since it was made.
    function resurfaceBrief(): void {
      const blocks = messages.querySelectorAll<HTMLElement>(".da-handoff-actions");
      const last = blocks[blocks.length - 1];
      if (last) last.scrollIntoView({ behavior: "smooth", block: "nearest" });
      else messages.scrollTop = messages.scrollHeight;
      const label = codegenBtn.querySelector(".da-handoff-text");
      const orig = label?.textContent;
      if (label) label.textContent = "Already prepared ✓";
      setTimeout(() => { if (label && orig) label.textContent = orig; }, 2000);
    }

    codegenBtn.addEventListener("click", async () => {
      if (busy) return;
      const ns = gated ? client.freeChatGate : client.anonymousChat;
      const { transcript: pre, signiture: preSig } = ns.getState();
      if (!pre.length) return;
      // Nothing changed since the last brief → re-surface it instead of burning
      // another model turn + duplicating the brief in the transcript.
      if (lastBriefSig && preSig === lastBriefSig) { resurfaceBrief(); return; }
      busy = true;
      codegenBtn.disabled = true;
      sendBtn.disabled = true;
      // Render the request + a thinking bubble, exactly like a normal send. The
      // brief becomes a real assistant turn in the transcript (continuity).
      const briefUserMsg = addMessage("user", HANDOFF_BRIEF_PROMPT).closest<HTMLElement>(".da-msg");
      const typing = showTyping();
      if (briefUserMsg) scrollMessageToTop(briefUserMsg); // read the brief from its start
      try {
        const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/ai-chat/release-handoff-brief`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ releaseId, prevSigniture: preSig, transcript: pre }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`brief ${res.status}: ${text.slice(0, 200)}`);
        const parsed = JSON.parse(text) as {
          brief?: string; whitelabelId?: string; transcript?: unknown[]; signiture?: string;
        };
        const brief = (parsed.brief || "").trim();
        if (!brief) throw new Error("empty brief");
        typing.classList.remove("da-thinking");
        typing.classList.add("da-md");
        typing.innerHTML = renderMarkdown(brief);
        attachMessageMenu(typing, brief, true);
        // Adopt the new signed transcript so the conversation continues from here
        // (the brief + its request are now part of the signed history).
        if (Array.isArray(parsed.transcript) && typeof parsed.signiture === "string") {
          ns.hydrate(parsed.transcript as never, parsed.signiture);
          // Mark this brief as current so an immediate re-click re-surfaces it.
          lastBriefSig = parsed.signiture;
          lastBriefWhitelabelId = parsed.whitelabelId || "";
          saveConversation();
        }
        setLive("true");
        appendHandoffActions(brief, parsed.whitelabelId || "");
        // appendHandoffActions scrolls to the bottom (right for restore); here we
        // re-pin the brief request to the top so the brief reads from its start.
        if (briefUserMsg) scrollMessageToTop(briefUserMsg);
      } catch (err) {
        typing.classList.remove("da-thinking");
        typing.textContent = "Couldn't prepare the handoff brief. Please try again in a moment.";
        // eslint-disable-next-line no-console
        console.error("[docs-assistant] brief failed", err);
      } finally {
        busy = false;
        codegenBtn.disabled = false;
        sendBtn.disabled = false;
      }
    });

    // Live indicator — a real signal, not decoration: poll the API /health
    // endpoint and reflect green (live) / red (offline) / gray (checking).
    // Successful and failed sends also update it immediately.
    function setLive(state: "true" | "false" | "unknown") {
      const title =
        state === "true" ? "AI is live" : state === "false" ? "AI is offline" : "Checking…";
      for (const dot of statusDots) {
        dot.dataset.live = state;
        dot.title = title;
      }
    }
    async function probeLiveness() {
      try {
        const r = await fetch(`${apiUrl}/health`, { method: "GET" });
        const ok = r.ok && (await r.json().catch(() => ({})))?.status === "ok";
        setLive(ok ? "true" : "false");
      } catch {
        setLive("false");
      }
    }
    probeLiveness();
    setInterval(probeLiveness, 60000);

    // --- Bot gate (invisible Cloudflare Turnstile → freeChatGate) ---
    // The gate mode + Turnstile sitekey are fetched from the release config at
    // RUNTIME (client.freeChatGate.getConfig), not hardcoded at build — so the
    // same docs build works whether the release is gated (captcha-only) or open,
    // and honors a BYO sitekey transparently. When gated we render Turnstile
    // invisibly, exchange a token for a freeChatGate session, then send through
    // the gated endpoint; otherwise the open anonymous path. The session token
    // persists, so Turnstile runs once per conversation, not per message.
    const tsMount = document.getElementById("da-turnstile") as HTMLElement;
    let gateMode = "none";
    let turnstileSitekey = "";
    let gated = false;
    let turnstileId: string | null = null;
    let turnstileToken: string | null = null;
    let gateStarted = false;
    let gateConfigPromise: Promise<void> | null = null;

    function loadGateConfig(): Promise<void> {
      if (!gateConfigPromise) {
        gateConfigPromise = client.freeChatGate
          .getConfig(releaseId)
          .then((c) => {
            gateMode = c.mode || "none";
            const key = c.turnstileSiteKey || "";
            // CF always-passes test key for local dev (the staging secret won't
            // match it, so the gate only fully works on the deployed origin).
            turnstileSitekey =
              key && (location.hostname === "localhost" || location.hostname === "127.0.0.1")
                ? "1x00000000000000000000AA"
                : key;
            gated = gateMode !== "none" && Boolean(turnstileSitekey);
            // Site Control (v1.4d): feed the release's executable action
            // descriptors to the SDK executor. [] unless the release opted in.
            client.siteControl.setDescriptors(c.siteActions);
            // `gated` decides whether the platform voice is reachable, so the
            // sound control's visibility can only be settled once it is known.
            syncSoundBtn();
          })
          .catch(() => {
            // Config unreachable → fall back to the open path (never block chat).
            gateMode = "none";
            gated = false;
            syncSoundBtn();
          });
      }
      return gateConfigPromise;
    }

    function loadTurnstileScript(): Promise<void> {
      return new Promise((resolve) => {
        const w = window as unknown as { turnstile?: unknown };
        if (w.turnstile) return resolve();
        let s = document.querySelector<HTMLScriptElement>("script[data-divinci-turnstile]");
        if (s) { s.addEventListener("load", () => resolve(), { once: true }); return; }
        s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        s.async = true;
        s.defer = true;
        s.dataset.divinciTurnstile = "1";
        s.addEventListener("load", () => resolve(), { once: true });
        document.head.appendChild(s);
      });
    }

    type Turnstile = {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      getResponse: (id: string) => string | undefined;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
    const getTurnstile = (): Turnstile | undefined =>
      (window as unknown as { turnstile?: Turnstile }).turnstile;

    // Turnstile crash recovery. On a widget crash (e.g. error 300031, common
    // after repeated re-renders) or token expiry, the error/expired callbacks
    // below null the token but leave turnstileId set — so ensureTurnstileRendered
    // (guarded on turnstileId === null) never re-arms and every gated send is
    // stuck on "turnstile-pending". recoverTurnstile re-arms the widget, but
    // BOUNDED + backed-off: a tight re-render loop is itself a cause of 300031.
    // First attempt resets the existing widget; later attempts remove + render
    // fresh. A successful token resets the budget.
    let turnstileRecoveries = 0;
    let turnstileRecoverTimer: number | null = null;
    const MAX_TURNSTILE_RECOVERIES = 3;
    function recoverTurnstile(reason: string): void {
      if (!gated || turnstileRecoverTimer !== null) return;
      if (turnstileRecoveries >= MAX_TURNSTILE_RECOVERIES) return; // give up — avoid a re-render storm
      const attempt = ++turnstileRecoveries;
      turnstileRecoverTimer = window.setTimeout(() => {
        turnstileRecoverTimer = null;
        const ts = getTurnstile();
        if (!ts || turnstileId === null) return;
        try {
          if (attempt <= 1) {
            ts.reset(turnstileId); // light recovery: re-run the challenge in place
          } else {
            ts.remove(turnstileId); // crashed widget — drop it and render a fresh one
            turnstileId = null;
            void ensureTurnstileRendered();
          }
        } catch { /* next send re-arms / shows the retry message */ }
        // eslint-disable-next-line no-console
        console.warn(`[docs-assistant] Turnstile recovery #${attempt} (${reason})`);
      }, 1500 * attempt); // 1.5s / 3s / 4.5s backoff
    }

    async function ensureTurnstileRendered(): Promise<void> {
      await loadGateConfig();
      if (!gated || turnstileId !== null) return;
      await loadTurnstileScript();
      const ts = getTurnstile();
      if (!ts || turnstileId !== null) return;
      turnstileId = ts.render(tsMount, {
        sitekey: turnstileSitekey,
        theme: "auto",
        appearance: "interaction-only",
        callback: (t: string) => { turnstileToken = t; turnstileRecoveries = 0; },
        // Return true so Turnstile treats the error as handled; we drive recovery.
        "error-callback": (code?: string) => { turnstileToken = null; recoverTurnstile(`error ${code ?? ""}`); return true; },
        "expired-callback": () => { turnstileToken = null; recoverTurnstile("expired"); },
      });
    }

    // Start the freeChatGate session once (consumes one Turnstile token).
    const readTurnstileToken = (): string | null => {
      const ts = getTurnstile();
      return turnstileToken || (ts && turnstileId !== null ? ts.getResponse(turnstileId) || null : null);
    };

    // The invisible challenge usually solves in 1-4s but can take longer on a
    // cold page. Wait for it (the user already sees the typing indicator)
    // instead of bouncing the first message with "please send that again".
    async function waitForTurnstileToken(timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
      await ensureTurnstileRendered();
      const deadline = Date.now() + timeoutMs;
      let token = readTurnstileToken();
      while (!token && Date.now() < deadline && !signal?.aborted) {
        await new Promise((r) => setTimeout(r, 150));
        token = readTurnstileToken();
      }
      return token;
    }

    async function ensureGate(signal?: AbortSignal): Promise<void> {
      if (!gated || gateStarted) return;
      let token = await waitForTurnstileToken(12000, signal);
      if (!token && !signal?.aborted) {
        // Challenge looks stuck (or crashed past the recovery cap): drop the
        // widget and mint a fresh one, then give it one more full wait. The
        // check itself is unchanged — a real token is still required.
        const ts = getTurnstile();
        if (ts && turnstileId !== null) {
          try { ts.remove(turnstileId); } catch { /* already gone */ }
        }
        turnstileId = null;
        turnstileToken = null;
        turnstileRecoveries = 0;
        token = await waitForTurnstileToken(20000, signal);
      }
      if (!token) throw new Error("turnstile-pending");
      await client.freeChatGate.start({ releaseId, turnstileToken: token });
      gateStarted = true;
      turnstileToken = null; // single-use; the session token carries subsequent sends
    }

    // One chat turn: gated path when the release uses Turnstile, else open path.

    async function chatSend(
      prompt: string,
      signal?: AbortSignal,
      onToken?: (delta: string) => void,
    ): Promise<{ reply: string; context?: SourceItem[]; provenance?: "cloud" | "local" }> {
      await loadGateConfig();
      // On-device first when enabled. Works for gated releases too: localChatSend
      // delegates over the gate endpoints (verified token gates prepare/complete)
      // when gated, else the open anonymous-chat surface. The release still runs
      // RAG + persona + moderation server-side; only the LLM call runs on-device.
      // The extension prompts for its own per-origin consent. On a local error,
      // fall back to the cloud release unless the admin policy is "prefer".
      if (shouldRouteLocal(localPolicy, !!getLocalExt(), localOn)) {
        try {
          return await localChatSend(prompt, signal, onToken);
        } catch (err) {
          if (!localFallbackAllowed(localPolicy)) throw err;
          // else fall through to the cloud path
        }
      }
      if (gated) {
        await ensureGate(signal);
        const { reply, transcript } = await client.freeChatGate.send(prompt, { signal });
        const last = transcript[transcript.length - 1];
        return { reply, context: last?.context as SourceItem[] | undefined, provenance: last?.provenance };
      }
      const { reply, transcript } = await client.anonymousChat.send(prompt, { signal });
      const last = transcript[transcript.length - 1];
      return { reply, context: last?.context as SourceItem[] | undefined, provenance: last?.provenance };
    }

    function open(focus = true) {
      panel.hidden = false;
      launcher.hidden = true; // the full-height dock replaces the launcher pill
      launcher.setAttribute("aria-expanded", "true");
      if (focus) input.focus();
      try { localStorage.setItem(PANEL_OPEN_KEY, "1"); } catch { /* storage off */ }
      // Warm up gate config + Turnstile so a token is ready by send time.
      void ensureTurnstileRendered();
      void loadGateConfig();
    }
    function close() {
      panel.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
      try { localStorage.setItem(PANEL_OPEN_KEY, "0"); } catch { /* storage off */ }
    }

    // Expand the right dock to fill the center column (keeping the left nav
    // sidebar) and back. CSS does the layout via `.da-expanded` (only on wide
    // screens where the left sidebar is present); here we toggle the class, swap
    // the icon, and persist the choice.
    const EXPAND_ICON =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>';
    const COLLAPSE_ICON =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h3a2 2 0 0 0 2-2V3M16 3v3a2 2 0 0 0 2 2h3M19 16h-3a2 2 0 0 0-2 2v3M10 21v-3a2 2 0 0 0-2-2H5" /></svg>';
    function setExpanded(on: boolean, persist = true): void {
      panel.classList.toggle("da-expanded", on);
      expandBtn.setAttribute("aria-pressed", String(on));
      expandBtn.title = on ? "Dock to the side" : "Expand to center";
      expandBtn.setAttribute("aria-label", on ? "Dock to the side" : "Expand to center");
      expandBtn.innerHTML = on ? COLLAPSE_ICON : EXPAND_ICON;
      if (persist) { try { localStorage.setItem(PANEL_EXPANDED_KEY, on ? "1" : "0"); } catch { /* storage off */ } }
    }
    expandBtn.addEventListener("click", () => setExpanded(!panel.classList.contains("da-expanded")));
    // Restore the expanded choice (default: docked).
    try { if (localStorage.getItem(PANEL_EXPANDED_KEY) === "1") setExpanded(true, false); } catch { /* storage off */ }

    launcher.addEventListener("click", () => open());
    closeBtn.addEventListener("click", () => close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) close();
    });

    resetBtn.addEventListener("click", () => {
      if (gated) {
        client.freeChatGate.reset();
        gateStarted = false;
        turnstileToken = null;
        const ts = getTurnstile();
        if (ts && turnstileId !== null) ts.reset(turnstileId); // re-issue a fresh token
      } else {
        client.anonymousChat.reset();
      }
      lastBriefSig = null;          // a fresh thread has no current brief
      lastBriefWhitelabelId = "";
      messages.querySelectorAll(".da-msg").forEach((m, i) => {
        if (i > 0) m.remove(); // keep the greeting
      });
      messages.querySelectorAll(".da-handoff-actions").forEach((b) => b.remove());
      handoffBar.hidden = true; // no conversation to continue until one restarts
      handoffRestoreBtn.hidden = true;
      clearConversation();      // forget the persisted thread
      firstUserMessageSent = false; // next message re-injects page context
      client.anonymousChat.reset(); // forget the delegated-turn transcript too
      showSuggestions();        // bring the starter chips back
    });

    // renderMarkdown / renderInline / escapeHtml live in ./docs-assistant/pure
    // (imported above) so they're unit-tested in isolation. The render-boundary
    // XSS defense (escape-first, allowlist inline/block markup, http(s)-only
    // links) and the code-span-safe citation linkifier are documented there.

    // The visitor's public IP, fetched from Cloudflare's same-origin trace
    // endpoint. Used to build the user avatar — a deliberate, transparent signal
    // that this docs site tracks visitors by IP (rate limiting + abuse).
    let userIp = "";
    // ipAvatarHtml(userIp) lives in ./docs-assistant/pure (IPv4/IPv6 formatting).
    function refreshIpAvatars(): void {
      root.querySelectorAll<HTMLElement>(".da-ip-avatar .da-ip-octets").forEach((el) => {
        el.innerHTML = ipAvatarHtml(userIp);
      });
    }
    fetch("/cdn-cgi/trace")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const m = t.match(/(?:^|\n)ip=([^\n]+)/);
        if (m) { userIp = m[1].trim(); refreshIpAvatars(); }
      })
      .catch(() => { /* trace unavailable — avatars show the "IP" fallback */ });

    function makeAvatar(role: "user" | "assistant"): HTMLElement {
      if (role === "assistant") {
        const a = document.createElement("div");
        a.className = "da-avatar da-avatar--msg";
        a.innerHTML = '<img src="/favicon.png" alt="Divinci" width="28" height="28" />';
        return a;
      }
      // User avatar: the IP square (transparency signal) that on hover becomes a
      // "Sign up" link into the Divinci app. The IP octets stay visible at rest.
      const a = document.createElement("a");
      a.className = "da-avatar da-avatar--msg da-ip-avatar";
      a.href = signedIn ? loginUrl : signupUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = signedIn ? "Signed in to Divinci" : "Sign up for Divinci";
      a.innerHTML =
        `<span class="da-ip-octets">${ipAvatarHtml(userIp)}</span>` +
        `<span class="da-ip-signup">${signedIn ? "Signed in" : "Sign up"}</span>`;
      return a;
    }

    function addMessage(role: "user" | "assistant", text: string): HTMLElement {
      const wrap = document.createElement("div");
      wrap.className = `da-msg da-msg-${role}`;
      // Content column holds the bubble + (for the assistant) the sources
      // dropdown, so the avatar sits beside the whole column, not inline with it.
      const col = document.createElement("div");
      col.className = "da-msg-col";
      const bubble = document.createElement("div");
      bubble.className = "da-bubble";
      bubble.textContent = text;
      col.appendChild(bubble);
      // Robot on the left for the assistant; IP square on the right for the user.
      if (role === "assistant") { wrap.appendChild(makeAvatar(role)); wrap.appendChild(col); }
      else { wrap.appendChild(col); wrap.appendChild(makeAvatar(role)); }
      messages.appendChild(wrap);
      // User messages get the quick menu immediately (their text is final here).
      // Assistant menus attach after their markdown renders (see chatSend/restore).
      if (role === "user") attachMessageMenu(bubble, text);
      messages.scrollTop = messages.scrollHeight;
      return bubble;
    }

    // Scroll so `el` sits at the top of the messages viewport. Used after a send so
    // a long reply is read from its START (the question pinned to the top), instead
    // of the view jumping to the bottom — i.e. the END — of the answer.
    function scrollMessageToTop(el: HTMLElement): void {
      const top = el.getBoundingClientRect().top - messages.getBoundingClientRect().top + messages.scrollTop;
      messages.scrollTop = Math.max(0, top - 8);
    }

    function showTyping(): HTMLElement {
      const bubble = addMessage("assistant", "");
      bubble.classList.add("da-thinking");
      bubble.innerHTML = '<span class="da-typing"><i></i><i></i><i></i></span>';
      return bubble;
    }

    // ── Per-message quick actions (copy / read aloud / react) ────────────────
    // A hover toolbar mirroring the web app's message menu, but standalone for
    // the embeddable widget. The reusable LOGIC (speech-text stripping, reaction
    // keying + toggling, storage key) lives in ./docs-assistant/pure and is
    // unit-tested; only DOM wiring is here. Reactions are local-only (this
    // release's localStorage), per the anonymous docs widget's privacy posture.
    const REACTION_EMOJIS = ["👍", "❤️", "🎉", "🤔", "😄"];
    const ICON_COPY =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';
    const ICON_CHECK =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>';
    const ICON_SPEAK =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></svg>';
    const ICON_STOP_SOUND =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m22 9-6 6M16 9l6 6" /></svg>';

    const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
    let speakingBtn: HTMLButtonElement | null = null;
    // Platform-voice playback (Cloudflare Aura-2). Tracked alongside the
    // speechSynthesis state so stopping halts whichever one is running.
    let speakingAudio: HTMLAudioElement | null = null;
    function resetSpeakBtn(): void {
      if (speakingBtn) { speakingBtn.innerHTML = ICON_SPEAK; speakingBtn.setAttribute("aria-pressed", "false"); }
      speakingBtn = null;
    }
    function stopAllSpeech(): void {
      if (canSpeak) window.speechSynthesis.cancel();
      if (speakingAudio) {
        // Detach onerror BEFORE clearing src: assigning "" raises
        // MEDIA_ELEMENT_ERROR, and an onerror that falls back to the browser
        // voice would turn STOP into "start talking in a different voice".
        speakingAudio.onerror = null;
        speakingAudio.pause();
        speakingAudio.src = "";
        speakingAudio = null;
      }
      resetSpeakBtn();
    }

    /**
     * Speak a reply with the RELEASE's configured voice via
     * freeChatGate.speak(), which takes an index into the signed transcript —
     * the server will not synthesize caller-supplied text. Resolves false when
     * the platform voice is unavailable for any reason, so the caller falls
     * back to speechSynthesis rather than leaving a dead button.
     */
    async function playPlatformVoice(text: string, btn: HTMLButtonElement): Promise<boolean> {
      if (!gated) return false;
      let idx = -1;
      try {
        const t = client.freeChatGate.getTranscript();
        // Match on the rendered reply. lastIndexOf semantics: if the assistant
        // repeated itself, the most recent turn is the one on screen.
        for (let i = t.length - 1; i >= 0; i--) {
          if (t[i]?.response === text) { idx = i; break; }
        }
      } catch { return false; }
      if (idx < 0) return false;

      // Claim the element synchronously, inside the click's user activation:
      // synthesis takes seconds, and by the time it returns the activation has
      // expired, so play() would be rejected and the visitor would hear the
      // fallback instead of the voice we just paid for.
      const audio = new Audio();
      audio.src = SILENT_UNLOCK_WAV;
      const unlocked = audio.play().then(() => true).catch(() => false);
      speakingAudio = audio;
      speakingBtn = btn;
      btn.innerHTML = ICON_STOP_SOUND;
      btn.setAttribute("aria-pressed", "true");

      try {
        const { url } = await client.freeChatGate.speak(idx);
        if (speakingAudio !== audio) return true;   // stopped mid-flight
        await unlocked;
        if (speakingAudio !== audio) return true;
        audio.src = url;
        audio.onended = () => { if (speakingAudio === audio) { speakingAudio = null; resetSpeakBtn(); } };
        audio.onerror = () => {
          if (speakingAudio !== audio) return;
          speakingAudio = null;
          resetSpeakBtn();
          speakWithBrowser(text, btn);
        };
        await audio.play();
        return true;
      } catch {
        if (speakingAudio !== audio) return true;
        speakingAudio = null;
        resetSpeakBtn();
        return false;
      }
    }

    /** The fallback, and the only path for ungated releases. */
    function speakWithBrowser(text: string, btn: HTMLButtonElement): void {
      if (!canSpeak) return;
      const u = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
      u.onend = () => resetSpeakBtn();
      u.onerror = () => resetSpeakBtn();
      speakingBtn = btn;
      btn.innerHTML = ICON_STOP_SOUND;
      btn.setAttribute("aria-pressed", "true");
      window.speechSynthesis.speak(u);
    }

    // ── Header sound toggle (read replies aloud) ─────────────────────────────
    // Mirrors the divinci.ai release widget: one control that speaks each reply
    // as it lands. Defaults OFF — an unannounced voice on a docs page is
    // startling, and browsers block autoplay until a gesture regardless.
    const ICON_VOLUME_ON =
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
      + `<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
    const ICON_VOLUME_OFF =
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
      + `<path d="M11 5 6 9H2v6h4l5 4z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    const SOUND_PREF_KEY = `divinci-docs-sound:${releaseId}`;
    const soundBtn = document.getElementById("da-sound") as HTMLButtonElement | null;
    let soundOn = false;
    try { soundOn = localStorage.getItem(SOUND_PREF_KEY) === "1"; } catch { soundOn = false; }
    // The newest assistant reply and its per-message speak button. Auto-play
    // drives that button so the message's own icon shows the stop state and
    // clicking it stops playback — the header toggle stays a pure on/off.
    let lastReplyText = "";
    let lastSpeakBtn: HTMLButtonElement | null = null;
    // Guards against speaking one reply twice (restore, re-render, manual play).
    let lastSpokenText = "";

    function syncSoundBtn(): void {
      if (!soundBtn) return;
      // Hidden when there is no voice path at all: no speechSynthesis AND not
      // gated (the platform voice needs the signed-transcript endpoint).
      soundBtn.hidden = !(canSpeak || gated);
      soundBtn.innerHTML = soundOn ? ICON_VOLUME_ON : ICON_VOLUME_OFF;
      soundBtn.classList.toggle("da-sound-toggle--on", soundOn);
      soundBtn.setAttribute("aria-pressed", String(soundOn));
      soundBtn.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
      soundBtn.title = soundOn ? "Sound on — replies are read aloud" : "Read replies aloud";
    }

    /** Platform voice first, browser voice as the fallback. */
    async function speakReply(text: string, btn: HTMLButtonElement): Promise<void> {
      stopAllSpeech();
      if (await playPlatformVoice(text, btn)) return;
      speakWithBrowser(text, btn);
    }

    /** Speak the reply that just arrived, at most once, when sound is on. */
    function autoSpeakLatest(): void {
      if (!soundOn || !lastReplyText || !lastSpeakBtn) return;
      if (lastSpokenText === lastReplyText) return;
      lastSpokenText = lastReplyText;
      void speakReply(lastReplyText, lastSpeakBtn);
    }

    soundBtn?.addEventListener("click", () => {
      soundOn = !soundOn;
      try { localStorage.setItem(SOUND_PREF_KEY, soundOn ? "1" : "0"); }
      catch { /* private browsing — the preference just won't persist */ }
      syncSoundBtn();
      if (!soundOn) { stopAllSpeech(); return; }
      // Turning sound ON is the user gesture that makes playback legal. Speaking
      // the last reply here both gives immediate feedback and unlocks audio for
      // the replies that follow, which land too late to carry an activation of
      // their own.
      if (lastReplyText && lastSpeakBtn) {
        lastSpokenText = lastReplyText;
        void speakReply(lastReplyText, lastSpeakBtn);
      }
    });
    syncSoundBtn();

    function loadReactions(): Record<string, string> {
      try {
        const v = JSON.parse(localStorage.getItem(reactionsStorageKey(releaseId)) || "{}");
        return v && typeof v === "object" ? (v as Record<string, string>) : {};
      } catch { return {}; }
    }
    function saveReactions(map: Record<string, string>): void {
      try { localStorage.setItem(reactionsStorageKey(releaseId), JSON.stringify(map)); }
      catch { /* storage unavailable — reaction is just not persisted */ }
    }

    function renderReactionChip(col: HTMLElement, key: string): void {
      const emoji = loadReactions()[key];
      let chip = col.querySelector<HTMLButtonElement>(".da-reaction-chip");
      if (!emoji) { if (chip) chip.remove(); return; }
      if (!chip) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "da-reaction-chip";
        chip.title = "Remove reaction";
        chip.addEventListener("click", () => {
          const cur = loadReactions()[key];
          if (cur) { saveReactions(toggleReaction(loadReactions(), key, cur)); renderReactionChip(col, key); }
        });
        const bar = col.querySelector(".da-msg-actions");
        if (bar) bar.insertAdjacentElement("afterend", chip);
        else col.appendChild(chip);
      }
      chip.textContent = emoji;
    }

    function openEmojiPopover(anchor: HTMLElement, col: HTMLElement, key: string): void {
      // One popover at a time.
      root.querySelectorAll(".da-emoji-pop").forEach((p) => p.remove());
      const pop = document.createElement("div");
      pop.className = "da-emoji-pop";
      for (const emoji of REACTION_EMOJIS) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = emoji;
        b.setAttribute("aria-label", `React ${emoji}`);
        b.addEventListener("click", () => {
          saveReactions(toggleReaction(loadReactions(), key, emoji));
          renderReactionChip(col, key);
          pop.remove();
        });
        pop.appendChild(b);
      }
      anchor.parentElement?.appendChild(pop);
      // Dismiss on the next outside click.
      setTimeout(() => {
        const onDoc = (ev: MouseEvent) => {
          if (!pop.contains(ev.target as Node)) { pop.remove(); document.removeEventListener("click", onDoc); }
        };
        document.addEventListener("click", onDoc);
      }, 0);
    }

    function iconBtn(label: string, html: string): HTMLButtonElement {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "da-msg-action";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = html;
      return b;
    }

    // Attach the hover toolbar + any saved reaction to an assistant message.
    // `rawText` is the Markdown source (copy yields the original; speech reads a
    // stripped plain-text form). Idempotent per message column.
    /**
     * `isAssistantReply` marks the bubbles the header sound toggle may speak.
     * It is NOT the same as "has a menu" — user messages get a menu too, and
     * auto-speak must never read the visitor's own words back to them.
     */
    function attachMessageMenu(bubble: HTMLElement, rawText: string, isAssistantReply = false): void {
      const col = bubble.closest<HTMLElement>(".da-msg-col");
      if (!col || col.querySelector(".da-msg-actions")) return;
      const text = (rawText || "").trim();
      if (!text) return;
      const key = messageReactionKey(text);

      const bar = document.createElement("div");
      bar.className = "da-msg-actions";

      const copyBtn = iconBtn("Copy message", ICON_COPY);
      copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); copyBtn.innerHTML = ICON_CHECK; }
        catch { copyBtn.title = "Copy failed"; }
        setTimeout(() => { copyBtn.innerHTML = ICON_COPY; copyBtn.title = "Copy message"; }, 1500);
      });
      bar.appendChild(copyBtn);

      // A gated release can play the platform voice through <audio> even in a
      // webview with no speechSynthesis, so the button is offered when EITHER
      // path exists.
      if (canSpeak || gated) {
        const speakBtn = iconBtn("Read aloud", ICON_SPEAK);
        speakBtn.setAttribute("aria-pressed", "false");
        speakBtn.addEventListener("click", async () => {
          // Toggle: clicking the speaking message stops it.
          if (speakingBtn === speakBtn) { stopAllSpeech(); return; }
          // A manual play is also "already spoken" as far as the header
          // toggle is concerned, so turning sound on afterwards does not
          // immediately repeat this same reply.
          lastSpokenText = text;
          void speakReply(text, speakBtn);
        });
        bar.appendChild(speakBtn);
        // Remember the newest assistant reply so the header toggle has
        // something to speak, both on auto-play and when switched on mid-chat.
        if (isAssistantReply) { lastReplyText = text; lastSpeakBtn = speakBtn; }
      }

      const reactBtn = iconBtn("Add reaction", "🙂");
      reactBtn.classList.add("da-msg-action--emoji");
      reactBtn.addEventListener("click", (e) => { e.stopPropagation(); openEmojiPopover(reactBtn, col, key); });
      bar.appendChild(reactBtn);

      bubble.insertAdjacentElement("afterend", bar); // toolbar sits right under the bubble
      renderReactionChip(col, key);
    }

    // sourceTitle / sourceExcerpt live in ./docs-assistant/pure (imported above).

    // Visibly mark a turn whose answer was generated on the visitor's device
    // (delegated inference). Makes a local turn distinguishable from a release-
    // authored one — the release signed it as ACCEPTED, not as AUTHORED.
    function addOnDeviceBadge(bubble: HTMLElement): void {
      const col = bubble.closest<HTMLElement>(".da-msg") || bubble;
      if (col.querySelector(".da-ondevice")) return; // idempotent (re-render safe)
      const badge = document.createElement("div");
      badge.className = "da-ondevice";
      badge.title = "Generated on your device — private, and not authored by the assistant's cloud model.";
      badge.innerHTML = `<span aria-hidden="true">⚡</span><span>on-device</span>`;
      bubble.appendChild(badge);
    }

    function addSources(bubble: HTMLElement, context: SourceItem[]) {
      const items = (context || []).filter((c) => (c?.content || "").trim()).slice(0, 6);
      if (!items.length) return;
      const details = document.createElement("details");
      details.className = "da-sources";
      const summary = document.createElement("summary");
      summary.innerHTML =
        `<span class="da-sources-icon" aria-hidden="true">📚</span>` +
        `<span>${items.length} source${items.length > 1 ? "s" : ""}</span>`;
      details.appendChild(summary);
      const list = document.createElement("ol");
      list.className = "da-sources-list";
      items.forEach((item, i) => {
        const li = document.createElement("li");
        li.className = "da-source";
        // Index used to match the inline [N] citation markers (1-based).
        li.dataset.srcIndex = String(i + 1);
        const title = document.createElement("div");
        title.className = "da-source-title";
        // Numbered badge so the listed source visibly matches its [N] marker.
        const badge = document.createElement("span");
        badge.className = "da-source-num";
        badge.textContent = `[${i + 1}]`;
        title.appendChild(badge);
        const url = item.metadata?.url || item.metadata?.sourceUrl;
        if (url && /^https?:\/\//.test(url)) {
          const a = document.createElement("a");
          a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.textContent = sourceTitle(item, i);
          title.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.textContent = sourceTitle(item, i);
          title.appendChild(span);
        }
        const excerpt = document.createElement("p");
        excerpt.className = "da-source-excerpt";
        excerpt.textContent = sourceExcerpt(item.content || "");
        li.appendChild(title);
        li.appendChild(excerpt);
        list.appendChild(li);
      });
      details.appendChild(list);
      bubble.parentElement?.appendChild(details);
    }

    // Clicking an inline [N] citation expands that message's own sources section
    // and scrolls to source N (brief highlight). Scoped to the message the
    // citation belongs to (.da-msg-col) so multi-answer threads don't cross-link.
    function focusSource(citeEl: HTMLElement): void {
      const col = citeEl.closest<HTMLElement>(".da-msg-col");
      const details = col?.querySelector<HTMLDetailsElement>(".da-sources");
      if (!details) return;
      details.open = true;
      const n = citeEl.getAttribute("data-cite");
      const target =
        details.querySelector<HTMLElement>(`.da-source[data-src-index="${n}"]`) ||
        details.querySelector<HTMLElement>(".da-source");
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target.classList.remove("da-source-flash");
      void target.offsetWidth; // reflow so the flash animation restarts
      target.classList.add("da-source-flash");
    }
    messages.addEventListener("click", (e) => {
      const cite = (e.target as HTMLElement)?.closest?.(".da-cite") as HTMLElement | null;
      if (cite) { e.preventDefault(); focusSource(cite); }
    });
    messages.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const cite = (e.target as HTMLElement)?.closest?.(".da-cite") as HTMLElement | null;
      if (cite) { e.preventDefault(); focusSource(cite); }
    });

    // ── Conversation persistence ────────────────────────────────────────────
    // The widget lives on every docs page (and the agent itself can navigate the
    // user across pages), so each page load is a fresh mount. Persist the signed
    // transcript to localStorage and restore it on init so the conversation
    // survives navigation, panel collapse, and tab/browser close.
    const STORAGE_KEY = `divinci-docs-chat:${releaseId}`;
    const STORAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    type StoredMsg = { prompt?: string; response?: string; context?: SourceItem[]; provenance?: "cloud" | "local" };

    function saveConversation(): void {
      try {
        // Pick whichever namespace actually holds the conversation (don't rely on
        // `gated`, which resolves asynchronously).
        const fg = client.freeChatGate.getState();
        const state = fg.transcript.length ? fg : client.anonymousChat.getState();
        if (!state.transcript.length) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          transcript: state.transcript, signiture: state.signiture, ts: Date.now(),
          // Brief idempotency marker (so a reload doesn't regenerate an unchanged brief).
          ...(lastBriefSig ? { brief: { sig: lastBriefSig, whitelabelId: lastBriefWhitelabelId } } : {}),
        }));
      } catch { /* storage unavailable — non-fatal */ }
    }

    function clearConversation(): void {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    }

    const HANDOFF_SLIDE_MS = 280; // keep in sync with the .da-handoff-row transition
    let handoffSlideTimer: number | null = null;
    // Apply a state WITHOUT animation (initial restore from persistence): the bar
    // was display:none, so jump straight to the end state.
    function applyHandoffCollapsed(): void {
      if (handoffSlideTimer !== null) { clearTimeout(handoffSlideTimer); handoffSlideTimer = null; }
      handoffBar.classList.toggle("da-sliding", handoffCollapsed);
      handoffBar.classList.toggle("da-collapsed", handoffCollapsed);
      handoffBar.hidden = false;
      handoffRestoreBtn.hidden = !handoffCollapsed;
    }
    function setHandoffCollapsed(on: boolean): void {
      handoffCollapsed = on;
      try { localStorage.setItem(HANDOFF_COLLAPSED_KEY, on ? "1" : "0"); } catch { /* storage off */ }
      if (handoffSlideTimer !== null) { clearTimeout(handoffSlideTimer); handoffSlideTimer = null; }
      if (on) {
        handoffBar.classList.add("da-sliding"); // slide the buttons off + fade (animated)
        handoffRestoreBtn.hidden = false;        // restore tab appears as they tuck away
        // After the slide, close the height so the transcript reclaims the space.
        handoffSlideTimer = window.setTimeout(() => {
          handoffSlideTimer = null;
          if (handoffCollapsed) handoffBar.classList.add("da-collapsed");
        }, HANDOFF_SLIDE_MS);
      } else {
        handoffBar.classList.remove("da-collapsed"); // reclaim height instantly
        handoffRestoreBtn.hidden = true;
        // Next frame, slide the buttons back in (so the height is restored first).
        requestAnimationFrame(() => { if (!handoffCollapsed) handoffBar.classList.remove("da-sliding"); });
      }
    }
    handoffCollapseBtn.addEventListener("click", () => setHandoffCollapsed(true));
    handoffRestoreBtn.addEventListener("click", () => setHandoffCollapsed(false));

    // Only offer "Continue in the Divinci app" once the conversation is genuinely
    // underway — after the user's SECOND message. transcript length == number of
    // user turns (each entry is one prompt+response exchange).
    function maybeShowHandoff(): void {
      const len = Math.max(
        client.freeChatGate.getState().transcript.length,
        client.anonymousChat.getState().transcript.length,
      );
      if (len < 2) { handoffBar.hidden = true; handoffRestoreBtn.hidden = true; return; }
      applyHandoffCollapsed();
    }

    // Render a stored exchange into the panel (no execution — view only).
    function renderStoredMessage(m: StoredMsg): void {
      // A restored thread already has its first turn → no fresh context inject,
      // and the starters stay hidden. Strip the hidden context block so the
      // first user bubble shows the clean prompt, never the sentinel-wrapped one.
      firstUserMessageSent = true;
      hideSuggestions();
      if (m.prompt) addMessage("user", stripContext(m.prompt));
      const prepared = client.siteControl.prepare(m.response || "");
      const bubble = addMessage("assistant", "");
      const display = prepared.cleanedText || m.response || "";
      if (display) { bubble.classList.add("da-md"); bubble.innerHTML = renderMarkdown(display); }
      if (m.context?.length) addSources(bubble, m.context);
      if (m.provenance === "local") addOnDeviceBadge(bubble);
      // Marked as a reply so a later sound-on has something to speak, but
      // autoSpeakLatest() is deliberately NOT called here: restoring a
      // conversation must not start narrating history on page load.
      if (display) attachMessageMenu(bubble, display, true);
    }

    // Restore on init: hydrate the SDK (so send() continues the thread) + re-render.
    function restoreConversation(): void {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as {
          transcript?: StoredMsg[]; signiture?: string; ts?: number;
          brief?: { sig?: string; whitelabelId?: string };
        };
        if (!saved?.transcript?.length) return;
        if (saved.ts && Date.now() - saved.ts > STORAGE_MAX_AGE_MS) { clearConversation(); return; }
        // `gated` isn't resolved yet at init, so hydrate BOTH namespaces — the
        // one actually used (post loadGateConfig) will have the right state.
        const hydrate = (ns: unknown) =>
          (ns as { hydrate: (t: unknown, s: string) => void }).hydrate(saved.transcript!, saved.signiture || "");
        hydrate(client.freeChatGate);
        hydrate(client.anonymousChat);
        for (const m of saved.transcript) renderStoredMessage(m);
        // If the latest turn is a still-current brief, restore its action bar
        // (copy / download / MCP) and the idempotency marker — so a reload neither
        // loses the handoff actions nor regenerates the unchanged brief.
        if (saved.brief?.sig && saved.brief.sig === saved.signiture) {
          lastBriefSig = saved.brief.sig;
          lastBriefWhitelabelId = saved.brief.whitelabelId || "";
          const lastMsg = saved.transcript[saved.transcript.length - 1];
          appendHandoffActions((lastMsg?.response || "").trim(), lastBriefWhitelabelId);
        }
        maybeShowHandoff(); // only if >= 2 user messages
      } catch { /* corrupt/unavailable — start fresh */ }
    }

    restoreConversation();

    // Open the dock by default on first visit; after that honor the user's saved
    // open/closed choice. Auto-open does NOT focus the input (avoids scroll-jacking
    // the page on load); clicking the launcher focuses as usual.
    const savedOpen = (() => { try { return localStorage.getItem(PANEL_OPEN_KEY); } catch { return null; } })();
    const defaultOpen = options.app?.defaultOpen ?? true;
    if (savedOpen === null ? defaultOpen : savedOpen === "1") open(false);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const prompt = input.value.trim();
      if (!prompt || busy) return;

      busy = true;
      inflight = new AbortController();
      setSendMode("stop"); // the send button becomes a Stop button while running
      input.value = "";
      hideSuggestions(); // starters disappear once the conversation begins
      const userMsg = addMessage("user", prompt).closest<HTMLElement>(".da-msg");
      const typing = showTyping();
      // Pin the question to the top so the (often long) answer renders below it and
      // is read from the start — not auto-scrolled to its end.
      if (userMsg) scrollMessageToTop(userMsg);

      // Front-load page context ONCE, behind the scenes: the displayed bubble
      // shows the user's clean prompt (above), but the LLM receives the prompt
      // prefixed with the page context on the very first turn.
      const sentPrompt = !firstUserMessageSent && pageContext ? wrapWithContext(pageContext, prompt) : prompt;
      firstUserMessageSent = true;

      try {
        // Live token stream (on-device / local turns only — the cloud path is
        // request/response and never calls this). Render plain text as deltas
        // arrive; the final pass below re-renders as markdown + sources + menu.
        let streamed = "";
        const onToken = (delta: string): void => {
          streamed += delta;
          typing.classList.remove("da-thinking");
          typing.textContent = streamed;
          if (userMsg) scrollMessageToTop(userMsg);
        };
        const { reply, context, provenance } = await chatSend(sentPrompt, inflight.signal, onToken);
        // Site Control (v1.4d): strip any divinci-action block from the display
        // text; if the assistant proposed a valid navigation, run it after a
        // beat so the user reads the message first. prepare() is pure (no nav);
        // process() performs the navigation (location.assign on this MPA).
        const prepared = client.siteControl.prepare(reply);
        const display = prepared.cleanedText || reply;
        if (display) {
          typing.classList.add("da-md");
          typing.innerHTML = renderMarkdown(display);
        } else {
          typing.textContent = "Sorry, I couldn't generate a reply.";
        }
        if (context?.length) addSources(typing, context);
        if (provenance === "local") addOnDeviceBadge(typing);
        if (display) attachMessageMenu(typing, display, true);
        autoSpeakLatest(); // no-op unless the header sound toggle is on
        // Re-pin the question to the top now the full answer is in, so it's
        // readable from the beginning (the answer fills the space below it).
        if (userMsg) scrollMessageToTop(userMsg);
        setLive("true"); // a successful round-trip proves the AI is live
        maybeShowHandoff();        // offer continue-in-app only after the 2nd user message
        saveConversation();        // persist so it survives navigation / reload / tab close
        if (prepared.actions.some((a) => a.valid && a.descriptor.category === "navigation")) {
          setTimeout(() => { void client.siteControl.process(reply); }, 900);
        }
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)) || "";
        // User pressed Stop → the fetch was aborted. Not an error: show a quiet
        // "Stopped." and keep the live indicator as-is (the backend was reachable).
        if ((err instanceof Error && err.name === "AbortError") || inflight?.signal.aborted) {
          typing.classList.remove("da-thinking");
          typing.classList.add("da-stopped");
          typing.textContent = "Stopped.";
          return; // finally still runs (restores send mode, re-enables input)
        }
        // Off-topic / harmful moderation block (HTTP 400) → a friendly scope
        // message instead of a scary error. The release is scoped to the SDK
        // docs (onTopic.minimumContext ≥ 1), so off-topic questions land here.
        // Classifier lives in ./docs-assistant/pure (unit-tested).
        const { offTopic: isOffTopic, harmful: isHarmful } = classifyModerationError(err);
        if (msg.includes("turnstile-pending")) {
          // Token not ready yet (panel opened a beat ago) — re-arm + retry.
          typing.textContent = "Finishing a quick security check — please send that again.";
          void ensureTurnstileRendered();
          setLive("false");
        } else if (/gate not enabled/i.test(msg)) {
          typing.textContent = "The assistant is being set up. Please try again shortly.";
          setLive("false");
        } else if (isHarmful) {
          typing.textContent = "I can't help with that request — but ask me anything about the Divinci SDK.";
          setLive("true"); // a moderation block means the backend answered
        } else if (isOffTopic) {
          typing.textContent =
            "I only answer questions about the Divinci SDK — the Client, Server, MCP, CLI, and embed docs. Try asking about one of those.";
          setLive("true"); // a moderation block means the backend answered
        } else if (isRateLimitError(err)) {
          // Free docs-chat allowance used up (per-IP velocity cap or per-device
          // monthly quota). Backend is reachable — upsell a Divinci account for
          // more usage + features rather than a scary error. Built with safe DOM
          // (textContent + http(s)-guarded href), never innerHTML.
          typing.classList.add("da-md");
          typing.textContent = "You've used up the free documentation questions for now. ";
          if (!signedIn) {
            const loginLink = document.createElement("a");
            loginLink.href = /^https?:\/\//i.test(loginUrl) ? loginUrl : "#";
            loginLink.textContent = "Log in to your Divinci account";
            loginLink.addEventListener("click", (clickEv) => {
              clickEv.preventDefault();
              void connectHostSessionPopup().then((token) => {
                if (!token) return;
                applyHostToken(token);
                typing.textContent = "You're signed in — send your question again.";
              });
            });
            typing.appendChild(loginLink);
            typing.appendChild(document.createTextNode(" or "));
          }
          const signupLink = document.createElement("a");
          signupLink.href = /^https?:\/\//i.test(signupUrl) ? signupUrl : "#";
          signupLink.target = "_blank";
          signupLink.rel = "noopener noreferrer";
          signupLink.textContent = signedIn ? "continue in the Divinci app" : "create a free Divinci account";
          typing.appendChild(signupLink);
          typing.appendChild(document.createTextNode(
            signedIn
              ? " for more — plus saved chat history."
              : " for many more — plus your own AI assistants, saved chat history, and more.",
          ));
          setLive("true"); // reachable; a limit, not an outage
        } else {
          typing.textContent =
            "Something went wrong reaching the docs assistant. Please try again.";
          setLive("false");
        }
        // eslint-disable-next-line no-console
        console.error("[docs-assistant]", err);
      } finally {
        // Drop the thinking-indicator class once the result is in. It's
        // `display:inline-flex`; leaving it on the now-rendered bubble made the
        // markdown block children (<p>/<h*>/<ul>) lay out as flex-ROW items —
        // i.e. broken horizontal columns. The bubble must be a normal block to
        // stack its content (restored messages never get this class, which is
        // why only freshly-sent replies broke).
        typing.classList.remove("da-thinking");
        busy = false;
        inflight = null;
        setSendMode("send");
        // NOTE: deliberately NOT scrolling to the bottom here — the success path
        // pins the question to the top so the answer reads from its start.
        input.focus();
      }
    });
    // Conversation starters: clicking a chip drops its message into the input
    // and submits through the normal path (so first-turn context injection,
    // gating, and persistence all apply identically to a typed message).
    if (suggestionsEl) {
      suggestionsEl.querySelectorAll<HTMLButtonElement>(".da-suggestion").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (busy) return;
          const msg = btn.dataset.message || "";
          if (!msg) return;
          input.value = msg;
          form.requestSubmit();
        });
      });
    }
  // ─── end relocated logic ───────────────────────────────────────────────────

  return {
    open: () => open(false),
    close: () => close(),
    reset: () => resetBtn.click(),
    destroy: () => { root.remove(); },
  };
}
