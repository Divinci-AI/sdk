/**
 * Shared HTTP helpers for the `divinci trust *` commands.
 *
 * TrustBench routes are flat under `/v1/trustbench/*` (no workspace in the
 * path), Auth0-gated, so we send the OAuth access token (falling back to an
 * API key for api-key profiles). Mirrors the inline fetch idiom used across the
 * CLI but de-duplicated since six endpoints + a poll loop share it.
 */
import {
  requireConfig,
  ensureValidToken,
  type ResolvedConfig,
} from "../../config/config-manager.js";

export interface TrustHttp {
  baseUrl: string;
  authToken: string;
}

/** Resolve config (refreshing the OAuth token if near expiry) into a TrustHttp. */
export async function resolveTrustHttp(globalOpts: unknown): Promise<TrustHttp> {
  let config: ResolvedConfig = requireConfig(globalOpts as never);
  config = await ensureValidToken(config);
  const authToken = config.accessToken ?? config.apiKey;
  if (!authToken) {
    throw new Error(
      "Not authenticated. Run `divinci login` (OAuth) or pass --api-key."
    );
  }
  return { baseUrl: config.apiUrl.replace(/\/+$/, ""), authToken };
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Non-JSON response (status ${res.status}): ${text.substring(0, 200)}`
    );
  }
}

export async function trustGet<T>(http: TrustHttp, path: string): Promise<T> {
  const res = await fetch(`${http.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${http.authToken}` },
  });
  return parseJson<T>(res);
}

export async function trustPost<T>(
  http: TrustHttp,
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(`${http.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${http.authToken}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return parseJson<T>(res);
}

export async function trustPatch<T>(
  http: TrustHttp,
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${http.baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${http.authToken}`,
    },
    body: JSON.stringify(body),
  });
  return parseJson<T>(res);
}

/**
 * Fetch a public (unauthenticated) artifact's raw bytes — used by local verify
 * for the manifest/outputs. Returns null on 404 (private/not-found/absent) so
 * callers can degrade gracefully; throws on other HTTP errors.
 */
export async function trustGetPublicBytes(
  http: TrustHttp,
  path: string
): Promise<ArrayBuffer | null> {
  const res = await fetch(`${http.baseUrl}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.arrayBuffer();
}

/** The environment-correct well-known key registry URL for local verification. */
export function wellKnownUrlFor(http: TrustHttp): string {
  return `${http.baseUrl}/.well-known/trustbench-keys.json`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
