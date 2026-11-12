import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@divinci-ai/server", () => ({ DivinciServer: vi.fn() }));
vi.mock("@divinci-ai/server/x402-wallet", () => ({
  createViemX402Wallet: vi.fn((opts: unknown) => ({ __wallet: opts })),
}));

import { buildX402FromEnv } from "../../../src/client/create-client.js";
import { createViemX402Wallet } from "@divinci-ai/server/x402-wallet";

const X402_ENV = [
  "DIVINCI_X402_AUTOPAY",
  "DIVINCI_X402_PRIVATE_KEY",
  "DIVINCI_X402_NETWORK",
  "DIVINCI_X402_MAX_USD",
  "DIVINCI_X402_RPC_URL",
];

describe("buildX402FromEnv", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of X402_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    vi.clearAllMocks();
  });
  afterEach(() => {
    for (const k of X402_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns undefined when auto-pay is not enabled", () => {
    expect(buildX402FromEnv()).toBeUndefined();
  });

  it("returns undefined (with a warning) when enabled but no private key", () => {
    process.env.DIVINCI_X402_AUTOPAY = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(buildX402FromEnv()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/private_key is missing/i));
    warn.mockRestore();
  });

  it("builds config + wallet when enabled with a key (default network base-sepolia)", () => {
    process.env.DIVINCI_X402_AUTOPAY = "1";
    process.env.DIVINCI_X402_PRIVATE_KEY = "0xkey";
    const cfg = buildX402FromEnv();
    expect(cfg).toMatchObject({
      enabled: true,
      autoPayment: true,
      network: "base-sepolia",
      maxPaymentUsd: undefined,
    });
    expect(cfg?.wallet).toBeDefined();
    // Wallet options take chainId; network/RPC come from payment details at sign time.
    expect(createViemX402Wallet).toHaveBeenCalledWith({
      privateKey: "0xkey",
      chainId: 84532,
    });
  });

  it("respects network=base and a numeric max-usd cap", () => {
    process.env.DIVINCI_X402_AUTOPAY = "true";
    process.env.DIVINCI_X402_PRIVATE_KEY = "0xkey";
    process.env.DIVINCI_X402_NETWORK = "base";
    process.env.DIVINCI_X402_MAX_USD = "0.50";
    const cfg = buildX402FromEnv();
    expect(cfg?.network).toBe("base");
    expect(cfg?.maxPaymentUsd).toBe(0.5);
  });

  it("ignores a non-numeric max-usd", () => {
    process.env.DIVINCI_X402_AUTOPAY = "true";
    process.env.DIVINCI_X402_PRIVATE_KEY = "0xkey";
    process.env.DIVINCI_X402_MAX_USD = "not-a-number";
    expect(buildX402FromEnv()?.maxPaymentUsd).toBeUndefined();
  });
});
