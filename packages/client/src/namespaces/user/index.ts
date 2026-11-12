/**
 * User Namespace
 *
 * Handles user balance, payment methods, preferences, and saved releases.
 */

import { BaseNamespace } from "../base.js";

/**
 * User balance response
 */
export interface UserBalanceResponse {
  balance: string; // BigInt as string
  formattedBalance: string;
  currency: string;
}

/**
 * Payment method
 */
export interface PaymentMethod {
  id: string;
  type: "card" | "bank_account";
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  isDefault: boolean;
}

/**
 * Deposit funds body
 */
export interface DepositFundsBody {
  /** Amount in USD cents */
  amount: number;
  /** Payment method ID */
  paymentMethodId: string;
}

/**
 * Deposit response
 */
export interface DepositResponse {
  status: "succeeded" | "pending" | "failed";
  amount: number;
  transactionId: string;
}

/**
 * Transaction record
 */
export interface Transaction {
  id: string;
  type: "deposit" | "usage" | "refund";
  amount: string;
  description: string;
  createdAt: string;
}

/**
 * Transaction date range
 */
export interface TransactionRange {
  start: string;
  end: string;
}

/**
 * Audio tool preferences
 */
export interface AudioToolPreferences {
  defaultTranscriberTool?: string;
  defaultDiarizerTool?: string;
  defaultChunkingTool?: string;
}

/**
 * Saved releases preferences
 */
export interface SavedReleasesDoc {
  _id: string;
  userId: string;
  savedReleases: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Balance sub-namespace
 */
export class BalanceNamespace extends BaseNamespace {
  /**
   * Get user's current balance
   */
  async get(): Promise<UserBalanceResponse> {
    return this.httpClient.get<UserBalanceResponse>("/user/money/balance");
  }
}

/**
 * Payment sub-namespace
 */
export class PaymentNamespace extends BaseNamespace {
  /**
   * List user's payment methods
   */
  async listMethods(): Promise<PaymentMethod[]> {
    return this.httpClient.get<PaymentMethod[]>("/user/money/payment-method/list");
  }

  /**
   * Deposit funds to account
   */
  async deposit(body: DepositFundsBody): Promise<DepositResponse> {
    return this.httpClient.post<DepositResponse>("/user/money/deposit", body);
  }

  /**
   * Get transaction history
   */
  async getTransactions(range?: TransactionRange): Promise<Transaction[]> {
    const params = range
      ? { start: range.start, end: range.end }
      : undefined;
    return this.httpClient.get<Transaction[]>("/user/money/transactions", params);
  }
}

/**
 * Audio preferences sub-namespace
 */
export class AudioPreferencesNamespace extends BaseNamespace {
  /**
   * Get audio tool preferences
   */
  async get(): Promise<AudioToolPreferences> {
    return this.httpClient.get<AudioToolPreferences>("/user/preferences/audio-tools");
  }

  /**
   * Update audio tool preferences
   * Note: Server uses PUT for this endpoint (full replacement)
   */
  async update(preferences: Partial<AudioToolPreferences>): Promise<AudioToolPreferences> {
    return this.httpClient.put<AudioToolPreferences>(
      "/user/preferences/audio-tools",
      preferences
    );
  }
}

/**
 * Preferences sub-namespace
 */
export class PreferencesNamespace extends BaseNamespace {
  private audioNs: AudioPreferencesNamespace | null = null;

  /**
   * Audio tool preferences
   */
  get audio(): AudioPreferencesNamespace {
    if (!this.audioNs) {
      this.audioNs = new AudioPreferencesNamespace(this.httpClient, this.context);
    }
    return this.audioNs;
  }
}

/**
 * Saved releases sub-namespace
 */
export class SavedReleasesNamespace extends BaseNamespace {
  /**
   * Get user's saved releases
   */
  async list(): Promise<SavedReleasesDoc> {
    return this.httpClient.get<SavedReleasesDoc>("/user/saved-releases");
  }

  /**
   * Add a release to saved releases
   */
  async add(releaseId: string): Promise<SavedReleasesDoc> {
    return this.httpClient.post<SavedReleasesDoc>("/user/saved-releases", {
      releaseId,
    });
  }

  /**
   * Remove a release from saved releases
   */
  async remove(releaseId: string): Promise<SavedReleasesDoc> {
    return this.httpClient.delete<SavedReleasesDoc>(
      `/user/saved-releases/${releaseId}`
    );
  }
}

/**
 * User Namespace
 *
 * Handles user account operations including balance, payments, and preferences.
 *
 * @example
 * ```typescript
 * // Get user balance
 * const balance = await client.user.balance.get();
 *
 * // Deposit funds
 * await client.user.payment.deposit({ amount: 1000, paymentMethodId: "pm_..." });
 *
 * // Update audio preferences
 * await client.user.preferences.audio.update({ defaultTranscriberTool: "whisper" });
 *
 * // Add saved release
 * await client.user.releases.add("release-123");
 * ```
 */
export class UserNamespace extends BaseNamespace {
  private balanceNs: BalanceNamespace | null = null;
  private paymentNs: PaymentNamespace | null = null;
  private preferencesNs: PreferencesNamespace | null = null;
  private releasesNs: SavedReleasesNamespace | null = null;

  /**
   * Balance operations
   */
  get balance(): BalanceNamespace {
    if (!this.balanceNs) {
      this.balanceNs = new BalanceNamespace(this.httpClient, this.context);
    }
    return this.balanceNs;
  }

  /**
   * Payment operations
   */
  get payment(): PaymentNamespace {
    if (!this.paymentNs) {
      this.paymentNs = new PaymentNamespace(this.httpClient, this.context);
    }
    return this.paymentNs;
  }

  /**
   * User preferences
   */
  get preferences(): PreferencesNamespace {
    if (!this.preferencesNs) {
      this.preferencesNs = new PreferencesNamespace(this.httpClient, this.context);
    }
    return this.preferencesNs;
  }

  /**
   * Saved releases
   */
  get releases(): SavedReleasesNamespace {
    if (!this.releasesNs) {
      this.releasesNs = new SavedReleasesNamespace(this.httpClient, this.context);
    }
    return this.releasesNs;
  }
}
