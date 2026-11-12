/**
 * Audio Client
 *
 * Server-side audio transcript management operations
 */

import type { PaginatedResponse } from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

/**
 * Audio transcript list options
 */
export interface ListAudioOptions {
  /** Maximum number of results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Audio transcript resource
 */
export interface AudioTranscript {
  /** Audio transcript ID */
  _id: string;
  /** Associated workspace ID */
  workspaceId: string;
  /** Audio file URL */
  url?: string;
  /** Processing status */
  status: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

/**
 * Audio RAG generation result
 */
export interface AudioRagResult {
  /** Whether generation was initiated */
  success: boolean;
  /** Status message */
  message?: string;
}

/**
 * Audio client for server-side operations
 */
export class AudioClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List audio transcripts for a workspace
   */
  async list(
    workspaceId: string,
    options: ListAudioOptions = {}
  ): Promise<PaginatedResponse<AudioTranscript>> {
    return this.httpClient.get<PaginatedResponse<AudioTranscript>>(
      `/api/v1/audio-transcripts`,
      {
        workspaceId,
        limit: options.limit,
        cursor: options.cursor,
      }
    );
  }

  /**
   * Get an audio transcript by ID
   */
  async get(audioId: string): Promise<AudioTranscript> {
    return this.httpClient.get<AudioTranscript>(`/api/v1/audio-transcripts/${audioId}`);
  }

  /**
   * Upload an audio file from a URL
   */
  async uploadFromUrl(workspaceId: string, url: string): Promise<AudioTranscript> {
    return this.httpClient.post<AudioTranscript>(`/api/v1/audio-transcripts/url`, {
      workspaceId,
      url,
    });
  }

  /**
   * Delete an audio transcript
   */
  async delete(audioId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/audio-transcripts/${audioId}`);
  }

  /**
   * Generate RAG data from an audio transcript
   */
  async generateRag(audioId: string): Promise<AudioRagResult> {
    return this.httpClient.post<AudioRagResult>(
      `/api/v1/audio-transcripts/${audioId}/generate-rag`
    );
  }
}
