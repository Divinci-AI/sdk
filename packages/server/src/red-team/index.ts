/**
 * Red Team Client
 *
 * Probe a DEPLOYED release — the same path a visitor hits — against the
 * shared TrustBench red-team corpus. Wire paths verified against
 * public-api `/:whitelabelId/red-team` (GET /plan, POST /run).
 *
 * One CATEGORY per request. A full 32-probe sweep is 32 billed model
 * calls and would exceed the edge request timeout; walk the category
 * list yourself (or use `runSweep`).
 */

import { ServerHttpClient } from "../http-client.js";

/**
 * Attack categories. Values are stable identifiers — they appear in
 * signed TrustBench manifests, so renaming one silently breaks
 * comparability with historical runs.
 */
export const RED_TEAM_CATEGORIES = [
  "prompt-injection",
  "jailbreak",
  "system-prompt-leak",
  "data-exfiltration",
  "harmful-content",
  "indirect-injection",
  "scope-violation",
] as const;

export type RedTeamCategory = (typeof RED_TEAM_CATEGORIES)[number];

export type RedTeamSeverity = "low" | "medium" | "high" | "critical";

export interface RedTeamCategoryInfo {
  category: RedTeamCategory | string;
  title: string;
  description: string;
  severity: RedTeamSeverity;
  remediation: string;
  probeCount?: number;
}

export interface RedTeamPlanResponse {
  categories: RedTeamCategoryInfo[];
  totalProbes: number;
  note: string;
}

export interface RedTeamProbeResult {
  probeId: string;
  category: string;
  technique: string;
  severity: RedTeamSeverity;
  /** TRUE means the assistant was compromised. Lower attack-success is better. */
  attackSucceeded: boolean;
  evidence: string;
  output: string;
}

export interface RedTeamRemediationItem {
  category: string;
  title: string;
  severity: RedTeamSeverity;
  failedProbes: number;
  remediation: string;
  probeIds: string[];
}

export interface RedTeamScore {
  attackSuccessRate: number;
  weightedAttackSuccessRate: number;
  resistanceScore: number;
  probeCount: number;
  successCount: number;
  byCategory: {
    category: string;
    probeCount: number;
    successCount: number;
    attackSuccessRate: number;
  }[];
}

export interface RedTeamBatchResponse {
  category: string;
  /**
   * FALSE means fewer probes executed than were attempted, so `score` is
   * NOT a score. An all-errored category scores 0.0, and 0.0 on an
   * attack-success rate is PERFECT — never render a rate without this.
   */
  measured: boolean;
  probesAttempted: number;
  categoryInfo: Omit<RedTeamCategoryInfo, "probeCount">;
  score: RedTeamScore;
  results: RedTeamProbeResult[];
  remediation: RedTeamRemediationItem[];
  errors: { probeId: string; error: string }[];
  unmeasuredProbes: string[];
  defense: {
    moderationHeldProbeIds: string[];
    moderationHeld: number;
    modelHeld: number;
    note: string;
  };
  leakDetection: {
    measurable: boolean;
    distinctivePhrases?: number;
    reason?: string;
  };
  remainingCategories: string[];
}

export interface RedTeamRunOptions {
  /** Required. The published/available release under test. */
  releaseId: string;
  /** Required for `run()`. One of {@link RED_TEAM_CATEGORIES}. */
  category: RedTeamCategory;
  /**
   * The operator's real system prompt. Needed to grade leak probes
   * (verbatim shingle overlap). Omit it and leak probes come back
   * `unmeasured` — which is not the same as "nothing leaked".
   */
  systemPrompt?: string;
  /** Per-request timeout in ms. Default 120_000 — a category is ~20s. */
  timeoutMs?: number;
}

export interface RedTeamSweepOptions {
  releaseId: string;
  systemPrompt?: string;
  timeoutMs?: number;
  /** Subset to walk. Default: every category, in report order. */
  categories?: readonly RedTeamCategory[];
}

export interface RedTeamSweepResponse {
  releaseId: string;
  batches: RedTeamBatchResponse[];
}

export function isRedTeamCategory(value: unknown): value is RedTeamCategory {
  return (
    typeof value === "string" &&
    (RED_TEAM_CATEGORIES as readonly string[]).includes(value)
  );
}

export class RedTeamClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/red-team`;
  }

  /**
   * Corpus metadata so a caller can render the plan (and the billed
   * probe count) before spending anything.
   */
  async plan(workspaceId: string): Promise<RedTeamPlanResponse> {
    return this.httpClient.get<RedTeamPlanResponse>(`${this.base(workspaceId)}/plan`);
  }

  /**
   * Run ONE category against a deployed release. Check `measured`
   * before treating `score` as a score.
   */
  async run(
    workspaceId: string,
    options: RedTeamRunOptions,
  ): Promise<RedTeamBatchResponse> {
    if (!isRedTeamCategory(options.category)) {
      throw new Error(
        `Invalid red-team category "${String(options.category)}". Allowed: ${RED_TEAM_CATEGORIES.join(", ")}`,
      );
    }
    if (!options.releaseId) {
      throw new Error("releaseId is required — red teaming grades a DEPLOYED release.");
    }
    return this.httpClient.request<RedTeamBatchResponse>(`${this.base(workspaceId)}/run`, {
      method: "POST",
      body: {
        category: options.category,
        releaseId: options.releaseId,
        ...(options.systemPrompt !== undefined
          ? { systemPrompt: options.systemPrompt }
          : {}),
      },
      timeout: options.timeoutMs ?? 120_000,
    });
  }

  /**
   * Walk every (or a subset of) category sequentially. Same billed-call
   * cost as calling `run` yourself; sequential on purpose so a 429 or
   * escrow failure cannot masquerade as a clean score.
   */
  async runSweep(
    workspaceId: string,
    options: RedTeamSweepOptions,
  ): Promise<RedTeamSweepResponse> {
    const categories = options.categories ?? RED_TEAM_CATEGORIES;
    const batches: RedTeamBatchResponse[] = [];
    for (const category of categories) {
      batches.push(
        await this.run(workspaceId, {
          releaseId: options.releaseId,
          category,
          systemPrompt: options.systemPrompt,
          timeoutMs: options.timeoutMs,
        }),
      );
    }
    return { releaseId: options.releaseId, batches };
  }
}
