/**
 * Cross-origin session handshake between the docs widget (sdk.divinci.ai)
 * and the signed-in web app (chat.divinci.app).
 *
 * chat.divinci.app and sdk.divinci.ai are different eTLDs (.app vs .ai), so
 * they cannot share cookies. The web app stores the Auth0 access token in
 * localStorage; a tiny first-party page there postMessages it to an
 * allowlisted parent/opener. Pure helpers live here so the origin check
 * and message shape can be unit-tested without a DOM.
 */

export const DOCS_SESSION_MESSAGE_TYPE = "divinci-docs-session";
export const DOCS_SESSION_PATH = "/docs-assistant-session";

const TRUSTED_CHAT_HOST = /^(chat(\.[a-z0-9-]+)?\.divinci\.app|localhost|127\.0\.0\.1)$/i;

/** Hosts of OUR docs site — the only pages that may request a chat session. */
const FIRST_PARTY_DOCS_ORIGINS = new Set([
  "https://sdk.divinci.ai",
  "https://divinci-sdk-docs-staging.divinci-ai.workers.dev",
]);

/**
 * Whether this page is allowed to probe chat.divinci.app for a session.
 * Third-party sites that embed the widget must never do that — it would
 * read the visitor's Divinci Auth0 token just because they have the app
 * open in another tab.
 */
export function isFirstPartyDocsParentOrigin(origin: string): boolean {
  if (FIRST_PARTY_DOCS_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return local && (u.port === "4321" || u.port === "");
  } catch {
    return false;
  }
}

export function isTrustedChatOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (local) return u.protocol === "http:" || u.protocol === "https:";
    return u.protocol === "https:" && TRUSTED_CHAT_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export type DocsSessionMessage =
  | { type: typeof DOCS_SESSION_MESSAGE_TYPE; authenticated: true; token: string }
  | { type: typeof DOCS_SESSION_MESSAGE_TYPE; authenticated: false };

export function parseDocsSessionMessage(data: unknown): DocsSessionMessage | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (rec.type !== DOCS_SESSION_MESSAGE_TYPE) return null;
  if (rec.authenticated === true && typeof rec.token === "string" && rec.token.length > 0) {
    return { type: DOCS_SESSION_MESSAGE_TYPE, authenticated: true, token: rec.token };
  }
  if (rec.authenticated === false) {
    return { type: DOCS_SESSION_MESSAGE_TYPE, authenticated: false };
  }
  return null;
}

export function docsSessionUrl(webAppUrl: string, parentOrigin?: string): string {
  const base = webAppUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${DOCS_SESSION_PATH}`);
  if (
    parentOrigin &&
    isFirstPartyDocsParentOrigin(parentOrigin) &&
    isTrustedChatOrigin(new URL(webAppUrl).origin)
  ) {
    url.searchParams.set("origin", parentOrigin);
  }
  return url.toString();
}
