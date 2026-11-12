/**
 * x402 wire-format helpers (canonical v1) — encode a PaymentPayload into the
 * X-PAYMENT header and extract PaymentRequirements from a 402 body.
 *
 * Inverse of the server's parsePaymentPayload / buildPaymentRequiredBody
 * (workspace/servers/public-api/src/api/v1/lib/x402/protocol.ts).
 */

import type { X402PaymentDetails, X402PaymentReceipt } from "@divinci-ai/types";

/** Request header carrying the base64 PaymentPayload. */
export const X402_PAYMENT_HEADER = "X-PAYMENT";

/** Encode a PaymentPayload as the X-PAYMENT header value (base64 JSON). */
export function encodePaymentHeader(payload: X402PaymentReceipt): string {
  const json = JSON.stringify(payload);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf-8").toString("base64");
  }
  // eslint-disable-next-line no-undef
  return btoa(unescape(encodeURIComponent(json)));
}

/**
 * Pull the first PaymentRequirements out of a canonical 402 body
 * `{ x402Version, error, accepts: [PaymentRequirements] }`. Returns null if the
 * shape isn't usable. Also tolerates a body nested under `error` (the SDK
 * unwraps `{ error: {...} }` for other endpoints).
 */
export function extractPaymentDetails(body: unknown): X402PaymentDetails | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const accepts = Array.isArray(root.accepts) ? (root.accepts as unknown[]) : null;
  if (!accepts || accepts.length === 0) return null;
  const r = accepts[0];
  if (!r || typeof r !== "object") return null;
  const d = r as Record<string, unknown>;
  if (
    typeof d.scheme !== "string" ||
    typeof d.network !== "string" ||
    typeof d.maxAmountRequired !== "string" ||
    typeof d.asset !== "string" ||
    typeof d.payTo !== "string" ||
    typeof d.resource !== "string"
  ) {
    return null;
  }
  return {
    scheme: d.scheme,
    network: d.network,
    maxAmountRequired: d.maxAmountRequired,
    asset: d.asset,
    payTo: d.payTo,
    resource: d.resource,
    description: typeof d.description === "string" ? d.description : "",
    mimeType: typeof d.mimeType === "string" ? d.mimeType : "application/json",
    maxTimeoutSeconds: typeof d.maxTimeoutSeconds === "number" ? d.maxTimeoutSeconds : 60,
    extra:
      d.extra && typeof d.extra === "object"
        ? (d.extra as { name: string; version: string })
        : { name: "", version: "" },
  };
}
