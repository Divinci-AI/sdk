/**
 * viem-backed X402Wallet — canonical x402 v1 (exact EVM scheme).
 *
 * SIGNS an EIP-3009 `transferWithAuthorization` (EIP-712 typed data) for the
 * payment requirements and returns a PaymentPayload. It does NOT broadcast —
 * the resource server's facilitator settles it (/settle), so the payer pays no
 * gas. This is the optional settlement backend for the SDK's x402 auto-pay.
 *
 * NOT exported from the package root — import from "@divinci-ai/server/
 * x402-wallet" so consumers who never pay don't bundle viem. `viem` is an
 * OPTIONAL dependency loaded via a string-typed dynamic import (no build dep).
 */

import type { X402PaymentDetails, X402PaymentReceipt, X402Wallet } from "@divinci-ai/types";

export interface ViemX402WalletOptions {
  /** 0x-prefixed private key of the paying wallet. */
  privateKey: string;
  /** Chain id used in the EIP-712 domain (e.g. 8453 base, 84532 base-sepolia). */
  chainId?: number;
  /** Seconds the signed authorization stays valid (default 300). */
  validForSeconds?: number;
}

const CHAIN_ID_BY_NETWORK: Record<string, number> = {
  base: 8453,
  "base-sepolia": 84532,
};

interface ViemLocalAccount {
  address: string;
  signTypedData(args: unknown): Promise<string>;
}

interface ViemBundle {
  accounts: { privateKeyToAccount(pk: string): ViemLocalAccount };
}

async function loadViem(): Promise<ViemBundle> {
  // String-typed specifier so tsc treats this as dynamic (no build dep on viem).
  const accountsSpec: string = "viem/accounts";
  try {
    const accounts = await import(accountsSpec);
    return { accounts: accounts as ViemBundle["accounts"] };
  } catch {
    throw new Error(
      "createViemX402Wallet requires the optional dependency 'viem'. Install it: pnpm add viem",
    );
  }
}

/** Random 32-byte hex nonce for the authorization. */
function randomNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create an X402Wallet that signs EIP-3009 authorizations via viem.
 *
 *   new DivinciServer({ ..., x402: { autoPayment: true,
 *     wallet: createViemX402Wallet({ privateKey }) } })
 */
export function createViemX402Wallet(options: ViemX402WalletOptions): X402Wallet {
  return {
    async getAddress(): Promise<string> {
      const { accounts } = await loadViem();
      return accounts.privateKeyToAccount(options.privateKey).address;
    },

    async pay(details: X402PaymentDetails): Promise<X402PaymentReceipt> {
      const { accounts } = await loadViem();
      const account = accounts.privateKeyToAccount(options.privateKey);

      const chainId = options.chainId ?? CHAIN_ID_BY_NETWORK[details.network];
      if (!chainId) {
        throw new Error(`Unknown chainId for network ${details.network}; pass chainId explicitly`);
      }

      const nowSec = Math.floor(globalThis.Date.now() / 1000);
      const validFor = options.validForSeconds ?? 300;
      const authorization = {
        from: account.address,
        to: details.payTo,
        value: details.maxAmountRequired,
        validAfter: "0",
        validBefore: String(nowSec + validFor),
        nonce: randomNonce(),
      };

      // EIP-712 TransferWithAuthorization over the token's domain. Signed
      // locally by the account — no RPC transport needed (no broadcast).
      const signature = await account.signTypedData({
        domain: {
          name: details.extra.name,
          version: details.extra.version,
          chainId,
          verifyingContract: details.asset,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: authorization.from,
          to: authorization.to,
          value: BigInt(authorization.value),
          validAfter: BigInt(authorization.validAfter),
          validBefore: BigInt(authorization.validBefore),
          nonce: authorization.nonce,
        },
      });

      return {
        x402Version: 1,
        scheme: "exact",
        network: details.network,
        payload: { signature, authorization },
      };
    },
  };
}
