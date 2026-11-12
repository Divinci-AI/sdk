import { DivinciServer } from "@divinci-ai/server";
import type { X402Config } from "@divinci-ai/server";
import { createViemX402Wallet } from "@divinci-ai/server/x402-wallet";
import type { ResolvedConfig } from "../config/config-manager.js";

/**
 * Build x402 auto-pay config from the environment.
 *
 * Opt-in via DIVINCI_X402_AUTOPAY=true. The signing key is read ONLY from the
 * environment (DIVINCI_X402_PRIVATE_KEY) — never a CLI flag — so it doesn't
 * leak into shell history or process listings.
 *
 *   DIVINCI_X402_AUTOPAY=true        enable auto-pay
 *   DIVINCI_X402_PRIVATE_KEY=0x...   paying wallet key (required when enabled)
 *   DIVINCI_X402_NETWORK=base|base-sepolia   (default base-sepolia)
 *   DIVINCI_X402_MAX_USD=0.50        per-request spend cap (optional)
 *   DIVINCI_X402_RPC_URL=https://... custom RPC (optional)
 *
 * Requires the optional `viem` dependency to be installed for settlement.
 */
export function buildX402FromEnv(): X402Config | undefined {
  const autopay =
    process.env.DIVINCI_X402_AUTOPAY === "true" || process.env.DIVINCI_X402_AUTOPAY === "1";
  if (!autopay) return undefined;

  const privateKey = process.env.DIVINCI_X402_PRIVATE_KEY;
  if (!privateKey) {
    console.warn(
      "DIVINCI_X402_AUTOPAY is set but DIVINCI_X402_PRIVATE_KEY is missing — x402 auto-pay disabled.",
    );
    return undefined;
  }

  const network = process.env.DIVINCI_X402_NETWORK === "base" ? "base" : "base-sepolia";

  const maxRaw = process.env.DIVINCI_X402_MAX_USD;
  const maxParsed = maxRaw !== undefined && maxRaw !== "" ? Number(maxRaw) : undefined;
  const maxPaymentUsd =
    maxParsed !== undefined && Number.isFinite(maxParsed) ? maxParsed : undefined;

  return {
    enabled: true,
    autoPayment: true,
    network,
    maxPaymentUsd,
    // ViemX402WalletOptions takes chainId (the wallet reads network/RPC from
    // the payment details at sign time) — map the env's network name to it.
    wallet: createViemX402Wallet({
      privateKey,
      chainId: network === "base" ? 8453 : 84532,
    }),
  };
}

/**
 * Extra headers to send on every request, e.g. to reach an environment fronted
 * by Cloudflare Access (staging): `CF-Access-Client-Id` / `CF-Access-Client-Secret`
 * service-token headers, required in addition to (not instead of) the normal
 * Divinci auth. Generic rather than CF-Access-specific so any future
 * edge-auth requirement is covered by the same mechanism.
 *
 *   DIVINCI_EXTRA_HEADERS='{"CF-Access-Client-Id":"...","CF-Access-Client-Secret":"..."}'
 *
 * Malformed JSON is a hard error (fail loudly — a silently-dropped auth header
 * produces a confusing 403 from the edge instead of a clear config error).
 */
export function buildExtraHeadersFromEnv(): Record<string, string> | undefined {
  const raw = process.env.DIVINCI_EXTRA_HEADERS;
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DIVINCI_EXTRA_HEADERS must be valid JSON, e.g. '{\"CF-Access-Client-Id\":\"...\"}'");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DIVINCI_EXTRA_HEADERS must be a JSON object of header name -> value");
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new Error(`DIVINCI_EXTRA_HEADERS["${key}"] must be a string`);
    }
    headers[key] = value;
  }
  return headers;
}

export function createClient(
  config: ResolvedConfig,
  opts?: { timeoutMs?: number },
): DivinciServer {
  return new DivinciServer({
    apiKey: config.apiKey ?? "",
    accessToken: config.accessToken,
    baseUrl: config.apiUrl,
    defaultWorkspaceId: config.workspaceId,
    x402: buildX402FromEnv(),
    headers: buildExtraHeadersFromEnv(),
    // Per-call requests on the SDK's `post()` can't set a timeout, so a long
    // synchronous call (e.g. a direct model generation) needs a higher
    // client-wide timeout than the 30s default. Callers that do slow work pass one.
    ...(typeof opts?.timeoutMs === "number" ? { timeout: opts.timeoutMs } : {}),
  });
}
