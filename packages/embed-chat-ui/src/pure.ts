/**
 * Pure, dependency-free helpers for the "Ask Divinci" docs widget
 * (DocsAssistant.astro). Extracted so they can be unit-tested in isolation —
 * the widget body is one large inline <script> that can't be imported.
 *
 * Nothing here touches the DOM, network, or globals.
 */

export interface SourceItem {
  content?: string;
  metadata?: {
    originalName?: string;
    title?: string;
    url?: string;
    sourceUrl?: string;
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bold, links, and [N] citation chips — applied ONLY to non-code text. */
function renderInlineOutsideCode(text: string): string {
  return (
    text
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      // Inline citation markers — single [2] OR grouped [1, 5] / [1,5,9]. Each
      // NUMBER becomes its own clickable chip; brackets + commas stay plain text.
      .replace(/\[\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\]/g, (group) =>
        group.replace(
          /\d{1,3}/g,
          (n) =>
            `<a class="da-cite" role="button" tabindex="0" data-cite="${n}" title="Jump to source ${n}">${n}</a>`,
        ),
      )
  );
}

/**
 * Render inline markdown on an ALREADY-HTML-ESCAPED string. Inline-code spans
 * (`like this`) are emitted as <code> verbatim and NEVER processed for bold,
 * links, or citation chips — so a code example such as `argv[1]` or `items[2]`
 * is not mangled into a citation chip. (Backticks survive escapeHtml.)
 */
export function renderInline(escapedText: string): string {
  return escapedText
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.length >= 2 && part.startsWith("`") && part.endsWith("`")
        ? `<code>${part.slice(1, -1)}</code>`
        : renderInlineOutsideCode(part),
    )
    .join("");
}

/** Minimal block-level markdown: headings (clamped h3–h5), ul/ol, paragraphs. */
export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split(/\r?\n/);
  let html = "";
  let listType: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    // Fence lines are no-ops; inline `code` is handled by renderInline.
    if (/^\s*```/.test(line)) {
      closeList();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[*-]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(5, Math.max(3, heading[1].length + 2));
      html += `<h${level}>${renderInline(heading[2])}</h${level}>`;
    } else if (bullet) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${renderInline(bullet[1])}</li>`;
    } else if (ordered) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${renderInline(ordered[2])}</li>`;
    } else {
      closeList();
      if (line.trim()) html += `<p>${renderInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

/**
 * Build the inner HTML for the user's IP-address avatar. IPv4 stacks 4
 * zero-padded octets; IPv6 stacks the last 3 hex groups (most identifying);
 * anything else falls back to "IP".
 */
export function ipAvatarHtml(userIp: string): string {
  if (!userIp) return '<span class="da-ip-q">IP</span>';
  if (userIp.includes(":")) {
    const groups = userIp.split(":").filter(Boolean).slice(-3);
    if (groups.length) {
      return groups.map((g) => `<span>${g.toUpperCase().slice(0, 4)}</span>`).join("");
    }
    return '<span class="da-ip-q">IP</span>';
  }
  const octets = userIp.split(".");
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    return octets.map((o) => `<span>${o.padStart(3, "0")}</span>`).join("");
  }
  return '<span class="da-ip-q">IP</span>';
}

/** A readable title for a source — metadata name/title, else first heading/line. */
export function sourceTitle(item: SourceItem, index: number): string {
  const m = item.metadata || {};
  const fromMeta = (m.originalName || m.title || "").trim();
  // Skip opaque ids (hex object-ids, chunk keys) — they're not readable.
  const looksLikeId = /^[a-f0-9]{16,}$/i.test(fromMeta) || /[a-f0-9]{24}/i.test(fromMeta);
  if (fromMeta && !looksLikeId) return fromMeta.replace(/\.(md|mdx|html?|txt|pdf)$/i, "");
  const firstHeading = (item.content || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^#{1,6}\s+/.test(l));
  if (firstHeading) return firstHeading.replace(/^#{1,6}\s+/, "").slice(0, 80);
  const firstLine = ((item.content || "").trim().split(/\r?\n/)[0] || "")
    .replace(/[#*`>]/g, "")
    .trim();
  if (firstLine) return firstLine.slice(0, 80);
  return fromMeta || `Source ${index + 1}`;
}

/** A short, plain-text excerpt — strip markdown noise for the sources dropdown. */
export function sourceExcerpt(content: string): string {
  const clean = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
}

// ── Message quick-actions (copy / speak / react) ───────────────────────────
// These power the per-message hover menu. They are intentionally pure + DOM-free
// so they can graduate into a shared Divinci-SDK widget package once a second
// docs site consumes them (see the open-source-readiness note). The DOM wiring
// stays in DocsAssistant.astro; the logic that's worth testing lives here.

/**
 * Flatten Markdown to plain prose for speech synthesis (SpeechSynthesisUtterance
 * reads punctuation/symbols literally, so `**bold**` becomes "asterisk asterisk
 * bold…"). Drops code fences, images, list/heading/emphasis markers, link URLs
 * (keeps the text), and inline [N] citation markers — leaving readable speech.
 */
export function stripMarkdownForSpeech(src: string): string {
  return (src || "")
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks — unreadable aloud
    .replace(/`([^`]+)`/g, "$1") // inline code → its text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "") // [1] / [1, 5] citation markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // ATX headings
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s{0,3}>\s?/gm, "") // blockquote markers
    .replace(/[*_~]/g, "") // emphasis/strikethrough punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/** localStorage key for this release's per-message reaction map. */
export function reactionsStorageKey(releaseId: string): string {
  return `divinci-docs-reactions:${releaseId}`;
}

/**
 * Stable, content-derived key for a message (djb2 → base36). Keying reactions by
 * content rather than transcript index means they survive re-render, restore,
 * and navigation without index bookkeeping. Collisions between two identical
 * messages are acceptable for a docs widget.
 */
export function messageReactionKey(text: string): string {
  let h = 5381;
  const s = text || "";
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Toggle a reaction in an immutable map: setting the same emoji that's already
 * present clears it (so a second tap removes the reaction). Returns a new map.
 */
export function toggleReaction(
  map: Record<string, string>,
  key: string,
  emoji: string,
): Record<string, string> {
  const next = { ...map };
  if (next[key] === emoji) delete next[key];
  else next[key] = emoji;
  return next;
}

export interface ModerationClass {
  offTopic: boolean;
  harmful: boolean;
}

/**
 * Classify a failed chat-send as an off-topic / harmful moderation block. The
 * server rejects those with HTTP 400 whose body carries
 * errors:[{type:"on topic"|"harmful"}]. The widget only ever sends well-formed
 * requests, so a bare 400 is treated as off-topic (the SDK release is scoped to
 * the docs via onTopic.minimumContext).
 */
export function classifyModerationError(err: unknown): ModerationClass {
  const e = err as {
    message?: string;
    status?: number;
    details?: { errors?: Array<{ type?: string }> };
  };
  const msg = (e?.message ?? String(err)) || "";
  const modErrors = Array.isArray(e?.details?.errors) ? e.details!.errors! : [];
  const harmful = modErrors.some((x) => /harm/i.test(x?.type ?? ""));
  const offTopic =
    modErrors.some((x) => /on.?topic/i.test(x?.type ?? "")) ||
    /off.?topic/i.test(msg) ||
    (e?.status === 400 && !harmful);
  return { offTopic, harmful };
}

/**
 * Classify a failed chat-send as a rate-limit / quota-exhaustion (HTTP 429):
 * the visitor used up the free documentation-chat allowance (the per-IP
 * velocity cap or the per-device monthly quota). The backend is reachable —
 * the visitor has simply hit the free ceiling — so the widget upsells a Divinci
 * account ("more usage + features") instead of showing a scary error.
 */
export function isRateLimitError(err: unknown): boolean {
  const e = err as { message?: string; status?: number };
  const msg = (e?.message ?? String(err)) || "";
  return e?.status === 429 || /too many requests|rate.?limit|\b429\b|quota/i.test(msg);
}

// ---- On-device routing (Divinci Local Inference extension) ------------------
// When the extension injects window.divinci, the widget can route chat to the
// local Gemma model instead of the cloud release. Controlled by BOTH the release
// admin (policy) and the end-user (a header toggle).
//   - off:      never use local (no toggle shown).
//   - fallback: local-first when the extension is present + the user keeps the
//               toggle on; falls back to the cloud release on local error.
//   - prefer:   local-only when present (no cloud fallback; surfaces errors).
export type LocalModelPolicy = "off" | "fallback" | "prefer";

export function normalizeLocalPolicy(v: unknown): LocalModelPolicy {
  return v === "off" || v === "prefer" || v === "fallback" ? v : "fallback";
}

/** Whether to surface the on-device toggle, and its default state. */
export function localToggleState(
  policy: LocalModelPolicy,
  extAvailable: boolean,
  storedPref: boolean | null,
): { show: boolean; on: boolean } {
  if (policy === "off" || !extAvailable) return { show: false, on: false };
  // Local-first: default ON; the user's stored choice wins when set.
  const on = storedPref == null ? true : storedPref;
  return { show: true, on };
}

/** The actual per-turn routing decision. */
export function shouldRouteLocal(policy: LocalModelPolicy, extAvailable: boolean, userOn: boolean): boolean {
  if (policy === "off" || !extAvailable) return false;
  return userOn;
}

/** On a local-route failure, may we fall back to the cloud release? */
export function localFallbackAllowed(policy: LocalModelPolicy): boolean {
  return policy === "fallback";
}
