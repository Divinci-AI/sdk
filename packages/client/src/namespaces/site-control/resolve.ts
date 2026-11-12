/**
 * Site Control (v1.4d) — client-side parse + validate of `divinci-action`
 * directives the deployed assistant emits. Pure (no DOM). Mirrors the server's
 * @divinci-ai/models parse + validation, reimplemented here so the client SDK
 * stays free of an `@divinci-ai/models` dependency.
 *
 * SECURITY: the assistant's reply is UNTRUSTED. We (1) re-validate every
 * directive's name against the descriptors the client fetched from the server
 * (`getConfig().siteActions`), (2) validate params against the descriptor
 * (declared-only; `enum` params must be a listed value), and (3) drop anything
 * that fails. A directive is a proposal, never self-authorizing.
 */
import type { SiteActionDescriptor } from "../free-chat-gate/index.js";

export interface ParsedSiteAction {
  name: string;
  params: Record<string, unknown>;
}

export interface ResolvedSiteAction {
  descriptor: SiteActionDescriptor;
  /** Params filtered to the descriptor's declared, valid fields. */
  params: Record<string, unknown>;
  /** Whether the directive passed name + param validation. */
  valid: boolean;
  /** Why it was rejected, when !valid. */
  reason?: string;
}

export interface PreparedReply {
  /** The reply with every `divinci-action` block removed — what to display. */
  cleanedText: string;
  /** Resolved directives in document order (validity flagged, not yet executed). */
  actions: ResolvedSiteAction[];
}

const MAX_ACTIONS_PER_REPLY = 3;
const DIRECTIVE_RE = /```[ \t]*divinci-action[ \t]*\r?\n([\s\S]*?)```/gi;

/** Extract `divinci-action` blocks; strip them from the display text. Pure. */
export function parseSiteActionDirectives(
  text: string | undefined | null,
): { actions: ParsedSiteAction[]; cleanedText: string } {
  if (!text) return { actions: [], cleanedText: typeof text === "string" ? text : "" };

  const cleanedText = text.replace(DIRECTIVE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const actions: ParsedSiteAction[] = [];

  DIRECTIVE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIRECTIVE_RE.exec(text)) !== null) {
    if (actions.length >= MAX_ACTIONS_PER_REPLY) break;
    const body = (m[1] || "").trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const params =
      obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : {};
    actions.push({ name, params });
  }

  return { actions, cleanedText };
}

/**
 * A navigation target MUST be a same-origin root-relative path. Rejects
 * absolute URLs, `javascript:`/`data:`/`vbscript:` schemes (XSS), external
 * hosts (open redirect), and protocol-relative `//host` / backslash tricks.
 * This is the primary, environment-agnostic guard; navigate() adds a runtime
 * same-origin backstop. Pure.
 */
export function isSafeNavRoute(route: unknown): route is string {
  if (typeof route !== "string") return false;
  if (route === "/") return true;
  // Must start with a single "/" followed by a non-slash, non-backslash char.
  // "/foo" ✓ ; "//evil.com" ✗ ; "/\evil" ✗ ; "javascript:x" ✗ ; "https://x" ✗
  return /^\/[^/\\]/.test(route);
}

/**
 * Validate a parsed directive against its descriptor: declared-fields-only +
 * `enum` enforcement + required-present + (for navigate targets) a safe
 * same-origin route path. Returns the filtered params + verdict.
 */
export function validateActionParams(
  descriptor: SiteActionDescriptor,
  rawParams: Record<string, unknown>,
): { params: Record<string, unknown>; valid: boolean; reason?: string } {
  const out: Record<string, unknown> = {};
  for (const p of descriptor.parameters) {
    const v = rawParams[p.name];
    if (v === undefined || v === null) {
      if (p.required) return { params: out, valid: false, reason: `missing required param "${p.name}"` };
      continue;
    }
    // enum-constrained params must be a listed value (untrusted-output gate).
    if (p.enum && p.enum.length && !p.enum.includes(String(v))) {
      return { params: out, valid: false, reason: `param "${p.name}"="${String(v)}" not in allowed values` };
    }
    out[p.name] = v; // declared-only: undeclared keys in rawParams are dropped
  }
  // Navigation safety: the route MUST be a same-origin path, independent of
  // whether the descriptor declared an enum (defense-in-depth vs XSS/redirect).
  if (descriptor.target.kind === "navigate" && !isSafeNavRoute(out.route)) {
    return { params: out, valid: false, reason: "navigation route is not a safe same-origin path" };
  }
  return { params: out, valid: true };
}

/**
 * Parse a reply + resolve each directive against the known descriptors. Pure —
 * does NOT execute. The caller (SiteControlNamespace) runs handlers / navigation.
 */
export function prepareReply(
  text: string | undefined | null,
  descriptors: SiteActionDescriptor[],
): PreparedReply {
  const byName = new Map(descriptors.map((d) => [d.name, d]));
  const { actions: parsed, cleanedText } = parseSiteActionDirectives(text);
  const actions: ResolvedSiteAction[] = [];
  for (const d of parsed) {
    const descriptor = byName.get(d.name);
    if (!descriptor) continue; // UNKNOWN NAME → drop (untrusted-output gate)
    const v = validateActionParams(descriptor, d.params);
    actions.push({ descriptor, params: v.params, valid: v.valid, reason: v.reason });
  }
  return { cleanedText, actions };
}
