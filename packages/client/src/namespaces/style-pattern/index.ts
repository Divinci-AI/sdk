/**
 * Style-Pattern Namespace
 *
 * Per-workspace style-pattern rules that drive the Phase 4 chat-response
 * rewriter, plus the captured-edits feed and audit log that surround it.
 *
 * Spec: notebooks/STYLE_PATTERN_INTEGRATION_GOAL.md
 */

import { BaseNamespace } from "../base.js";

export type StylePatternCategory =
  | "persona-impersonation"
  | "rag-metacommentary"
  | "chunk-truncation"
  | "preamble-verbosity"
  | "ai-disclaimer"
  | "other";

export interface StylePatternRuleDoc {
  _id: string;
  workspace: string;
  category: StylePatternCategory;
  regex: string;
  regexFlags?: string;
  ruleDescription: string;
  substitutionTemplate?: string | null;
  rewriteInstruction?: string;
  rewriteFullResponse?: boolean;
  exampleEditIds: string[];
  confidence: number;
  enabled: boolean;
  enabledForReleaseIds: string[] | null;
  priority: number;
  severity: number;
  triggerCount: number;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposedRuleDoc {
  _id: string;
  workspace: string;
  category: StylePatternCategory;
  regex: string;
  regexFlags?: string;
  ruleDescription: string;
  substitutionTemplate?: string | null;
  sampleEditIds: string[];
  proposedAt: string;
  proposedBy: string;
  reviewed: boolean;
  rejectedReason?: string | null;
  promotedKvId?: string | null;
}

export type ResponseEditSource = "transcript-edit" | "calibration-edit" | "calibration-winner-pick";

export interface ResponseEditExampleDoc {
  _id: string;
  source: ResponseEditSource;
  original: string;
  edited: string;
  category?: StylePatternCategory | null;
  lastProcessedAt?: string | null;
  createdAt: string;
  /** Present in full-fetch responses; absent in the lean list endpoint. */
  editor?: { userId: string; displayName?: string; role?: string };
  /** Present in full-fetch responses; absent in the lean list endpoint. */
  promotedToPatternKvId?: string | null;
}

export interface StylePatternAuditEntry {
  _id: string;
  ts: string;
  workspace: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface ListRulesParams {
  workspaceId?: string;
  category?: StylePatternCategory;
  enabled?: boolean;
}

export interface ListProposedParams {
  workspaceId?: string;
  reviewed?: boolean;
  limit?: number;
}

export interface ListExamplesParams {
  workspaceId?: string;
  source?: ResponseEditSource;
  /** true: only docs the mining worker has processed. false: only unprocessed. */
  processed?: boolean;
  limit?: number;
  format?: "json" | "jsonl";
}

export interface TestRewriteBody {
  response: string;
  releaseId?: string;
}

export interface TestRewriteResult {
  original: string;
  rewritten: string;
  changed: boolean;
  appliedRuleIds: string[];
  deferredMatches: Array<{ ruleId: string; matchText: string; category: StylePatternCategory }>;
  totalMatches: number;
  elapsedMs: number;
}

export interface ApproveProposedBody {
  editedDescription?: string;
}

export interface RejectProposedBody {
  rejectedReason: string;
}

export interface ToggleRuleBody {
  enabled?: boolean;
  priority?: number;
  severity?: number;
  enabledForReleaseIds?: string[] | null;
}

export interface ListAuditParams {
  workspaceId?: string;
  action?: string;
  entityId?: string;
  limit?: number;
}

// ── Fine-tune training runs (task #8) ──────────────────────────────────────

export type FineTuneTrainingRunStatus =
  | "pending"
  | "submitting"
  | "submitted"
  | "training"
  | "completed"
  | "failed";

export type FineTuneTrainingRunTrigger = "auto-cron" | "manual" | "admin-api";

export interface FineTuneTrainingRunDoc {
  _id: string;
  releaseId?: string | null;
  examplesIncludedCount: number;
  status: FineTuneTrainingRunStatus;
  triggeredBy: FineTuneTrainingRunTrigger;
  triggeredByUserId?: string | null;
  fineTuneJobId?: string | null;
  resultModelId?: string | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTrainingRunBody {
  releaseId?: string | null;
  minExamples?: number;
  maxExamples?: number;
  notes?: string;
}

export type CreateTrainingRunResult =
  | {
      status: "created";
      runId: string;
      examplesIncludedCount: number;
      releaseId: string | null;
    }
  | {
      status: "below-threshold";
      availableExamples: number;
      requiredExamples: number;
      releaseId: string | null;
    };

export interface ListTrainingRunsParams {
  workspaceId?: string;
  status?: FineTuneTrainingRunStatus;
  releaseId?: string;
  limit?: number;
}

export interface ExportTrainingRunJsonlParams {
  workspaceId?: string;
  runId: string;
  /**
   * When true, examples missing `userPrompt` use a generic fallback
   * line instead of being skipped. Useful for historical edits where
   * the prompt wasn't captured.
   */
  allowFallbackPrompt?: boolean;
}

export interface ExportTrainingRunJsonlStats {
  totalEdits: number;
  emittedLines: number;
  skippedNoEdit: number;
  skippedNoPrompt: number;
  fallbackUsed: number;
}

export interface ExportTrainingRunJsonlResponse {
  runId: string;
  jsonl: string;
  stats: ExportTrainingRunJsonlStats;
}

export interface TransitionTrainingRunBody {
  toStatus: FineTuneTrainingRunStatus;
  /** Provider-side fields persisted atomically with the transition. */
  jsonlPath?: string;
  fineTuneJobId?: string;
  resultModelId?: string;
  /** Required iff toStatus === "failed". */
  error?: string;
  notes?: string;
}

export type TransitionTrainingRunResult =
  | {
      status: "ok";
      runId: string;
      previousStatus: FineTuneTrainingRunStatus;
      newStatus: FineTuneTrainingRunStatus;
    }
  | {
      status: "invalid-transition";
      runId: string;
      currentStatus: FineTuneTrainingRunStatus;
      attempted: FineTuneTrainingRunStatus;
    };

/**
 * StylePatternNamespace — workspace-scoped style-pattern admin.
 *
 * @example
 * ```ts
 * const sdk = new DivinciClient({...});
 * // Browse enabled rules:
 * const { patterns } = await sdk.stylePattern.listRules({ workspaceId: "wl-1", enabled: true });
 *
 * // Dry-run a sample:
 * const result = await sdk.stylePattern.testRewrite(
 *   { workspaceId: "wl-1" },
 *   { response: "As Dr. Fuhrman, I recommend..." },
 * );
 *
 * // Approve a mining proposal:
 * await sdk.stylePattern.approveProposed({ workspaceId: "wl-1", proposedId: "abc123" });
 * ```
 */
export class StylePatternNamespace extends BaseNamespace {
  /** List StylePatternKV rules. */
  async listRules(params: ListRulesParams = {}): Promise<{ patterns: StylePatternRuleDoc[]; total: number }> {
    const workspaceId = this.getWorkspaceId(params);
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    if (typeof params.enabled === "boolean") qs.set("enabled", String(params.enabled));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(`/white-label/${workspaceId}/style-pattern${query}`);
  }

  /** List ProposedRule docs (mining queue). */
  async listProposed(params: ListProposedParams = {}): Promise<{ proposed: ProposedRuleDoc[]; total: number }> {
    const workspaceId = this.getWorkspaceId(params);
    const qs = new URLSearchParams();
    if (typeof params.reviewed === "boolean") qs.set("reviewed", String(params.reviewed));
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(`/white-label/${workspaceId}/style-pattern/proposed${query}`);
  }

  /**
   * List captured response edits (ResponseEditExample). Response field
   * is `items` (not `examples`) to match the server endpoint shape.
   * Use `format: "jsonl"` to stream NDJSON for SFT-export pipelines.
   */
  async listCapturedEdits(
    params: ListExamplesParams = {},
  ): Promise<{ items: ResponseEditExampleDoc[]; count: number; limit: number }> {
    const workspaceId = this.getWorkspaceId(params);
    const qs = new URLSearchParams();
    if (params.source) qs.set("source", params.source);
    if (typeof params.processed === "boolean") qs.set("processed", String(params.processed));
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    if (params.format) qs.set("format", params.format);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(`/white-label/${workspaceId}/style-pattern/examples${query}`);
  }

  /** Run the rewrite pipeline against a sample text (read-only validation). */
  async testRewrite(
    params: { workspaceId?: string },
    body: TestRewriteBody,
  ): Promise<TestRewriteResult> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post(`/white-label/${workspaceId}/style-pattern/test-rewrite`, body);
  }

  /** Approve a mined proposal → promotes to StylePatternKV (disabled). */
  async approveProposed(
    params: { workspaceId?: string; proposedId: string },
    body: ApproveProposedBody = {},
  ): Promise<{ promotedKvId: string; reviewed: boolean }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post(
      `/white-label/${workspaceId}/style-pattern/proposed/${params.proposedId}/approve`,
      body,
    );
  }

  /** Reject a mined proposal with a stored reason. */
  async rejectProposed(
    params: { workspaceId?: string; proposedId: string },
    body: RejectProposedBody,
  ): Promise<{ reviewed: boolean; rejectedReason: string }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post(
      `/white-label/${workspaceId}/style-pattern/proposed/${params.proposedId}/reject`,
      body,
    );
  }

  /** Update a StylePatternKV rule (enable/disable, priority, severity, scope). */
  async updateRule(
    params: { workspaceId?: string; ruleId: string },
    body: ToggleRuleBody,
  ): Promise<{ pattern: StylePatternRuleDoc }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post(
      `/white-label/${workspaceId}/style-pattern/${params.ruleId}`,
      body,
    );
  }

  /** Convenience wrapper around updateRule for the most common enable/disable case. */
  async toggleRule(params: {
    workspaceId?: string;
    ruleId: string;
    enabled: boolean;
  }): Promise<{ pattern: StylePatternRuleDoc }> {
    return this.updateRule(
      { workspaceId: params.workspaceId, ruleId: params.ruleId },
      { enabled: params.enabled },
    );
  }

  /** Read the audit log of admin actions. */
  async listAudit(params: ListAuditParams = {}): Promise<{ entries: StylePatternAuditEntry[]; total: number }> {
    const workspaceId = this.getWorkspaceId(params);
    const qs = new URLSearchParams();
    if (params.action) qs.set("action", params.action);
    if (params.entityId) qs.set("entityId", params.entityId);
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(`/white-label/${workspaceId}/style-pattern/audit${query}`);
  }

  // ── Fine-tune training runs (task #8) ────────────────────────────────────

  /**
   * Create a FineTuneTrainingRun by atomically picking unprocessed
   * captured edits. Below-threshold returns are NOT errors — they
   * indicate the worker should wait for more data. Fine-tune
   * submission itself is a downstream phase.
   */
  async createTrainingRun(
    params: { workspaceId?: string },
    body: CreateTrainingRunBody = {},
  ): Promise<CreateTrainingRunResult> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post(
      `/white-label/${workspaceId}/style-pattern/training-runs`,
      body,
    );
  }

  /** List FineTuneTrainingRun docs for the workspace. */
  async listTrainingRuns(
    params: ListTrainingRunsParams = {},
  ): Promise<{ items: FineTuneTrainingRunDoc[]; count: number; limit: number }> {
    const workspaceId = this.getWorkspaceId(params);
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.releaseId) qs.set("releaseId", params.releaseId);
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(
      `/white-label/${workspaceId}/style-pattern/training-runs${query}`,
    );
  }

  /** Get one FineTuneTrainingRun including the full sourceEditIds list. */
  async getTrainingRun(params: {
    workspaceId?: string;
    runId: string;
  }): Promise<{ item: FineTuneTrainingRunDoc & { sourceEditIds: string[] } }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get(
      `/white-label/${workspaceId}/style-pattern/training-runs/${params.runId}`,
    );
  }

  /**
   * Materialize the OpenAI-shaped JSONL training file for a run.
   * Pure read; does not mutate the run.
   */
  async exportTrainingRunJsonl(
    params: ExportTrainingRunJsonlParams,
  ): Promise<ExportTrainingRunJsonlResponse> {
    const workspaceId = this.getWorkspaceId(params);
    const qs = new URLSearchParams();
    if (params.allowFallbackPrompt) qs.set("allowFallbackPrompt", "true");
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(
      `/white-label/${workspaceId}/style-pattern/training-runs/${params.runId}/jsonl${query}`,
    );
  }

  /**
   * Advance a run through its state machine
   * (pending → submitting → submitted → training → completed | failed).
   * Forward-only — backward transitions return invalid-transition.
   * Provider-side fields persist atomically with the transition.
   */
  async transitionTrainingRun(
    params: { workspaceId?: string; runId: string },
    body: TransitionTrainingRunBody,
  ): Promise<TransitionTrainingRunResult> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post(
      `/white-label/${workspaceId}/style-pattern/training-runs/${params.runId}/transition`,
      body,
    );
  }
}
