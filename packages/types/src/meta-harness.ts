/**
 * Meta-Harness types
 *
 * The meta-harness is an orchestration system that periodically surveys
 * accumulated feedback signal, generates reports, and creates operator-
 * actionable proposals for fine-tuning and release management.
 */

import type { ObjectId } from "./common.js";

// ─── Enums ───────────────────────────────────────────────────────────

export type AutonomyLevel = "manual" | "checkpoint-every-iteration" | "full-auto";
export type OrchestrationLoopStatus = "idle" | "running" | "paused" | "errored" | "cancelled";
export type IterationStatus = "running" | "completed" | "failed";
export type ProposalKind = "fine-tune-kickoff" | "release-promotion" | "regression-alert";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "expired";

// ─── Loop ────────────────────────────────────────────────────────────

/**
 * Terminal outcome of evaluating one kicked-off fine-tune job. `pending`
 * is not terminal — the job is still training.
 */
export type FineTuneEvaluationOutcome =
  | "pending"
  | "job-failed"
  | "not-evaluated"
  | "improved"
  | "regressed"
  | "neutral"
  | "evaluation-failed";

export interface MetaHarnessLoopConfig {
  autonomyLevel: AutonomyLevel;
  minSignalThreshold: number;
  proposalExpiryHours: number;
  intervalMs: number;

  /** Opt-in: scoring a candidate release spends provider money per test. */
  postFineTuneEvalEnabled?: boolean;
  /** Suite to score against. Falls back to the whitelabel's pinned suite. */
  evalSuiteId?: string;
  /** Hard cap on tests executed per evaluation. 0 = uncapped. */
  evalMaxTests?: number;
  /** qaDelta above this proposes promotion (0.02 = 2 percentage points). */
  promotionThreshold?: number;
  /** qaDelta below this (negative) proposes a regression alert. */
  regressionThreshold?: number;
  /** Absolute score required to promote when no baseline exists. */
  promotionAbsoluteFloor?: number;
}

export interface MetaHarnessLoop {
  id: ObjectId;
  target: string;
  status: OrchestrationLoopStatus;
  config: MetaHarnessLoopConfig;
  activeIterationId?: string;
  completedIterationCount: number;
  nextIterationNumber: number;
  lastIterationAt?: number;
  lastError?: {
    message: string;
    iterationNumber: number;
    timestamp: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UpdateLoopConfigOptions {
  autonomyLevel?: AutonomyLevel;
  minSignalThreshold?: number;
  proposalExpiryHours?: number;
  intervalMs?: number;
  postFineTuneEvalEnabled?: boolean;
  evalSuiteId?: string;
  evalMaxTests?: number;
  promotionThreshold?: number;
  regressionThreshold?: number;
  promotionAbsoluteFloor?: number;
}

// ─── Iteration ───────────────────────────────────────────────────────

export interface MetaHarnessIteration {
  id: ObjectId;
  target: string;
  loopId: ObjectId;
  iterationNumber: number;
  status: IterationStatus;
  startedAt: number;
  completedAt?: number;
  signal?: FeedbackSignalSnapshot;
  report?: IterationReport;
  proposalIds: string[];
  steps: IterationStepRecord[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackSignalSnapshot {
  capturedAt: number;
  newManualEditPairs: number;
  newArenaWinnerPairs: number;
  newFineTuneFiles: Array<{
    fineTuneFileId: string;
    createdAt: number;
    numberOfPrompts: number;
  }>;
  avgRetrievalQuality: number | null;
  scoredMessageCount: number;
}

export interface IterationReport {
  headline: string;
  metrics: {
    trainingPairCount: number;
    newFineTuneFileCount: number;
    avgRetrievalQuality: number | null;
  };
  observations: string[];
}

export interface IterationStepRecord {
  name: string;
  startedAt: number;
  completedAt?: number;
  status: IterationStatus;
  error?: string;
  output?: Record<string, unknown>;
}

export interface ListIterationsOptions {
  limit?: number;
  cursor?: string;
}

// ─── Proposal ────────────────────────────────────────────────────────

export interface MetaHarnessProposal {
  id: ObjectId;
  target: string;
  iterationId: ObjectId;
  loopId: ObjectId;
  kind: ProposalKind;
  status: ProposalStatus;
  title: string;
  payload: Record<string, unknown>;
  actedAt?: number;
  actedBy?: string;
  actionReason?: string;
  executedJobId?: string;
  executedReleaseId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListProposalsOptions {
  status?: ProposalStatus;
  limit?: number;
  cursor?: string;
}

export interface RejectProposalOptions {
  reason?: string;
}
