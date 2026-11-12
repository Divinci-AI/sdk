/**
 * x402 Payment Client
 *
 * Server-side x402 payment protocol operations
 */

import type {
  X402Config,
  X402Wallet,
  X402PaymentDetails,
  X402PaymentReceipt,
} from "@divinci-ai/types";
import { ServerHttpClient, ServerApiError } from "../http-client.js";
import { encodePaymentHeader } from "./header.js";

/**
 * x402 payment client for server-side operations
 */
export class X402Client {
  private readonly httpClient: ServerHttpClient;
  private readonly config: X402Config;
  private wallet?: X402Wallet;

  constructor(httpClient: ServerHttpClient, config: X402Config = {}) {
    this.httpClient = httpClient;
    this.config = {
      enabled: config.enabled ?? false,
      autoPayment: config.autoPayment ?? false,
      maxPaymentUsd: config.maxPaymentUsd ?? 1.0,
      network: config.network ?? "base",
      ...config,
    };
    this.wallet = config.wallet;
  }

  /**
   * Set the wallet for automatic payments
   */
  setWallet(wallet: X402Wallet): void {
    this.wallet = wallet;
  }

  /**
   * Check if x402 payments are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? false;
  }

  /**
   * Get tool pricing information
   */
  async getPricing(): Promise<ToolPricing[]> {
    return this.httpClient.get<ToolPricing[]>("/pricing");
  }

  /**
   * Get pricing for a specific tool
   */
  async getToolPrice(toolName: string): Promise<ToolPricing | null> {
    const pricing = await this.getPricing();
    return pricing.find((p) => p.toolName === toolName) ?? null;
  }

  /**
   * Handle a 402 Payment Required response
   *
   * If auto-payment is enabled and a wallet is configured, this will
   * automatically attempt to pay and return the payment receipt.
   */
  async handlePaymentRequired(
    paymentDetails: X402PaymentDetails
  ): Promise<X402PaymentReceipt | null> {
    // Check if auto-payment is enabled
    if (!this.config.autoPayment) {
      return null;
    }

    // Check if wallet is configured
    if (!this.wallet) {
      throw new ServerApiError("No wallet configured for x402 payments", {
        code: "WALLET_NOT_CONFIGURED",
      });
    }

    // Check if amount is within limits. maxAmountRequired is in atomic token
    // units; USDC has 6 decimals, so USD = atomic / 1e6.
    const amountUsd = Number(BigInt(paymentDetails.maxAmountRequired)) / 1_000_000;
    if (this.config.maxPaymentUsd !== undefined && amountUsd > this.config.maxPaymentUsd) {
      throw new ServerApiError(
        `Payment amount $${amountUsd} exceeds max limit $${this.config.maxPaymentUsd}`,
        {
          code: "PAYMENT_LIMIT_EXCEEDED",
          details: { amountUsd, maxPaymentUsd: this.config.maxPaymentUsd },
        }
      );
    }

    // Check network matches
    if (this.config.network && paymentDetails.network !== this.config.network) {
      throw new ServerApiError(
        `Payment network ${paymentDetails.network} doesn't match configured network ${this.config.network}`,
        {
          code: "NETWORK_MISMATCH",
        }
      );
    }

    // Execute payment
    return this.wallet.pay(paymentDetails);
  }

  /**
   * Resolve the X-Payment header value for a 402 by auto-paying.
   *
   * Returns the base64-encoded payment proof to attach on retry, or null when
   * auto-payment is disabled / no payer is configured (the caller then surfaces
   * the original 402). Throws on policy violations (limit/network) or payer
   * failure, so a misconfigured auto-pay never silently no-ops.
   *
   * This is the bridge the HTTP client calls to complete the x402 round-trip.
   */
  async resolvePaymentHeader(
    paymentDetails: X402PaymentDetails
  ): Promise<string | null> {
    const receipt = await this.handlePaymentRequired(paymentDetails);
    if (!receipt) return null;
    return encodePaymentHeader(receipt);
  }

  /**
   * Get payment history
   */
  async getPaymentHistory(options: PaymentHistoryOptions = {}): Promise<PaymentRecord[]> {
    return this.httpClient.get<PaymentRecord[]>("/api/v1/payments/history", {
      limit: options.limit,
      cursor: options.cursor,
      startDate: options.startDate,
      endDate: options.endDate,
    });
  }

  /**
   * Get payment by transaction hash
   */
  async getPayment(transactionHash: string): Promise<PaymentRecord | null> {
    try {
      return await this.httpClient.get<PaymentRecord>(
        `/api/v1/payments/${transactionHash}`
      );
    } catch (error) {
      if (error instanceof ServerApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Verify a payment payload (canonical v1) — posts the signed PaymentPayload
   * for server/facilitator verification.
   */
  async verifyPayment(receipt: X402PaymentReceipt): Promise<PaymentVerificationResult> {
    return this.httpClient.post<PaymentVerificationResult>("/api/v1/payments/verify", {
      network: receipt.network,
      scheme: receipt.scheme,
      payload: receipt.payload,
    });
  }

  /**
   * Get current wallet balance (if wallet is configured)
   */
  async getWalletBalance(): Promise<WalletBalance | null> {
    if (!this.wallet) {
      return null;
    }

    const address = await this.wallet.getAddress();

    return this.httpClient.get<WalletBalance>("/api/v1/payments/balance", {
      address,
      network: this.config.network,
    });
  }
}

/**
 * Tool pricing information
 */
export interface ToolPricing {
  /** Tool name */
  toolName: string;
  /** Tool description */
  description: string;
  /** Price in USD */
  priceUsd: number;
  /** Price in micro-units */
  priceMicro: number;
  /** Payment network */
  network: string;
  /** Payment asset */
  asset: string;
  /** Recipient address */
  recipient: string;
}

/**
 * Payment history options
 */
export interface PaymentHistoryOptions {
  /** Max results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
  /** Start date (ISO string) */
  startDate?: string;
  /** End date (ISO string) */
  endDate?: string;
}

/**
 * Payment record
 */
export interface PaymentRecord {
  /** Transaction hash */
  transactionHash: string;
  /** Network */
  network: string;
  /** Payer address */
  payer: string;
  /** Recipient address */
  recipient: string;
  /** Amount in USD */
  amountUsd: number;
  /** Tool/resource name */
  resource: string;
  /** Timestamp */
  timestamp: number;
  /** Status */
  status: "pending" | "confirmed" | "failed";
}

/**
 * Payment verification result
 */
export interface PaymentVerificationResult {
  /** Whether the payment is valid */
  valid: boolean;
  /** Transaction confirmed on chain */
  confirmed: boolean;
  /** Block number */
  blockNumber?: number;
  /** Error message if invalid */
  error?: string;
}

/**
 * Wallet balance
 */
export interface WalletBalance {
  /** Wallet address */
  address: string;
  /** Network */
  network: string;
  /** USDC balance */
  usdcBalance: string;
  /** ETH balance (for gas) */
  ethBalance: string;
}

/**
 * Create an x402 wallet from a private key
 *
 * Note: This is a simplified implementation. In production, use a proper
 * wallet library like ethers.js or viem.
 */
export function createX402Wallet(_privateKey: string, _network: string): X402Wallet {
  return {
    async getAddress(): Promise<string> {
      // In production, derive address from private key using ethers/viem
      throw new Error(
        "createX402Wallet is a placeholder. Use ethers.js or viem to create a real wallet."
      );
    },

    async pay(_details: X402PaymentDetails): Promise<X402PaymentReceipt> {
      // In production, sign and send transaction using ethers/viem
      throw new Error(
        "createX402Wallet is a placeholder. Use ethers.js or viem to create a real wallet."
      );
    },
  };
}
