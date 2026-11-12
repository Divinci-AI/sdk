import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServerHttpClient } from "../src/http-client.js";
import { X402Client } from "../src/x402/index.js";
import { encodePaymentHeader, extractPaymentDetails, X402_PAYMENT_HEADER } from "../src/x402/header.js";
import { createMockFetch } from "./mocks/fetch.js";
import type { X402PaymentDetails, X402PaymentReceipt, X402Wallet } from "@divinci-ai/types";

const PAY_TO = "0x1234567890123456789012345678901234567890";

// Canonical PaymentRequirements (one accepts[] entry).
const REQUIREMENTS: X402PaymentDetails = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "10000", // 0.01 USDC (6 decimals)
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: PAY_TO,
  resource: "https://api.divinci.app/api/v1/chat/completions",
  description: "Divinci chat completion",
  mimeType: "application/json",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

// Canonical PaymentPayload (X-PAYMENT content).
const PAYLOAD: X402PaymentReceipt = {
  x402Version: 1,
  scheme: "exact",
  network: "base-sepolia",
  payload: {
    signature: "0xsig",
    authorization: {
      from: "0xfrom",
      to: PAY_TO,
      value: "10000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0xnonce",
    },
  },
};

// Canonical 402 body.
const body402 = { x402Version: 1, error: "X-PAYMENT header is required", accepts: [REQUIREMENTS] };

describe("encodePaymentHeader / extractPaymentDetails (canonical)", () => {
  it("encodes a PaymentPayload as base64 JSON (server-decodable)", () => {
    const header = encodePaymentHeader(PAYLOAD);
    expect(JSON.parse(Buffer.from(header, "base64").toString("utf-8"))).toEqual(PAYLOAD);
  });
  it("extracts the first PaymentRequirements from the 402 accepts[]", () => {
    expect(extractPaymentDetails(body402)).toEqual(REQUIREMENTS);
  });
  it("returns null when accepts is missing/empty/partial", () => {
    expect(extractPaymentDetails(null)).toBeNull();
    expect(extractPaymentDetails({ accepts: [] })).toBeNull();
    expect(extractPaymentDetails({ accepts: [{ scheme: "exact" }] })).toBeNull();
  });
});

describe("ServerHttpClient x402 auto-pay retry", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("pays on a 402 then retries once with the X-PAYMENT header", async () => {
    const mockFetch = createMockFetch([
      { status: 402, body: body402 },
      { status: 200, body: { ok: true, answer: "hi" } },
    ]);
    globalThis.fetch = mockFetch;

    const client = new ServerHttpClient({ apiKey: "k", baseUrl: "https://api.test.com" });
    const hook = vi.fn(async (d: X402PaymentDetails) => {
      expect(d).toEqual(REQUIREMENTS);
      return encodePaymentHeader(PAYLOAD);
    });
    client.setX402PayHook(hook);

    const result = await client.post<{ ok: boolean }>("/api/v1/chat/completions", { messages: [] });
    expect(result).toEqual({ ok: true, answer: "hi" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const headers = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers[X402_PAYMENT_HEADER]).toBe(encodePaymentHeader(PAYLOAD));
  });

  it("surfaces the 402 when no hook is configured", async () => {
    globalThis.fetch = createMockFetch([{ status: 402, body: body402 }]);
    const client = new ServerHttpClient({ apiKey: "k", baseUrl: "https://api.test.com" });
    await expect(client.post("/x", {})).rejects.toMatchObject({ status: 402 });
  });

  it("does not retry a second time if the paid call also 402s", async () => {
    const mockFetch = createMockFetch([{ status: 402, body: body402 }, { status: 402, body: body402 }]);
    globalThis.fetch = mockFetch;
    const client = new ServerHttpClient({ apiKey: "k", baseUrl: "https://api.test.com" });
    client.setX402PayHook(async () => encodePaymentHeader(PAYLOAD));
    await expect(client.post("/x", {})).rejects.toMatchObject({ status: 402 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces the 402 when the hook declines (returns null)", async () => {
    const mockFetch = createMockFetch([{ status: 402, body: body402 }]);
    globalThis.fetch = mockFetch;
    const client = new ServerHttpClient({ apiKey: "k", baseUrl: "https://api.test.com" });
    client.setX402PayHook(async () => null);
    await expect(client.post("/x", {})).rejects.toMatchObject({ status: 402 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("X402Client.resolvePaymentHeader (auto-pay policy)", () => {
  function makeWallet(): X402Wallet {
    return { getAddress: async () => "0xpayer", pay: vi.fn(async () => PAYLOAD) };
  }

  it("returns null when auto-payment is disabled", async () => {
    const x402 = new X402Client(new ServerHttpClient({ apiKey: "k" }), { autoPayment: false, wallet: makeWallet() });
    expect(await x402.resolvePaymentHeader(REQUIREMENTS)).toBeNull();
  });

  it("signs + encodes a header when enabled with a wallet", async () => {
    const x402 = new X402Client(new ServerHttpClient({ apiKey: "k" }), { autoPayment: true, wallet: makeWallet(), network: "base-sepolia" });
    expect(await x402.resolvePaymentHeader(REQUIREMENTS)).toBe(encodePaymentHeader(PAYLOAD));
  });

  it("throws when the atomic amount exceeds maxPaymentUsd", async () => {
    const x402 = new X402Client(new ServerHttpClient({ apiKey: "k" }), { autoPayment: true, wallet: makeWallet(), maxPaymentUsd: 0.005 });
    await expect(x402.resolvePaymentHeader(REQUIREMENTS)).rejects.toThrow(/exceeds max/i);
  });

  it("throws on network mismatch", async () => {
    const x402 = new X402Client(new ServerHttpClient({ apiKey: "k" }), { autoPayment: true, wallet: makeWallet(), network: "base" });
    await expect(x402.resolvePaymentHeader(REQUIREMENTS)).rejects.toThrow(/network/i);
  });
});
