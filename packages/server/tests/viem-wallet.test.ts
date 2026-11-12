import { describe, it, expect } from "vitest";
import { createViemX402Wallet } from "../src/x402/viem-wallet.js";
import type { X402PaymentDetails } from "@divinci-ai/types";

const PAY_TO = "0x1234567890123456789012345678901234567890";
const REQUIREMENTS: X402PaymentDetails = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: PAY_TO,
  resource: "https://api.divinci.app/api/v1/chat/completions",
  description: "Divinci chat completion",
  mimeType: "application/json",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

// Well-known Anvil account #1.
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("createViemX402Wallet (EIP-3009 signing)", () => {
  it("derives the payer address from the private key", async () => {
    const wallet = createViemX402Wallet({ privateKey: PK });
    expect((await wallet.getAddress()).toLowerCase()).toBe(ADDR.toLowerCase());
  });

  it("signs a canonical PaymentPayload (no broadcast)", async () => {
    const wallet = createViemX402Wallet({ privateKey: PK, chainId: 84532 });
    const payload = await wallet.pay(REQUIREMENTS);

    expect(payload.x402Version).toBe(1);
    expect(payload.scheme).toBe("exact");
    expect(payload.network).toBe("base-sepolia");
    expect(payload.payload.signature).toMatch(/^0x[0-9a-fA-F]+$/);

    const auth = payload.payload.authorization;
    expect(auth.from.toLowerCase()).toBe(ADDR.toLowerCase());
    expect(auth.to).toBe(PAY_TO);
    expect(auth.value).toBe("10000");
    expect(auth.validAfter).toBe("0");
    expect(Number(auth.validBefore)).toBeGreaterThan(0);
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("errors when chainId can't be resolved for an unknown network", async () => {
    const wallet = createViemX402Wallet({ privateKey: PK });
    await expect(
      wallet.pay({ ...REQUIREMENTS, network: "polygon" }),
    ).rejects.toThrow(/chainId/i);
  });
});
