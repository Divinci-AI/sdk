/**
 * Training Data Client
 *
 * Server-side training data generation and export operations.
 * Calls v1 consumer API (/api/v1/training-data/*).
 */

import { ServerHttpClient } from "../http-client.js";

// ─── Types ─────────────────────────────────────���─────────────

export interface TrainingDataJob {
  _id: string;
  status: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  source?: { type: string; _id: string };
  progress?: {
    chunksTotal: number;
    chunksProcessed: number;
    qaPairsGenerated: number;
    qaPairsFiltered: number;
  };
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingDataQAPair {
  question: string;
  answer: string;
  type: "factual" | "explanatory" | "application" | "reasoning";
  confidence: number;
  qualityScore: number;
  approved: boolean;
  metadata?: {
    groundedness?: number;
    relevance?: number;
    completeness?: number;
    diversity?: number;
  };
}

export interface TrainingDataResult {
  chunkIndex: number;
  sourceChunk: { text: string; index: number; tokens: number };
  qaPairs: TrainingDataQAPair[];
}

export interface GenerateOptions {
  llmModel?: string;
  qaPerChunk?: number;
  chunkSize?: number;
  qualityThreshold?: number;
}

export interface ExportOptions {
  title?: string;
  qualityThreshold?: number;
  approvedOnly?: boolean;
}

/**
 * Sampling strategy for selecting a representative subset from a large SFT dataset.
 * - "none": no sampling, take first N pairs (default)
 * - "random": uniform random sample
 * - "stratified": equal distribution across question types (factual/explanatory/application/reasoning)
 * - "quality-weighted": oversample high-quality pairs (70% top + 30% mid-range)
 * - "diverse": hybrid (60% type-stratified + 30% top-quality + 10% random)
 */
export type SamplingStrategy = "none" | "random" | "stratified" | "quality-weighted" | "diverse";

export interface ExportToQAOptions {
  targetSuiteIds: string[];
  qualityThreshold?: number;
  approvedOnly?: boolean;
  /**
   * When samplingStrategy is "none", acts as a cap.
   * When a sampling strategy is set, acts as the target sample size.
   */
  maxTests?: number;
  /** Sampling strategy for generating representative smoke test sets */
  samplingStrategy?: SamplingStrategy;
}

export interface CostEstimate {
  contentAnalysis: {
    totalTokens: number;
    estimatedChunks: number;
    qaPerChunk: number;
    totalQAPairs: number;
  };
  tokenUsage: {
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costs: {
    inputCostUSD: string;
    outputCostUSD: string;
    totalCostUSD: string;
    costPerPair: string;
    costPerChunk: string;
  };
  disclaimer: string;
}

export interface ExportResult {
  fineTuneFile: { _id: string; title: string; numberOfPrompts?: number };
  totalPairs: number;
}

export interface ExportToQAResult {
  success: boolean;
  testsCreated: number;
  testIds: string[];
  totalPairsScanned: number;
  pairsFiltered: number;
  pairsDeduped?: number;
  samplingStrategy?: SamplingStrategy;
  failedSuites: Array<{ _id: string; reason: string }>;
}

// ─── Client ──────────────────────────────────���───────────────

export class TrainingDataClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Estimate the cost of generating training data
   */
  async estimateCost(
    _workspaceId: string,
    sourceType: "RagFile" | "AudioTranscript",
    sourceId: string,
    options: Pick<GenerateOptions, "llmModel" | "qaPerChunk" | "chunkSize"> = {},
  ): Promise<CostEstimate> {
    const data = await this.httpClient.post<{ estimate: CostEstimate }>(
      "/api/v1/training-data/estimate-cost",
      {
        sourceType,
        sourceId,
        ...options,
      },
    );
    return data.estimate;
  }

  /**
   * Generate training data from a RAG file
   */
  async generateFromRag(
    _workspaceId: string,
    ragFileId: string,
    options: GenerateOptions = {},
  ): Promise<TrainingDataJob> {
    const data = await this.httpClient.post<{ job: TrainingDataJob }>(
      `/api/v1/training-data/generate/from-rag/${ragFileId}`,
      options,
    );
    return data.job;
  }

  /**
   * Generate training data from an audio transcript
   */
  async generateFromAudio(
    _workspaceId: string,
    audioId: string,
    options: GenerateOptions = {},
  ): Promise<TrainingDataJob> {
    const data = await this.httpClient.post<{ job: TrainingDataJob }>(
      `/api/v1/training-data/generate/from-audio/${audioId}`,
      options,
    );
    return data.job;
  }

  /**
   * List all training data generation jobs
   */
  async list(_workspaceId: string): Promise<TrainingDataJob[]> {
    return this.httpClient.get<TrainingDataJob[]>(
      "/api/v1/training-data/jobs",
    );
  }

  /**
   * Get a training data generation job by ID
   */
  async get(_workspaceId: string, jobId: string): Promise<TrainingDataJob> {
    return this.httpClient.get<TrainingDataJob>(
      `/api/v1/training-data/jobs/${jobId}`,
    );
  }

  /**
   * Get the generated Q&A pairs from a completed job
   */
  async results(_workspaceId: string, jobId: string): Promise<TrainingDataResult[]> {
    return this.httpClient.get<TrainingDataResult[]>(
      `/api/v1/training-data/jobs/${jobId}/results`,
    );
  }

  /**
   * Export training data to a fine-tune file
   */
  async exportToFineTune(
    _workspaceId: string,
    jobId: string,
    options: ExportOptions = {},
  ): Promise<ExportResult> {
    return this.httpClient.post<ExportResult>(
      `/api/v1/training-data/jobs/${jobId}/export`,
      options,
    );
  }

  /**
   * Export training data to QA test suites
   */
  async exportToQA(
    _workspaceId: string,
    jobId: string,
    options: ExportToQAOptions,
  ): Promise<ExportToQAResult> {
    return this.httpClient.post<ExportToQAResult>(
      `/api/v1/training-data/jobs/${jobId}/export-to-qa`,
      options,
    );
  }

  /**
   * Export training data to a RAG file (Phase 4D). Calls the
   * workspace-scoped sft-generation route which synthesizes each
   * approved Q/A pair into a declarative passage and ingests as
   * RAG chunks. See server-side
   * workspace/servers/public-api/src/ux/whitelabel/router/sft-generation/
   * export-to-rag.ts for the full body-param contract.
   */
  async exportToRag(
    whitelabelId: string,
    jobId: string,
    options: {
      ragSourceId?: string,
      ragVectors?: string[],
      synthesisMode?: "auto" | "synthesize" | "answer-only",
      autoThresholdChars?: number,
      enableRoundTripFilter?: boolean,
      roundTripSimilarityThreshold?: number,
      approvedOnly?: boolean,
      title?: string,
      force?: boolean,
      oneChunkPerPassage?: boolean,
      assistantTool?: { id: string, authId?: string, config?: Record<string, unknown> },
      synthesisConcurrency?: number,
      applyBgePrefixes?: boolean,
      attestWithTrustBench?: boolean,
    } = {},
  ): Promise<{
    ragVectorFileId: string,
    totalPairsProcessed: number,
    synthesizedCount: number,
    answerOnlyCount: number,
    droppedCount: number,
    meanQuestionPassageSimilarity: number,
    meanAnswerPassageSimilarity: number,
    synthesisCostNanoUsd: string,
    isBYOK: boolean,
    trustSynthesisRunId?: string,
    idempotent?: boolean,
  }> {
    return this.httpClient.post(
      `/api/v1/white-label/${whitelabelId}/sft-generation/${jobId}/export-to-rag`,
      options,
    );
  }

  /**
   * Cancel/delete a training data generation job
   */
  async cancel(_workspaceId: string, jobId: string): Promise<void> {
    await this.httpClient.delete(
      `/api/v1/training-data/jobs/${jobId}`,
    );
  }

  /**
   * Poll for job completion. Resolves when status is Completed or Failed.
   * Uses exponential backoff (2s → 30s) to avoid rate limits on long jobs.
   * Retries on 429 (rate limit) responses with Retry-After header respect.
   */
  async waitFor(
    _workspaceId: string,
    jobId: string,
    options: { pollMs?: number; signal?: AbortSignal; onProgress?: (job: TrainingDataJob) => void } = {},
  ): Promise<TrainingDataJob> {
    const { pollMs = 2000, signal, onProgress } = options;
    let interval = pollMs;
    const maxInterval = 30000;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (true) {
      if (signal?.aborted) throw new Error("Polling cancelled");

      try {
        const job = await this.get(_workspaceId, jobId);
        consecutiveErrors = 0;
        onProgress?.(job);

        if (job.status === "Completed" || job.status === "Failed" || job.status === "Cancelled") {
          return job;
        }
      } catch (err: any) {
        consecutiveErrors++;
        // On 429 (rate limit), back off aggressively
        if (err?.status === 429 || err?.statusCode === 429) {
          const retryAfter = parseInt(err?.headers?.["retry-after"] || "10", 10);
          interval = Math.max(interval, retryAfter * 1000);
        }
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Polling failed after ${maxConsecutiveErrors} consecutive errors: ${err?.message || err}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
      interval = Math.min(interval * 1.5, maxInterval);
    }
  }
}
