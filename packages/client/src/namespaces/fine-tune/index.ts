/**
 * Fine-Tune Namespace
 *
 * Handles fine-tuning jobs and training file management.
 */

import { BaseNamespace } from "../base.js";

/**
 * Fine-tune job document
 */
export interface FineTuneDoc {
  _id: string;
  whitelabelId: string;
  title: string;
  description?: string;
  finetuneTool: string;
  status: "pending" | "processing" | "training" | "completed" | "failed";
  baseModel?: string;
  hyperparameters?: FineTuneHyperparameters;
  trainingFileIds?: string[];
  validationFileIds?: string[];
  resultModelId?: string;
  metrics?: FineTuneMetrics;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fine-tune hyperparameters
 */
export interface FineTuneHyperparameters {
  epochs?: number;
  batchSize?: number;
  learningRateMultiplier?: number;
}

/**
 * Fine-tune metrics
 */
export interface FineTuneMetrics {
  trainingLoss?: number;
  validationLoss?: number;
  trainingAccuracy?: number;
  validationAccuracy?: number;
}

/**
 * Create fine-tune body
 */
export interface CreateFineTuneBody {
  title: string;
  description?: string;
  finetuneTool: string;
  baseModel?: string;
  hyperparameters?: FineTuneHyperparameters;
  trainingFileIds?: string[];
  validationFileIds?: string[];
}

/**
 * Fork fine-tune body
 */
export interface ForkFineTuneBody {
  title: string;
}

/**
 * Fine-tune file document
 */
export interface FineTuneFileDoc {
  _id: string;
  whitelabelId: string;
  name: string;
  description?: string;
  format: "jsonl" | "csv";
  size: number;
  rowCount?: number;
  status: "pending" | "processing" | "ready" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fine-tune file transcript entry
 */
export interface FineTuneFileEntry {
  prompt: string;
  completion: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create fine-tune file body
 */
export interface CreateFineTuneFileBody {
  file: File | Blob;
  name: string;
  description?: string;
}

/**
 * Fine-tune files sub-namespace
 */
export class FineTuneFilesNamespace extends BaseNamespace {
  /**
   * Upload a training file
   */
  async upload(
    params: { workspaceId?: string },
    body: CreateFineTuneFileBody
  ): Promise<FineTuneFileDoc> {
    const workspaceId = this.getWorkspaceId(params);
    const formData = new FormData();
    formData.append("file", body.file);
    formData.append("name", body.name);
    if (body.description) formData.append("description", body.description);

    return this.httpClient.postFormData<FineTuneFileDoc>(
      `/white-label/${workspaceId}/fine-tune/files`,
      formData
    );
  }

  /**
   * List training files
   */
  async list(params: { workspaceId?: string } = {}): Promise<FineTuneFileDoc[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<FineTuneFileDoc[]>(
      `/white-label/${workspaceId}/fine-tune/files`
    );
  }

  /**
   * Get a training file by ID
   */
  async get(params: { workspaceId?: string; fileId: string }): Promise<FineTuneFileDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<FineTuneFileDoc>(
      `/white-label/${workspaceId}/fine-tune/files/${params.fileId}`
    );
  }

  /**
   * Get the contents of a training file
   */
  async getContents(
    params: { workspaceId?: string; fileId: string }
  ): Promise<FineTuneFileEntry[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<FineTuneFileEntry[]>(
      `/white-label/${workspaceId}/fine-tune/files/${params.fileId}/contents`
    );
  }

  /**
   * Delete a training file
   */
  async delete(params: { workspaceId?: string; fileId: string }): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.delete(
      `/white-label/${workspaceId}/fine-tune/files/${params.fileId}`
    );
  }
}

/**
 * Fine-Tune Namespace
 *
 * Manages fine-tuning jobs and training data.
 *
 * @example
 * ```typescript
 * // Upload training file
 * const file = await client.fineTune.files.upload(
 *   { workspaceId: "ws-123" },
 *   { file: trainingFile, name: "training-data.jsonl" }
 * );
 *
 * // Create fine-tune job
 * const job = await client.fineTune.create(
 *   { workspaceId: "ws-123" },
 *   {
 *     title: "Customer Support Model",
 *     finetuneTool: "openai",
 *     trainingFileIds: [file._id]
 *   }
 * );
 *
 * // Check status
 * const status = await client.fineTune.get({ workspaceId: "ws-123", jobId: job._id });
 * ```
 */
export class FineTuneNamespace extends BaseNamespace {
  private filesNs: FineTuneFilesNamespace | null = null;

  /**
   * Training files sub-namespace
   */
  get files(): FineTuneFilesNamespace {
    if (!this.filesNs) {
      this.filesNs = new FineTuneFilesNamespace(this.httpClient, this.context);
    }
    return this.filesNs;
  }

  /**
   * Create a new fine-tune job
   */
  async create(
    params: { workspaceId?: string },
    body: CreateFineTuneBody
  ): Promise<FineTuneDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<FineTuneDoc>(
      `/white-label/${workspaceId}/fine-tune`,
      body
    );
  }

  /**
   * List fine-tune jobs
   */
  async list(params: { workspaceId?: string } = {}): Promise<FineTuneDoc[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<FineTuneDoc[]>(
      `/white-label/${workspaceId}/fine-tune`
    );
  }

  /**
   * Get a fine-tune job by ID
   */
  async get(params: { workspaceId?: string; jobId: string }): Promise<FineTuneDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<FineTuneDoc>(
      `/white-label/${workspaceId}/fine-tune/${params.jobId}`
    );
  }

  /**
   * Fork a fine-tune job
   */
  async fork(
    params: { workspaceId?: string; jobId: string },
    body: ForkFineTuneBody
  ): Promise<FineTuneDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<FineTuneDoc>(
      `/white-label/${workspaceId}/fine-tune/${params.jobId}/fork`,
      body
    );
  }

  /**
   * Delete a fine-tune job
   */
  async delete(params: { workspaceId?: string; jobId: string }): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.delete(
      `/white-label/${workspaceId}/fine-tune/${params.jobId}`
    );
  }

  /**
   * Start/run a fine-tune job
   */
  async start(params: { workspaceId?: string; jobId: string }): Promise<FineTuneDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<FineTuneDoc>(
      `/white-label/${workspaceId}/fine-tune/${params.jobId}/start`,
      {}
    );
  }

  /**
   * Cancel a running fine-tune job
   */
  async cancel(params: { workspaceId?: string; jobId: string }): Promise<FineTuneDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<FineTuneDoc>(
      `/white-label/${workspaceId}/fine-tune/${params.jobId}/cancel`,
      {}
    );
  }

  /**
   * Create a scoped FineTuneNamespace with a preset workspaceId
   */
  withWorkspace(workspaceId: string): FineTuneNamespace {
    return new FineTuneNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
