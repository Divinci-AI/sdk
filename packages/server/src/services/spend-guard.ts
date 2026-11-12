/**
 * Spend Guard — Kill Switch cost tracking for Divinci SDK external services.
 *
 * Tracks per-job costs for external providers (RunPod GPU, Google AI VEO/TTS,
 * etc.), enforces daily budgets, and fires alerts at 80%/95% thresholds.
 *
 * Pairs with the Kill Switch Edge Agent (billing-monitor) which handles
 * Cloudflare/GCP infrastructure-level kill actions. Spend Guard covers the
 * external-service layer that the edge agent can't see.
 *
 * Wire paths:
 *   - checkSpendBudget()  → call BEFORE submitting a job to an external provider
 *   - recordSpend()       → call AFTER creating the job (records estimated cost)
 *   - updateActualCost()  → call from provider webhook (e.g. RunPod completion)
 *   - getDailySpendSummary() → spend dashboard endpoint
 *
 * @example
 * ```typescript
 * import { checkSpendBudget, recordSpend } from "../services/spend-guard.js";
 *
 * // Before processing a RunPod job:
 * const budget = await checkSpendBudget("runpod", userId);
 * if (!budget.allowed) {
 *   return new Response(JSON.stringify({ error: budget.reason }), { status: 429 });
 * }
 *
 * // After creating the job:
 * await recordSpend("runpod", userId, jobId);
 * ```
 */

import { ServerHttpClient } from "../http-client.js";

// ---------------------------------------------------------------------------
// Budget Limits — adjust per-project
// ---------------------------------------------------------------------------

export const SPEND_LIMITS = {
  /** Total platform-wide daily budget */
  DAILY_GLOBAL_USD: 50,
  /** Max jobs per user per day (any provider) */
  DAILY_PER_USER_JOBS: 100,
  /** RunPod GPU daily budget */
  RUNPOD_DAILY_USD: 25,
  /** Max concurrent RunPod jobs per user */
  RUNPOD_MAX_CONCURRENT: 10,
  /** RunPod job timeout in seconds */
  RUNPOD_JOB_TIMEOUT_SEC: 600,
  /** Google VEO video generation daily request cap */
  VEO_DAILY_REQUESTS: 200,
  /** Google TTS daily request cap */
  TTS_DAILY_REQUESTS: 500,
} as const;

// ---------------------------------------------------------------------------
// Cost Estimates — per-operation costs in USD
// ---------------------------------------------------------------------------

export const COST_ESTIMATES = {
  /**
   * RunPod GPU cost per second. Adjust for your GPU tier.
   * Default: ~$0.001/sec ($3.60/hr for RTX 4090 / A6000-class)
   */
  RUNPOD_COST_PER_SEC: 0.001,
  /** VEO video generation — per request estimate */
  VEO_PER_REQUEST: 0.05,
  /** Google Cloud TTS — per request estimate */
  TTS_PER_REQUEST: 0.000016,
  /** Google Cloud TTS — per character beyond 1M/month */
  TTS_PER_CHAR: 0.000004,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderName = "runpod" | "veo" | "tts" | "openai" | "anthropic";

export interface SpendBudget {
  allowed: boolean;
  reason?: string;
  remaining: {
    global: number;
    provider: number;
  };
}

export interface SpendRecord {
  id?: number;
  date: string;
  provider: ProviderName;
  userId: string;
  jobId?: string;
  estimatedUsd: number;
  actualUsd?: number;
  createdAt: string;
}

export interface DailySpendSummary {
  date: string;
  totalUsd: number;
  budgetLimitUsd: number;
  paused: boolean;
  byProvider: Record<ProviderName, { count: number; estimatedUsd: number; actualUsd?: number }>;
  byUser: Record<string, { count: number; totalUsd: number }>;
}

export interface SpendStorage {
  /** Record a new spend entry */
  record(entry: Omit<SpendRecord, "id" | "createdAt">): Promise<SpendRecord>;
  /** Sum spend for a date + provider */
  sumByProvider(date: string, provider: ProviderName): Promise<number>;
  /** Sum total spend for a date */
  sumTotal(date: string): Promise<number>;
  /** Count jobs for a user on a given date */
  countByUser(date: string, userId: string): Promise<number>;
  /** Count active (unfinished) jobs for a user */
  countActiveByUser(userId: string): Promise<number>;
  /** Update actual cost for a job */
  updateActualCost(jobId: string, actualUsd: number): Promise<void>;
  /** Full daily summary */
  getDailySummary(date: string): Promise<DailySpendSummary>;
}

// ---------------------------------------------------------------------------
// Default in-memory storage (for development / testing)
// ---------------------------------------------------------------------------

/** In-memory spend storage — use with D1/SQLite for production. */
export class InMemorySpendStorage implements SpendStorage {
  private records: SpendRecord[] = [];
  private nextId = 1;

  async record(entry: Omit<SpendRecord, "id" | "createdAt">): Promise<SpendRecord> {
    const record: SpendRecord = {
      id: this.nextId++,
      ...entry,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async sumByProvider(date: string, provider: ProviderName): Promise<number> {
    return this.records
      .filter((r) => r.date === date && r.provider === provider)
      .reduce((sum, r) => sum + (r.actualUsd ?? r.estimatedUsd), 0);
  }

  async sumTotal(date: string): Promise<number> {
    return this.records
      .filter((r) => r.date === date)
      .reduce((sum, r) => sum + (r.actualUsd ?? r.estimatedUsd), 0);
  }

  async countByUser(date: string, userId: string): Promise<number> {
    return this.records.filter((r) => r.date === date && r.userId === userId).length;
  }

  async countActiveByUser(userId: string): Promise<number> {
    return this.records.filter((r) => r.userId === userId && r.actualUsd === undefined).length;
  }

  async updateActualCost(jobId: string, actualUsd: number): Promise<void> {
    const record = this.records.find((r) => r.jobId === jobId);
    if (record) {
      record.actualUsd = actualUsd;
    }
  }

  async getDailySummary(date: string): Promise<DailySpendSummary> {
    const dayRecords = this.records.filter((r) => r.date === date);
    const totalUsd = dayRecords.reduce((sum, r) => sum + (r.actualUsd ?? r.estimatedUsd), 0);

    const byProvider = {} as DailySpendSummary["byProvider"];
    for (const rec of dayRecords) {
      if (!byProvider[rec.provider]) {
        byProvider[rec.provider] = { count: 0, estimatedUsd: 0, actualUsd: 0 };
      }
      byProvider[rec.provider].count++;
      byProvider[rec.provider].estimatedUsd += rec.estimatedUsd;
      if (rec.actualUsd !== undefined) {
        byProvider[rec.provider].actualUsd! += rec.actualUsd;
      }
    }

    const byUser = {} as DailySpendSummary["byUser"];
    for (const rec of dayRecords) {
      if (!byUser[rec.userId]) {
        byUser[rec.userId] = { count: 0, totalUsd: 0 };
      }
      byUser[rec.userId].count++;
      byUser[rec.userId].totalUsd += rec.actualUsd ?? rec.estimatedUsd;
    }

    return {
      date,
      totalUsd,
      budgetLimitUsd: SPEND_LIMITS.DAILY_GLOBAL_USD,
      paused: totalUsd >= SPEND_LIMITS.DAILY_GLOBAL_USD,
      byProvider,
      byUser,
    };
  }
}

// ---------------------------------------------------------------------------
// Spend Guard — main service
// ---------------------------------------------------------------------------

/**
 * Check whether the current spend budget allows a new job for the given
 * provider and user. Returns `{ allowed: false, reason }` if any budget is
 * exceeded.
 */
export async function checkSpendBudget(
  storage: SpendStorage,
  provider: ProviderName,
  userId: string
): Promise<SpendBudget> {
  const today = new Date().toISOString().split("T")[0];

  // Parallel read of all budget dimensions
  const [totalSpend, providerSpend, userJobCount, activeJobs] = await Promise.all([
    storage.sumTotal(today),
    storage.sumByProvider(today, provider),
    storage.countByUser(today, userId),
    storage.countActiveByUser(userId),
  ]);

  // Check global budget
  if (totalSpend >= SPEND_LIMITS.DAILY_GLOBAL_USD) {
    return {
      allowed: false,
      reason: `Daily global spend limit reached: $${totalSpend.toFixed(2)} >= $${SPEND_LIMITS.DAILY_GLOBAL_USD}`,
      remaining: { global: 0, provider: 0 },
    };
  }

  // Check per-user job count
  if (userJobCount >= SPEND_LIMITS.DAILY_PER_USER_JOBS) {
    return {
      allowed: false,
      reason: `Daily per-user job limit reached: ${userJobCount} >= ${SPEND_LIMITS.DAILY_PER_USER_JOBS}`,
      remaining: { global: SPEND_LIMITS.DAILY_GLOBAL_USD - totalSpend, provider: 0 },
    };
  }

  // Check per-provider budgets
  const providerBudget = getProviderBudget(provider);
  if (providerBudget !== undefined && providerSpend >= providerBudget) {
    return {
      allowed: false,
      reason: `Daily ${provider} spend limit reached: $${providerSpend.toFixed(2)} >= $${providerBudget}`,
      remaining: { global: SPEND_LIMITS.DAILY_GLOBAL_USD - totalSpend, provider: 0 },
    };
  }

  // Check concurrent jobs (RunPod-specific)
  if (provider === "runpod" && activeJobs >= SPEND_LIMITS.RUNPOD_MAX_CONCURRENT) {
    return {
      allowed: false,
      reason: `Max concurrent RunPod jobs reached: ${activeJobs} >= ${SPEND_LIMITS.RUNPOD_MAX_CONCURRENT}`,
      remaining: { global: SPEND_LIMITS.DAILY_GLOBAL_USD - totalSpend, provider: providerBudget! - providerSpend },
    };
  }

  return {
    allowed: true,
    remaining: {
      global: SPEND_LIMITS.DAILY_GLOBAL_USD - totalSpend,
      provider: providerBudget !== undefined ? providerBudget - providerSpend : Infinity,
    },
  };
}

/**
 * Record a spend entry after creating a job. Mark it with estimated cost so
 * the webhook can later update it with actual cost.
 */
export async function recordSpend(
  storage: SpendStorage,
  provider: ProviderName,
  userId: string,
  jobId: string,
  estimatedUsd?: number
): Promise<SpendRecord> {
  const today = new Date().toISOString().split("T")[0];

  const cost = estimatedUsd ?? getEstimatedCost(provider);

  return storage.record({
    date: today,
    provider,
    userId,
    jobId,
    estimatedUsd: cost,
  });
}

/**
 * Update the actual cost for a job when the provider webhook reports
 * completion with execution time / final cost.
 */
export async function updateActualCost(
  storage: SpendStorage,
  jobId: string,
  executionTimeMs: number,
  provider?: ProviderName
): Promise<void> {
  let actualUsd: number;

  if (provider === "runpod") {
    actualUsd = (executionTimeMs / 1000) * COST_ESTIMATES.RUNPOD_COST_PER_SEC;
  } else {
    // Generic: convert execution time to cost (arbitrary default)
    actualUsd = (executionTimeMs / 1000) * 0.0005;
  }

  await storage.updateActualCost(jobId, actualUsd);
}

/**
 * Get a full daily spend summary. Returns totals by provider and by user.
 */
export async function getDailySpendSummary(
  storage: SpendStorage,
  date?: string
): Promise<DailySpendSummary> {
  const targetDate = date ?? new Date().toISOString().split("T")[0];
  return storage.getDailySummary(targetDate);
}

/**
 * Get provider-specific daily budget.
 */
function getProviderBudget(provider: ProviderName): number | undefined {
  switch (provider) {
    case "runpod":
      return SPEND_LIMITS.RUNPOD_DAILY_USD;
    case "veo":
    case "tts":
    case "openai":
    case "anthropic":
      // These use request caps, not dollar caps — return undefined
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Get an estimated cost per operation for a provider (used when no specific
 * estimate is provided).
 */
function getEstimatedCost(provider: ProviderName): number {
  switch (provider) {
    case "runpod":
      return COST_ESTIMATES.RUNPOD_COST_PER_SEC * 60; // 1 min default estimate
    case "veo":
      return COST_ESTIMATES.VEO_PER_REQUEST;
    case "tts":
      return COST_ESTIMATES.TTS_PER_REQUEST * 1000; // 1K chars default
    case "openai":
      return 0.01; // ~10K tokens GPT-4o-mini
    case "anthropic":
      return 0.015; // ~10K tokens Claude 3 Haiku
    default:
      return 0.01;
  }
}

// ---------------------------------------------------------------------------
// Alerting thresholds (reports to Kill Switch API at 80%/95%)
// ---------------------------------------------------------------------------

export interface SpendAlert {
  level: "warning" | "critical" | "blocked";
  message: string;
  provider?: ProviderName;
  currentUsd: number;
  thresholdUsd: number;
}

/**
 * Evaluate whether alerts should fire based on current spend.
 * Returns any alerts that should be sent.
 */
export async function evaluateSpendAlerts(
  storage: SpendStorage,
  _httpClient?: ServerHttpClient
): Promise<SpendAlert[]> {
  const today = new Date().toISOString().split("T")[0];
  const totalSpend = await storage.sumTotal(today);
  const alerts: SpendAlert[] = [];

  // Global budget thresholds
  if (totalSpend >= SPEND_LIMITS.DAILY_GLOBAL_USD) {
    alerts.push({
      level: "blocked",
      message: `Daily global spend reached: $${totalSpend.toFixed(2)}`,
      currentUsd: totalSpend,
      thresholdUsd: SPEND_LIMITS.DAILY_GLOBAL_USD,
    });
  } else if (totalSpend >= SPEND_LIMITS.DAILY_GLOBAL_USD * 0.95) {
    alerts.push({
      level: "critical",
      message: `Daily global spend at 95%: $${totalSpend.toFixed(2)} / $${SPEND_LIMITS.DAILY_GLOBAL_USD}`,
      currentUsd: totalSpend,
      thresholdUsd: SPEND_LIMITS.DAILY_GLOBAL_USD,
    });
  } else if (totalSpend >= SPEND_LIMITS.DAILY_GLOBAL_USD * 0.8) {
    alerts.push({
      level: "warning",
      message: `Daily global spend at 80%: $${totalSpend.toFixed(2)} / $${SPEND_LIMITS.DAILY_GLOBAL_USD}`,
      currentUsd: totalSpend,
      thresholdUsd: SPEND_LIMITS.DAILY_GLOBAL_USD,
    });
  }

  // Per-provider thresholds (RunPod)
  const runpodSpend = await storage.sumByProvider(today, "runpod");
  if (runpodSpend >= SPEND_LIMITS.RUNPOD_DAILY_USD) {
    alerts.push({
      level: "blocked",
      provider: "runpod",
      message: `Daily RunPod spend reached: $${runpodSpend.toFixed(2)}`,
      currentUsd: runpodSpend,
      thresholdUsd: SPEND_LIMITS.RUNPOD_DAILY_USD,
    });
  } else if (runpodSpend >= SPEND_LIMITS.RUNPOD_DAILY_USD * 0.95) {
    alerts.push({
      level: "critical",
      provider: "runpod",
      message: `Daily RunPod spend at 95%: $${runpodSpend.toFixed(2)} / $${SPEND_LIMITS.RUNPOD_DAILY_USD}`,
      currentUsd: runpodSpend,
      thresholdUsd: SPEND_LIMITS.RUNPOD_DAILY_USD,
    });
  }

  return alerts;
}
