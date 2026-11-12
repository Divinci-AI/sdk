/**
 * Transcript Client
 *
 * Server-side transcript management operations
 */

import type { PaginatedResponse } from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

/**
 * Transcript list options
 */
export interface ListTranscriptsOptions {
  /** Maximum number of results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Create transcript options
 */
export interface CreateTranscriptOptions {
  /** Workspace ID */
  workspaceId: string;
  /** Optional release ID to associate */
  releaseId?: string;
}

/**
 * Add message options
 */
export interface AddMessageOptions {
  /** Message content */
  content: string;
  /** Message role */
  role: string;
}

/**
 * A single item in an ingestBatch payload.
 *
 * @deprecated Unused since `ingestBatch` was removed on 2026-08-07. Retained so
 * existing call sites still type-check and surface the deprecation on the
 * method itself rather than failing to resolve these types.
 */
export interface IngestBatchItem {
  /** Message role: "system" | "assistant" | "user" | "error" | "social" */
  role: string;
  /** Message content (≤64KB UTF-8) */
  content: string;
  /** Free-form telemetry attached to the message */
  metadata?: Record<string, unknown>;
  /** Optional release identifier to tag this message with */
  release?: string;
  /** Optional display name (e.g. assistant name) */
  name?: string;
  /** Optional epoch-ms timestamp; defaults to server now() */
  timestamp?: number;
  /** Optional ID of a prior message this replies to */
  replyTo?: string;
}

/**
 * Per-batch defaults applied UNDER each item's own fields.
 *
 * @deprecated Unused since `ingestBatch` was removed on 2026-08-07.
 */
export interface IngestBatchDefaults {
  /** Default metadata; per-item metadata wins on key collision */
  metadata?: Record<string, unknown>;
  /** Default release tag; per-item release wins if present */
  release?: string;
}

/**
 * ingestBatch options
 *
 * @deprecated Unused since `ingestBatch` was removed on 2026-08-07.
 */
export interface IngestBatchOptions {
  /** Workspace (whitelabel) ID */
  workspaceId: string;
  /** Transcript to append to. Caller-managed lifecycle. */
  transcriptId: string;
  /** Defaults merged UNDER per-item fields */
  defaults?: IngestBatchDefaults;
  /** Batch items (max 500, total ≤5MB) */
  items: IngestBatchItem[];
}

/**
 * ingestBatch response
 *
 * @deprecated Unused since `ingestBatch` was removed on 2026-08-07.
 */
export interface IngestBatchResponse {
  status: "ok";
  inserted: number;
  messageIds: string[];
}

/**
 * Transcript resource
 */
export interface Transcript {
  /** Transcript ID */
  _id: string;
  /** Associated workspace ID */
  workspaceId: string;
  /** Associated release ID */
  releaseId?: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

/**
 * Transcript message
 */
export interface TranscriptMessage {
  /** Message ID */
  _id: string;
  /** Transcript ID */
  transcriptId: string;
  /** Message content */
  content: string;
  /** Message role */
  role: string;
  /** Created timestamp */
  createdAt: string;
}

/**
 * Transcript client for server-side operations
 */
export class TranscriptClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List transcripts for a workspace
   */
  async list(
    workspaceId: string,
    options: ListTranscriptsOptions = {}
  ): Promise<PaginatedResponse<Transcript>> {
    return this.httpClient.get<PaginatedResponse<Transcript>>(
      `/api/v1/transcripts`,
      {
        workspaceId,
        limit: options.limit,
        cursor: options.cursor,
      }
    );
  }

  /**
   * Get a transcript by ID
   */
  async get(transcriptId: string): Promise<Transcript> {
    return this.httpClient.get<Transcript>(`/api/v1/transcripts/${transcriptId}`);
  }

  /**
   * Create a new transcript
   */
  async create(options: CreateTranscriptOptions): Promise<Transcript> {
    return this.httpClient.post<Transcript>(`/api/v1/transcripts`, {
      workspaceId: options.workspaceId,
      releaseId: options.releaseId,
    });
  }

  /**
   * Delete a transcript
   */
  async delete(transcriptId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/transcripts/${transcriptId}`);
  }

  /**
   * Add a message to a transcript
   */
  async addMessage(
    transcriptId: string,
    options: AddMessageOptions
  ): Promise<TranscriptMessage> {
    return this.httpClient.post<TranscriptMessage>(
      `/api/v1/transcripts/${transcriptId}/messages`,
      {
        content: options.content,
        role: options.role,
      }
    );
  }

  /**
   * @deprecated REMOVED on 2026-08-07. This method now always throws, and the
   * endpoint behind it answers 410 Gone.
   *
   * It was the only write path that skipped the message pipeline, as its own
   * documentation said: it bypassed moderation, de-identification, RAG
   * retrieval and inference, leaving PII redaction to the caller. Because the
   * route was mounted on the user surface, any workspace member could write
   * arbitrary roles — including `system`, which later turns replay to the model
   * as a real instruction — and raw PII persisted this way was re-sent to the
   * provider on every subsequent turn.
   *
   * There is no drop-in replacement, deliberately. If you run inference
   * yourself, persist it yourself. To have Divinci record a turn, use
   * `addMessage`, which runs the full pipeline.
   *
   * Kept as a throwing stub rather than deleted so upgrading callers get this
   * explanation instead of "property does not exist".
   */
  async ingestBatch(_options: IngestBatchOptions): Promise<IngestBatchResponse> {
    throw new Error(
      "transcripts.ingestBatch was removed on 2026-08-07: it bypassed moderation "
      + "and de-identification. Persist externally-generated turns on your own "
      + "infrastructure, or use transcripts.addMessage to have Divinci generate "
      + "and record the turn.",
    );
  }
}
