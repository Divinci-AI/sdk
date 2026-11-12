/**
 * Auth0 OAuth PKCE flow for CLI login
 *
 * Uses Authorization Code + PKCE with a localhost callback server.
 * No new npm dependencies — uses node:http, node:crypto, node:child_process.
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import { execFile } from "node:child_process";

/**
 * Auth0 configuration per API environment
 */
interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
}

/**
 * Auth0 configurations per environment.
 * Values can be overridden via environment variables:
 *   DIVINCI_AUTH0_DOMAIN, DIVINCI_AUTH0_CLIENT_ID, DIVINCI_AUTH0_AUDIENCE
 */
const AUTH0_CONFIGS: Record<string, Auth0Config> = {
  "https://api.divinci.app": {
    // Production runs in its own Auth0 tenant (divinci-prod), NOT the dev tenant.
    // Client is the "Local-Prod" SPA; audience is :8080 (matches Infisical prod AUTH0_AUDIENCE).
    domain: process.env.DIVINCI_AUTH0_DOMAIN || "divinci-prod.us.auth0.com",
    clientId: process.env.DIVINCI_AUTH0_CLIENT_ID || "vVWQlZ4rsYwVuSZI4jIjeW0JIiNMDIW1",
    audience: process.env.DIVINCI_AUTH0_AUDIENCE || "chat.divinci.app:8080",
  },
  "https://api.stage.divinci.app": {
    domain: "divinci-staging.us.auth0.com",
    clientId: "i3mzTidClOWxYPdjo8wd4cdMbwmKt6BJ",
    audience: "chat.stage.divinci.app:8080",
  },
  "https://api.dev.divinci.app": {
    // The dev tenant's API identifier really is the literal string
    // "http://localhost:8081". It looks like a local-development value that
    // leaked into a deployed environment, and it was read that way on
    // 2026-08-12 — wrongly. It is what the dev SERVER validates (Infisical dev
    // AUTH0_AUDIENCE), what the dev tenant ISSUES (see the real token in
    // workspace/clients/playwright/.auth/user.json: aud includes
    // "http://localhost:8081", iss dev-46tiys6hnb6vbg17), and therefore what the
    // dev web client and the E2E suite already run on. Server, tenant and web
    // client agreed; only this file did not. "Fixing" the server to match this
    // file would have broken the dev web client and every E2E run against dev.
    domain: "dev-46tiys6hnb6vbg17.us.auth0.com",
    clientId: "waO2KMbVwo3xXu1wqZyUeLA1cTinVpXx",
    audience: "http://localhost:8081",
  },
};

/**
 * Thrown when `--api-url` names a host this CLI has no Auth0 config for.
 */
export class UnknownApiUrlError extends Error {
  constructor(apiUrl: string) {
    super(
      `Unknown API URL: ${apiUrl}\n\n` +
      `Refusing to authenticate against an unrecognized host. Doing so would mint a\n` +
      `real PRODUCTION access token and send it there — so a typo, or a command\n` +
      `pasted from somewhere untrusted, would hand over your credentials.\n\n` +
      `Known hosts:\n` +
      Object.keys(AUTH0_CONFIGS).map((u) => `  ${u}`).join("\n") + "\n\n" +
      `For a custom or self-hosted deployment, set ALL THREE of:\n` +
      `  DIVINCI_AUTH0_DOMAIN\n  DIVINCI_AUTH0_CLIENT_ID\n  DIVINCI_AUTH0_AUDIENCE\n`,
    );
    this.name = "UnknownApiUrlError";
  }
}

/**
 * Resolve the Auth0 tenant for an API URL.
 *
 * This used to fall back to PRODUCTION for any unrecognized URL. That is a
 * credential-exfiltration path, not a convenience: `--api-url https://evil.test`
 * would authenticate against the real production tenant and then send the
 * resulting production access token to whatever host was named. A typo does the
 * same thing by accident.
 *
 * The earlier contract test asserted the fallback was correct, reasoning only
 * about WHICH tenant it fell back to (prod, not dev) and never about whether
 * falling back at all was safe. It was not.
 *
 * Unknown hosts are now refused, with one deliberate escape hatch: setting all
 * three DIVINCI_AUTH0_* variables. Requiring all three is the point — a partial
 * override is how you end up authenticating against one environment for a
 * different one, which is the exact failure this file has already shipped once.
 */
export function getAuth0Config(apiUrl: string): Auth0Config {
  const known = AUTH0_CONFIGS[apiUrl];
  if (known) return known;

  const domain = process.env.DIVINCI_AUTH0_DOMAIN;
  const clientId = process.env.DIVINCI_AUTH0_CLIENT_ID;
  const audience = process.env.DIVINCI_AUTH0_AUDIENCE;
  if (domain && clientId && audience) return { domain, clientId, audience };

  throw new UnknownApiUrlError(apiUrl);
}

/**
 * Non-throwing variant for diagnostics and telemetry.
 *
 * `divinci bug-report` and the error beacon both run on paths where the config
 * is often exactly what is broken — a command that dies while reporting why a
 * command died is worse than useless. They get `undefined` and report "custom"
 * rather than an exception.
 */
export function tryGetAuth0Config(apiUrl: string): Auth0Config | undefined {
  try {
    return getAuth0Config(apiUrl);
  } catch {
    return undefined;
  }
}

/**
 * Generate PKCE code_verifier and code_challenge
 */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // RFC 7636: code_verifier is 43-128 chars of [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

/**
 * Preferred callback ports. Auth0 requires exact redirect_uri matches,
 * so these must be registered in Auth0's allowed callback URLs.
 * We try each in order until one is available.
 */
const CALLBACK_PORTS = [8666, 8667, 8668];

/**
 * Start a temporary HTTP server on 127.0.0.1 to receive the OAuth callback.
 * Tries preferred ports first (must be registered in Auth0), falls back to
 * random port for local development with http://localhost/callback registered.
 *
 * @param expectedState - The CSRF state parameter to validate on callback
 */
export async function startCallbackServer(expectedState: string): Promise<{
  port: number;
  codePromise: Promise<string>;
  server: http.Server;
}> {
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      const returnedState = url.searchParams.get("state");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        // The interpolated value is the OAuth provider's error text, escaped by
        // escapeHtml() below and rendered as element text (never an attribute,
        // URL, or script context), so it cannot break out of the <p>. Semgrep's
        // raw-html-format rule flags any interpolation into a hand-built HTML
        // string and cannot see through the helper.
        res.end(
          // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
          "<html><body><h2>Login Failed</h2>" +
          `<p>${escapeHtml(errorDescription ?? error)}</p>` +
          "<p>You can close this window.</p></body></html>"
        );
        rejectCode(new Error(errorDescription ?? error));
        return;
      }

      // Validate CSRF state parameter
      if (returnedState !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Login Failed</h2>" +
          "<p>Invalid state parameter. This may be a CSRF attack.</p>" +
          "<p>Please try logging in again.</p></body></html>"
        );
        rejectCode(new Error("Invalid state parameter in callback. Possible CSRF attack."));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Login Successful!</h2>" +
          "<p>You can close this window and return to the terminal.</p></body></html>"
        );
        resolveCode(code);
        return;
      }

      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing authorization code");
      rejectCode(new Error("Missing authorization code in callback"));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  // Try preferred ports first, then fall back to random
  const port = await listenOnAvailablePort(server, CALLBACK_PORTS);

  // Auto-close after 2 minutes
  const timeout = setTimeout(() => {
    server.close();
    rejectCode(new Error("Login timed out. No callback received within 2 minutes."));
  }, 120_000);

  // Clean up timeout when code is received
  codePromise.finally(() => {
    clearTimeout(timeout);
    // Give browser time to receive HTML response before closing
    setTimeout(() => server.close(), 500);
  });

  return { port, codePromise, server };
}

/**
 * Try to listen on preferred ports in order.
 * All preferred ports must be registered in Auth0's allowed callback URLs,
 * so we cannot fall back to a random port.
 */
function listenOnAvailablePort(server: http.Server, preferredPorts: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (index: number) => {
      if (index >= preferredPorts.length) {
        reject(
          new Error(
            `All OAuth callback ports (${preferredPorts.join(", ")}) are in use. ` +
            "Close other divinci CLI instances or free one of these ports and try again."
          )
        );
        return;
      }

      const port = preferredPorts[index];

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          tryPort(index + 1);
        } else {
          reject(err);
        }
      });

      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const boundPort = typeof address === "object" && address ? address.port : 0;
        resolve(boundPort);
      });
    };

    tryPort(0);
  });
}

/**
 * Build the Auth0 authorization URL
 */
export function buildAuthorizeUrl(params: {
  auth0Config: Auth0Config;
  codeChallenge: string;
  redirectUri: string;
  state: string;
  /**
   * `divinci auth login --switch-account` also forces the scope-consent
   * screen (`prompt=login consent`, not just `login`) — useful after a scope
   * change, or to double-confirm what's being granted when deliberately
   * switching identities.
   */
  switchAccount?: boolean;
}): string {
  const { auth0Config, codeChallenge, redirectUri, state, switchAccount } = params;
  const url = new URL(`https://${auth0Config.domain}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", auth0Config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("audience", auth0Config.audience);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  // Always shown for an explicit `login` command — matches the MCP server's
  // /authorize handler (oauth-flow.ts): logging in is a rare, deliberate act,
  // so silently reusing the browser's existing Auth0 session (and possibly
  // authenticating as the wrong account without realizing it) is the wrong
  // default. --switch-account escalates to also force the consent screen.
  url.searchParams.set("prompt", switchAccount ? "login consent" : "login");
  return url.toString();
}

/**
 * Human-readable description of the OAuth scopes a login grants, for
 * pre-flight display before opening the browser (see `divinci auth login`'s
 * "what you're about to authorize" banner).
 */
export const OAUTH_SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "confirm your identity",
  profile: "read your name and profile info",
  email: "read your email address",
  offline_access: "stay signed in between CLI sessions (refresh token)",
};

/**
 * Token response from Auth0
 */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(params: {
  auth0Config: Auth0Config;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { auth0Config, code, codeVerifier, redirectUri } = params;

  const response = await fetch(`https://${auth0Config.domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: auth0Config.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  const responseText = await response.text();
  let data: TokenResponse;
  try {
    data = JSON.parse(responseText) as TokenResponse;
  } catch {
    throw new Error(
      `Failed to parse token response (status: ${response.status}): ${responseText.substring(0, 200)}`
    );
  }

  if (!response.ok) {
    const errorData = data as unknown as Record<string, string>;
    throw new Error(
      errorData.error_description ?? errorData.error ?? `Token exchange failed (${response.status})`
    );
  }

  return data;
}

/**
 * Refresh an expired access token using the refresh token
 */
export async function refreshTokens(params: {
  auth0Config: Auth0Config;
  refreshToken: string;
}): Promise<TokenResponse> {
  const { auth0Config, refreshToken } = params;

  const response = await fetch(`https://${auth0Config.domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: auth0Config.clientId,
      refresh_token: refreshToken,
    }),
  });

  const responseText = await response.text();
  let data: TokenResponse;
  try {
    data = JSON.parse(responseText) as TokenResponse;
  } catch {
    throw new Error(
      `Failed to parse refresh response (status: ${response.status}): ${responseText.substring(0, 200)}`
    );
  }

  if (!response.ok) {
    const errorData = data as unknown as Record<string, string>;
    throw new Error(
      errorData.error_description ?? errorData.error ?? `Token refresh failed (${response.status})`
    );
  }

  return data;
}

/**
 * Fetch user info from Auth0
 */
export async function fetchUserInfo(params: {
  auth0Domain: string;
  accessToken: string;
}): Promise<{ sub: string; email?: string; name?: string; nickname?: string; picture?: string }> {
  const response = await fetch(`https://${params.auth0Domain}/userinfo`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  const responseText = await response.text();

  if (!response.ok) {
    let detail = responseText.substring(0, 200);
    try {
      const errorData = JSON.parse(responseText) as Record<string, string>;
      detail = errorData.error_description ?? errorData.error ?? detail;
    } catch {
      // Use raw text
    }
    throw new Error(`Failed to fetch user info (${response.status}): ${detail}`);
  }

  try {
    return JSON.parse(responseText) as {
      sub: string;
      email?: string;
      name?: string;
      nickname?: string;
      picture?: string;
    };
  } catch {
    throw new Error(
      `Failed to parse userinfo response (status: ${response.status}): ${responseText.substring(0, 200)}`
    );
  }
}

/**
 * Best-effort revocation of refresh token
 */
export async function revokeRefreshToken(params: {
  auth0Config: Auth0Config;
  refreshToken: string;
}): Promise<void> {
  try {
    await fetch(`https://${params.auth0Config.domain}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: params.auth0Config.clientId,
        token: params.refreshToken,
      }),
    });
  } catch {
    // Best-effort — ignore errors
  }
}

/**
 * Open a URL in the user's default browser.
 * Uses execFile (not exec) to avoid shell injection.
 */
export function openBrowser(url: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    execFile("open", [url], () => {});
  } else if (platform === "win32") {
    // cmd.exe re-parses the joined command line itself and splits on
    // unescaped `&` — which every Auth0 authorize URL contains in its query
    // string (response_type=code&client_id=...&...). Without
    // windowsVerbatimArguments + explicit quoting, Node's own arg escaping
    // doesn't protect against cmd's metacharacter parsing, so the URL gets
    // silently truncated right after the first `&` and the browser opens a
    // page missing client_id and everything after it.
    execFile("cmd", ["/c", "start", '""', `"${url}"`], { windowsVerbatimArguments: true }, () => {});
  } else {
    execFile("xdg-open", [url], () => {});
  }
}

/**
 * Escape HTML entities to prevent XSS in callback page
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
