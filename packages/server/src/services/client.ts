/**
 * Spend Guard Client
 *
 * Server-side wrapper for Spend Guard — cost tracking, budget enforcement,
 * and alert evaluation for external services used by the Divinci platform
 * (RunPod GPU, Google AI VEO/TTS, OpenAI, Anthropic, etc.).
 *
 * Wraps the low-level spend-guard.ts functions with a DivinciServer-compatible
 * interface that uses the shared ServerHttpClient for Kill Switch API reporting.
 *
 * @example
 * ```typescript
 * const divinci = new DivinciServer({ apiKey: "..." });
 *
 * // Check budget before submitting a GPU job
 * const budget = await divinci.spendGuard.checkBudget("runpod", "user_123");
 * if (!budget.allowed) throw new Error(budget.reason);
 *
 * // Record the job
 * await divinci.spendGuard.record("runpod", "user_123", "job_456");
 *
 * // Get today's spend summary
 * const summary = await divinci.spendGuard.getDailySummary();
 * ```
 */

import { ServerHttpClient } from "../http-client.js";
import {
  InMemorySpendStorage,
  SpendStorage,
  checkSpendBudget,
  recordSpend,
  updateActualCost,
  getDailySpendSummary,
  evaluateSpendAlerts,
  SPEND_LIMITS,
  COST_ESTIMATES,
  type ProviderName,
  type SpendBudget,
  type SpendRecord,
  type DailySpendSummary,
  type SpendAlert,
} from "./spend-guard.js";

export interface SpendGuardOptions {
  /**
   * Custom storage backend. Defaults to InMemorySpendStorage (good for
   * development; use D1/SQLite in production).
   */
  storage?: SpendStorage;
  /**
   * Kill Switch API URL for remote reporting. If set, alerts are forwarded.
   */
  killSwitchApiUrl?: string;
}

export class SpendGuardClient {
  private storage: SpendStorage;

  constructor(
    private readonly httpClient: ServerHttpClient,
    options: SpendGuardOptions = {}
  ) {
    this.storage = options.storage ?? new InMemorySpendStorage();
  }

  // -----------------------------------------------------------------------
  // Budget Enforcement
  // -----------------------------------------------------------------------

  /**
   * Check whether the current spend budget allows a new job.
   * Returns `{ allowed: false, reason }` if any budget is exceeded.
   */
  async checkBudget(provider: ProviderName, userId: string): Promise<SpendBudget> {
    return checkSpendBudget(this.storage, provider, userId);
  }

  /**
   * Record a spend entry after creating a job with an external provider.
   */
  async record(
    provider: ProviderName,
    userId: string,
    jobId: string,
    estimatedUsd?: number
  ): Promise<SpendRecord> {
    return recordSpend(this.storage, provider, userId, jobId, estimatedUsd);
  }

  /**
   * Update the actual cost for a job from a provider webhook.
   */
  async updateCost(
    jobId: string,
    executionTimeMs: number,
    provider?: ProviderName
  ): Promise<void> {
    return updateActualCost(this.storage, jobId, executionTimeMs, provider);
  }

  // -----------------------------------------------------------------------
  // Reporting
  // -----------------------------------------------------------------------

  /**
   * Get the daily spend summary, grouped by provider and by user.
   */
  async getDailySummary(date?: string): Promise<DailySpendSummary> {
    return getDailySpendSummary(this.storage, date);
  }

  // -----------------------------------------------------------------------
  // Alerts
  // -----------------------------------------------------------------------

  /**
   * Evaluate spend against budget thresholds and return any alerts that
   * should be fired (80% warning, 95% critical, 100% blocked).
   */
  async evaluateAlerts(): Promise<SpendAlert[]> {
    return evaluateSpendAlerts(this.storage, this.httpClient);
  }

  // -----------------------------------------------------------------------
  // Budget Limits (read-only)
  // -----------------------------------------------------------------------

  /** Current budget limits configuration. */
  get limits(): typeof SPEND_LIMITS {
    return SPEND_LIMITS;
  }

  /** Current cost estimates. */
  get costEstimates(): typeof COST_ESTIMATES {
    return COST_ESTIMATES;
  }

  /** Replace the storage backend (e.g. swap in-memory for D1 on init). */
  setStorage(storage: SpendStorage): void {
    this.storage = storage;
  }
}
