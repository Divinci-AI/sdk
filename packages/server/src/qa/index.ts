/**
 * QA Client
 *
 * Server-side QA suite management and validation run operations.
 * Calls v1 consumer API (/api/v1/qa/*).
 */

import { ServerHttpClient } from "../http-client.js";

// ─── Types ────────────────────────────────────────────���──────

export interface QASuite {
  _id: string;
  workspace: string;
  name: string;
  description?: string;
  tests: string[];
  scoreGenerators: Array<{ source: Record<string, unknown>; weight: number }>;
  suggestionGeneration?: Record<string, unknown>;
}

export interface QARunResult {
  success: boolean;
  iterationResultId: string;
  previousIterationResultId: string | null;
  releaseId: string;
  testCount: number;
  passedCount: number;
  errorCount: number;
  deadlineReached: boolean;
  overallScore: number | null;
  previousScore: number | null;
  delta: number | null;
  results: Array<{
    testId: string;
    prompt: string;
    overallScore: number | null;
    scores: Record<string, { score: number; weight: number; reasoning: string | string[] }>;
  }>;
  errors: Array<{ testId: string; error: string }>;
}

export interface ExternalAnswer {
  /** A test id from the suite. */
  testId: string;
  /** The external system's reply, verbatim. An empty string is recorded as an error for that test. */
  text: string;
  latencyMs?: number;
}

export interface StartExternalRunOptions {
  /** Name of the system being graded. Reused across runs of the same system. */
  targetName: string;
  targetDescription?: string;
  /** Where the answers came from and when. Free text, kept with the run. */
  sourceNote?: string;
  answers: ExternalAnswer[];
  judgeModelOverride?: string;
  concurrency?: number;
  /** Required when the run makes many judge calls (the server says so with a 402). */
  confirmCost?: boolean;
}

export interface StartExternalRunResult {
  success: boolean;
  runId: string;
  targetId: string;
  /** Key this system has in reports: `target:<targetId>`. */
  variantId: string;
  status: "running";
  judgeCalls: number;
}

export interface ExternalRun {
  _id: string;
  suiteId: string;
  targetId: string;
  variantId: string;
  status: "running" | "complete" | "failed";
  startedAt: number;
  completedAt: number | null;
  judge: { modelOverride: string | null; scorers: Array<{ scoreId: string; weight: number; rubricVersion: string | null }> };
  sourceNote: string;
  summary: { avgScore: number | null; testCount: number; scoredCount: number; unscoredCount: number; errorCount: number; refusalCount: number };
  report?: unknown;
  error: string | null;
}

export interface ExternalTarget {
  _id: string;
  name: string;
  description: string;
  kind: "imported" | "http";
  createdAt: number;
  http?: { url: string; model: string; timeoutMs: number; rpmCap: number; hasApiKey: boolean; termsAck: { by: string | null; at: number; version: string } | null };
}

export interface CreateExternalTargetOptions {
  name: string;
  description?: string;
  /** Full chat-completions URL. https, port 443, a public hostname. */
  url: string;
  model: string;
  /** Stored encrypted, never returned. */
  apiKey?: string;
  timeoutMs?: number;
  rpmCap?: number;
  /** Must be true: you may send the suite's questions to this system. */
  acknowledgeTerms: true;
  /** The terms version the server expects (it tells you if this is stale). */
  termsVersion: string;
}

export interface StartLiveExternalRunOptions {
  targetId: string;
  testIds?: string[];
  judgeModelOverride?: string;
  concurrency?: number;
  askConcurrency?: number;
  confirmCost?: boolean;
}

export interface CreateSuiteOptions {
  name: string;
  description?: string;
  scoreGenerators?: Array<{ source: Record<string, unknown>; weight: number }>;
  suggestionGeneration?: Record<string, unknown>;
}

export interface CopySuiteOptions {
  /** Source whitelabel (raw ID) to copy from */
  sourceWhitelabelId: string;
  /** Source QASuite ID to copy */
  sourceSuiteId: string;
  /** Optional name for the new suite (defaults to "<source> (copied)") */
  newSuiteName?: string;
  /**
   * Maps sourceFineTuneFileId → targetFineTuneFileId. If provided, tests with
   * "fine-tune-file" provenance get their fineTuneFileId remapped. Typically
   * the fileIdMap returned by client.fineTune.copyFilesFrom(...).
   */
  fineTuneFileIdMap?: Record<string, string>;
}

export interface CopySuiteResult {
  newSuiteId: string;
  testsCopied: number;
  testsWithRemappedProvenance: number;
  testsWithOrphanedProvenance: Array<{ newTestId: string; sourceFineTuneFileId: string }>;
  sourceWhitelabelId: string;
  targetWhitelabelId: string;
  sourceSuiteId: string;
}

export interface RunOptions {
  releaseId: string;
  testIds?: string[];
  concurrency?: number;
  maxTests?: number;
}

export interface ScoreGenerator {
  id: string;
  name: string;
  description: string;
  prompt?: string;
  invert?: boolean;
  defaultWeight?: number;
}

// ─── Client ──────────────────────────────────────────────────

export class QAClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  // --- Suites ---

  /**
   * List all QA suites
   */
  async listSuites(_workspaceId: string): Promise<QASuite[]> {
    return this.httpClient.get<QASuite[]>("/api/v1/qa/suites");
  }

  /**
   * Create a new QA suite
   */
  async createSuite(
    _workspaceId: string,
    options: CreateSuiteOptions,
  ): Promise<QASuite> {
    return this.httpClient.post<QASuite>("/api/v1/qa/suites", options);
  }

  /**
   * Get a QA suite by ID
   */
  async getSuite(_workspaceId: string, suiteId: string): Promise<QASuite> {
    return this.httpClient.get<QASuite>(`/api/v1/qa/suites/${suiteId}`);
  }

  /**
   * Update a QA suite
   */
  async updateSuite(
    _workspaceId: string,
    suiteId: string,
    updates: Partial<CreateSuiteOptions>,
  ): Promise<QASuite> {
    return this.httpClient.patch<QASuite>(
      `/api/v1/qa/suites/${suiteId}`,
      updates,
    );
  }

  /**
   * Delete a QA suite
   */
  async deleteSuite(_workspaceId: string, suiteId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/qa/suites/${suiteId}`);
  }

  /**
   * Copy a QASuite + all its ScoredQATests from a source whitelabel into the
   * caller's workspace. Optionally remap `fine-tune-file` provenance via a
   * fileIdMap — pass the one returned by `client.fineTune.copyFilesFrom(...)`
   * when backfilling a cloned workspace.
   */
  async copySuiteFrom(
    _workspaceId: string,
    options: CopySuiteOptions,
  ): Promise<CopySuiteResult> {
    return this.httpClient.post<CopySuiteResult>(
      "/api/v1/qa/suites/copy-from",
      {
        sourceWhitelabelId: options.sourceWhitelabelId,
        sourceSuiteId: options.sourceSuiteId,
        newSuiteName: options.newSuiteName,
        fineTuneFileIdMap: options.fineTuneFileIdMap,
      },
    );
  }

  // --- Runs ---

  /**
   * Run QA validation against a release.
   * Executes all tests in the suite, scores responses, and compares
   * against the previous iteration.
   */
  async run(
    _workspaceId: string,
    suiteId: string,
    options: RunOptions,
  ): Promise<QARunResult> {
    return this.httpClient.post<QARunResult>(
      `/api/v1/qa/suites/${suiteId}/run`,
      options,
    );
  }

  // --- External systems ---

  /**
   * Grade answers from an AI system Divinci does not run, using this suite's
   * scorers. Returns 202 with a runId; poll getExternalRun until it completes.
   * Nothing is sent to the external system; this is the import path.
   */
  async startExternalRun(
    _workspaceId: string,
    suiteId: string,
    options: StartExternalRunOptions,
  ): Promise<StartExternalRunResult> {
    return this.httpClient.post<StartExternalRunResult>(
      `/api/v1/qa/suites/${suiteId}/external-runs`,
      options,
    );
  }

  /** List a suite's external runs, newest first (reports omitted). */
  async listExternalRuns(_workspaceId: string, suiteId: string): Promise<{ runs: ExternalRun[] }> {
    return this.httpClient.get<{ runs: ExternalRun[] }>(`/api/v1/qa/suites/${suiteId}/external-runs`);
  }

  /** Get one external run with its report. Pass includeAnswers to also fetch the stored answers. */
  async getExternalRun(
    _workspaceId: string,
    runId: string,
    options: { includeAnswers?: boolean } = {},
  ): Promise<{ run: ExternalRun; answers?: unknown[] }> {
    const q = options.includeAnswers ? "?includeAnswers=true" : "";
    return this.httpClient.get<{ run: ExternalRun; answers?: unknown[] }>(`/api/v1/qa/external-runs/${runId}${q}`);
  }

  /** Register an OpenAI-compatible endpoint to ask. The API key is stored encrypted and never returned. */
  async createExternalTarget(_workspaceId: string, options: CreateExternalTargetOptions): Promise<{ target: ExternalTarget }> {
    return this.httpClient.post<{ target: ExternalTarget }>("/api/v1/qa/external-targets", options);
  }

  async listExternalTargets(_workspaceId: string): Promise<{ targets: ExternalTarget[] }> {
    return this.httpClient.get<{ targets: ExternalTarget[] }>("/api/v1/qa/external-targets");
  }

  /** Delete a target and its stored key. */
  async deleteExternalTarget(_workspaceId: string, targetId: string): Promise<{ deleted: boolean }> {
    return this.httpClient.delete<{ deleted: boolean }>(`/api/v1/qa/external-targets/${targetId}`);
  }

  /** Record whether this suite's questions may be sent outside Divinci. Live runs are refused until it is true. */
  async setExternalUse(
    _workspaceId: string,
    suiteId: string,
    body: { allowed: boolean; note?: string },
  ): Promise<{ externalUse: { suiteId: string; allowed: boolean; note: string; by: string | null; at: number | null } }> {
    return this.httpClient.put(`/api/v1/qa/suites/${suiteId}/external-use`, body);
  }

  async getExternalUse(
    _workspaceId: string,
    suiteId: string,
  ): Promise<{ externalUse: { suiteId: string; allowed: boolean; note: string; by: string | null; at: number | null } }> {
    return this.httpClient.get(`/api/v1/qa/suites/${suiteId}/external-use`);
  }

  /** Ask the target the suite's questions (prompts only) and score the replies. Returns 202; poll getExternalRun. */
  async startLiveExternalRun(
    _workspaceId: string,
    suiteId: string,
    options: StartLiveExternalRunOptions,
  ): Promise<StartExternalRunResult & { targetCalls: number }> {
    return this.httpClient.post(`/api/v1/qa/suites/${suiteId}/external-runs/live`, options);
  }

  /** Paired comparison of an external run against another external run or a release. */
  async compareExternalRun(
    _workspaceId: string,
    runId: string,
    options: { against: string; replicateSd?: number },
  ): Promise<{ comparison: unknown; disclosure: unknown; a: unknown; b: unknown }> {
    const q = new URLSearchParams({ against: options.against, ...(options.replicateSd !== undefined ? { replicateSd: String(options.replicateSd) } : {}) });
    return this.httpClient.get(`/api/v1/qa/external-runs/${runId}/compare?${q.toString()}`);
  }

  // --- Score Generators ---

  /**
   * List available built-in score generators
   */
  async listScoreGenerators(_workspaceId: string): Promise<ScoreGenerator[]> {
    return this.httpClient.get<ScoreGenerator[]>(
      "/api/v1/qa/score-generators/hard-coded",
    );
  }
}
