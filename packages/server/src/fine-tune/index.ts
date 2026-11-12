/**
 * Fine-Tune Client
 *
 * Server-side fine-tuning job management operations
 */

import type { PaginatedResponse } from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

/**
 * Fine-tune job list options
 */
export interface ListFineTuneOptions {
  /** Maximum number of results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Create fine-tune job options
 */
export interface CreateFineTuneOptions {
  /** Workspace ID */
  workspaceId: string;
  /** Job name */
  name: string;
  /** Base model to fine-tune */
  baseModel: string;
  /** Training data */
  trainingData: unknown;
}

/**
 * Fine-tune job resource
 */
export interface FineTuneJob {
  /** Job ID */
  _id: string;
  /** Associated workspace ID */
  workspaceId: string;
  /** Job name */
  name: string;
  /** Base model */
  baseModel: string;
  /** Job status */
  status: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

/**
 * Fine-tune job status
 */
export interface FineTuneStatus {
  /** Job ID */
  jobId: string;
  /** Current status */
  status: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for exporting a FineTuneFile's pairs into ScoredQATest documents.
 */
export interface ExportFineTuneFileToQAOptions {
  /** One or more QASuite IDs to append created tests to */
  targetSuiteIds: string[];
  /**
   * Maximum number of tests to create (also acts as sample size when sampling
   * is enabled). Capped server-side at 500.
   */
  maxTests?: number;
  /**
   * Sampling strategy. "random" is recommended for FineTuneFile data (no type
   * or quality metadata to stratify on).
   */
  samplingStrategy?: "none" | "random" | "stratified" | "quality-weighted" | "diverse";
  /**
   * Target workspace for created tests (raw ID or condensed form). Defaults to
   * the file's own workspace.
   */
  workspaceOverride?: string;
}

/**
 * Options for copying FineTuneFiles from a source workspace into another.
 */
export interface CopyFineTuneFilesOptions {
  /** Source whitelabel ID (raw) */
  sourceWhitelabelId: string;
  /**
   * Specific source file IDs to copy. Omit to copy all FineTuneFiles on the
   * source workspace.
   */
  sourceFileIds?: string[];
  /**
   * Also copy cachedIds (Vertex AI / provider model refs). Defaults false
   * because cachedIds are tied to the source project/training run.
   */
  copyCachedIds?: boolean;
}

/**
 * Result of copying FineTuneFiles from one workspace to another.
 */
export interface CopyFineTuneFilesResult {
  copied: Array<{
    sourceFileId: string;
    newFileId: string;
    title: string;
    newObjectKey: string;
  }>;
  skipped: Array<{ sourceFileId: string; reason: string }>;
  failed: Array<{ sourceFileId: string; reason: string }>;
  /** Maps sourceFileId → newFileId. Use to remap test provenance. */
  fileIdMap: Record<string, string>;
  sourceWhitelabelId: string;
  targetWhitelabelId: string;
}

/**
 * Result of exporting a FineTuneFile to ScoredQATest documents.
 */
export interface ExportFineTuneFileToQAResult {
  testsCreated: number;
  testIds: string[];
  totalPairsScanned: number;
  pairsDeduped: number;
  samplingStrategy: "none" | "random" | "stratified" | "quality-weighted" | "diverse";
  fineTuneFileId: string;
  fineTuneFileTitle: string;
  failedSuites?: Array<{ _id: string; reason: string }>;
}

/**
 * Fine-tune client for server-side operations
 */
export class FineTuneClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List the fine-tuner tools/base models available on the platform.
   * Keyed by tool id (e.g. "tinker-qwen3-8b-lora") — the id is what
   * `create()` accepts as the base model identifier.
   */
  async listModels(): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(
      `/api/v1/fine-tune/models`,
    );
  }

  /**
   * List fine-tune jobs for a workspace
   */
  async list(
    workspaceId: string,
    options: ListFineTuneOptions = {}
  ): Promise<PaginatedResponse<FineTuneJob>> {
    return this.httpClient.get<PaginatedResponse<FineTuneJob>>(
      `/api/v1/fine-tune/jobs`,
      {
        workspaceId,
        limit: options.limit,
        cursor: options.cursor,
      }
    );
  }

  /**
   * Get a fine-tune job by ID
   */
  async get(jobId: string): Promise<FineTuneJob> {
    return this.httpClient.get<FineTuneJob>(`/api/v1/fine-tune/jobs/${jobId}`);
  }

  /**
   * Create a new fine-tune job
   */
  async create(options: CreateFineTuneOptions): Promise<FineTuneJob> {
    return this.httpClient.post<FineTuneJob>(`/api/v1/fine-tune/jobs`, {
      workspaceId: options.workspaceId,
      name: options.name,
      baseModel: options.baseModel,
      trainingData: options.trainingData,
    });
  }

  /**
   * Delete a fine-tune job
   */
  async delete(jobId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/fine-tune/jobs/${jobId}`);
  }

  /**
   * Start a fine-tune job
   */
  async start(jobId: string): Promise<FineTuneJob> {
    return this.httpClient.post<FineTuneJob>(`/api/v1/fine-tune/jobs/${jobId}/start`);
  }

  /**
   * Get the status of a fine-tune job
   */
  async status(jobId: string): Promise<FineTuneStatus> {
    return this.httpClient.get<FineTuneStatus>(`/api/v1/fine-tune/jobs/${jobId}/status`);
  }

  /**
   * Cancel a running fine-tune job
   */
  async cancel(jobId: string): Promise<FineTuneJob> {
    return this.httpClient.post<FineTuneJob>(`/api/v1/fine-tune/jobs/${jobId}/cancel`);
  }

  /**
   * Sample Q&A pairs from an existing FineTuneFile and create ScoredQATest
   * documents in one or more target QA suites. Bridges pre-existing
   * fine-tuning training data into the QA scoring system without regeneration.
   */
  /**
   * Copy FineTuneFiles from a source whitelabel into the caller's workspace.
   * Backfill utility for clones that were created before the clone wizard
   * carried FT files over. Returns a fileIdMap so you can remap downstream
   * references like ScoredQATest provenance.
   */
  async copyFilesFrom(
    options: CopyFineTuneFilesOptions,
  ): Promise<CopyFineTuneFilesResult> {
    return this.httpClient.post<CopyFineTuneFilesResult>(
      `/api/v1/fine-tune/files/copy-from`,
      {
        sourceWhitelabelId: options.sourceWhitelabelId,
        sourceFileIds: options.sourceFileIds,
        copyCachedIds: options.copyCachedIds,
      },
    );
  }

  async exportFileToQA(
    fileId: string,
    options: ExportFineTuneFileToQAOptions,
  ): Promise<ExportFineTuneFileToQAResult> {
    return this.httpClient.post<ExportFineTuneFileToQAResult>(
      `/api/v1/fine-tune/files/${fileId}/export-to-qa`,
      {
        targetSuiteIds: options.targetSuiteIds,
        maxTests: options.maxTests,
        samplingStrategy: options.samplingStrategy,
        workspaceOverride: options.workspaceOverride,
      },
    );
  }
}
