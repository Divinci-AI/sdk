/**
 * Audio Namespace
 *
 * Handles audio transcription, voiceprints, and related operations.
 */

import { BaseNamespace } from "../base.js";

/**
 * Audio transcript document
 */
export interface AudioTranscriptDoc {
  _id: string;
  whitelabelId: string;
  title: string;
  status: "pending" | "processing" | "completed" | "failed";
  duration?: number;
  speakers?: AudioSpeaker[];
  transcript?: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Audio speaker
 */
export interface AudioSpeaker {
  id: string;
  name: string;
  voiceprintId?: string;
}

/**
 * Transcript segment
 */
export interface TranscriptSegment {
  speakerId: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Voiceprint document
 */
export interface VoiceprintDoc {
  _id: string;
  whitelabelId: string;
  name: string;
  diarizerTool: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Upload audio body
 */
export interface UploadAudioBody {
  /** Audio file to upload */
  mediaFile: File | Blob;
  /** Title for the transcript */
  title?: string;
  /** Diarization tool to use */
  diarizerTool?: string;
  /** Transcription tool to use */
  transcriberTool?: string;
}

/**
 * Upload audio from URL body
 */
export interface UploadAudioFromUrlBody {
  /** URL of the audio file */
  url: string;
  /** Title for the transcript */
  title?: string;
  /** Diarization tool to use */
  diarizerTool?: string;
  /** Transcription tool to use */
  transcriberTool?: string;
}

/**
 * Update audio body
 */
export interface UpdateAudioBody {
  /** New title */
  title?: string;
  /** Speaker mappings */
  speakers?: Array<{ id: string; name: string; voiceprintId?: string }>;
}

/**
 * Generate RAG file body
 */
export interface GenerateRagFileBody {
  /** Speaker mappings for context */
  speakers?: Array<{ id: string; name: string }>;
  /** Chunking tool to use */
  chunkingTool?: string;
  /** Text cleaners to apply */
  cleaners?: string[];
  /** Target RAG vector IDs */
  ragVectors?: string[];
}

/**
 * Generate fine-tune file body
 */
export interface GenerateFineTuneFileBody {
  /** Speakers to use as prompters */
  prompters: string[];
  /** Speakers to use as responders */
  responders: string[];
}

/**
 * Bulk operations body
 */
export interface BulkAudioBody {
  /** Audio IDs to process */
  audioIds: string[];
}

/**
 * Bulk generate RAG files body
 */
export interface BulkGenerateRagFilesBody extends BulkAudioBody {
  /** Speaker mappings */
  speakers?: Array<{ id: string; name: string }>;
  /** Chunking tool */
  chunkingTool?: string;
  /** Target RAG vectors */
  ragVectors?: string[];
}

/**
 * Voiceprints sub-namespace
 */
export class VoiceprintsNamespace extends BaseNamespace {
  /**
   * List voiceprints for the workspace
   */
  async list(
    params: { workspaceId?: string; diarizerTool?: string } = {}
  ): Promise<VoiceprintDoc[]> {
    const workspaceId = this.getWorkspaceId(params);
    const queryParams = params.diarizerTool
      ? `?diarizerTool=${encodeURIComponent(params.diarizerTool)}`
      : "";
    return this.httpClient.get<VoiceprintDoc[]>(
      `/white-label/${workspaceId}/voiceprints${queryParams}`
    );
  }

  /**
   * Get a voiceprint by ID
   */
  async get(params: { workspaceId?: string; voiceprintId: string }): Promise<VoiceprintDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<VoiceprintDoc>(
      `/white-label/${workspaceId}/voiceprints/${params.voiceprintId}`
    );
  }

  /**
   * Delete a voiceprint
   */
  async delete(params: { workspaceId?: string; voiceprintId: string }): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.delete(
      `/white-label/${workspaceId}/voiceprints/${params.voiceprintId}`
    );
  }
}

/**
 * Bulk operations sub-namespace
 */
export class AudioBulkNamespace extends BaseNamespace {
  /**
   * Bulk generate RAG files from audio transcripts
   */
  async generateRagFiles(
    params: { workspaceId?: string },
    body: BulkGenerateRagFilesBody
  ): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.post(
      `/white-label/${workspaceId}/data-source/audio/bulk/rag-files`,
      body
    );
  }

  /**
   * Bulk reprocess audio files
   */
  async reprocess(params: { workspaceId?: string }, body: BulkAudioBody): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.post(
      `/white-label/${workspaceId}/data-source/audio/bulk/reprocess`,
      body
    );
  }

  /**
   * Bulk delete audio files
   */
  async delete(params: { workspaceId?: string }, body: BulkAudioBody): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.post(
      `/white-label/${workspaceId}/data-source/audio/bulk/delete`,
      body
    );
  }
}

/**
 * Audio Namespace
 *
 * Handles audio transcription, voiceprints, and related operations.
 *
 * @example
 * ```typescript
 * // Upload audio file
 * const transcript = await client.audio.upload(
 *   { workspaceId: "ws-123" },
 *   { mediaFile: file, title: "Meeting Recording" }
 * );
 *
 * // List voiceprints
 * const voiceprints = await client.audio.voiceprints.list({ workspaceId: "ws-123" });
 *
 * // Bulk operations
 * await client.audio.bulk.reprocess({ workspaceId: "ws-123" }, { audioIds: ["a1", "a2"] });
 * ```
 */
export class AudioNamespace extends BaseNamespace {
  private voiceprintsNs: VoiceprintsNamespace | null = null;
  private bulkNs: AudioBulkNamespace | null = null;

  /**
   * Voiceprints sub-namespace
   */
  get voiceprints(): VoiceprintsNamespace {
    if (!this.voiceprintsNs) {
      this.voiceprintsNs = new VoiceprintsNamespace(this.httpClient, this.context);
    }
    return this.voiceprintsNs;
  }

  /**
   * Bulk operations sub-namespace
   */
  get bulk(): AudioBulkNamespace {
    if (!this.bulkNs) {
      this.bulkNs = new AudioBulkNamespace(this.httpClient, this.context);
    }
    return this.bulkNs;
  }

  /**
   * Upload an audio file for transcription
   */
  async upload(
    params: { workspaceId?: string },
    body: UploadAudioBody
  ): Promise<AudioTranscriptDoc> {
    const workspaceId = this.getWorkspaceId(params);
    const formData = new FormData();
    formData.append("mediaFile", body.mediaFile);
    if (body.title) formData.append("title", body.title);
    if (body.diarizerTool) formData.append("diarizerTool", body.diarizerTool);
    if (body.transcriberTool) formData.append("transcriberTool", body.transcriberTool);

    return this.httpClient.postFormData<AudioTranscriptDoc>(
      `/white-label/${workspaceId}/data-source/audio`,
      formData
    );
  }

  /**
   * Upload audio from a URL
   */
  async uploadFromUrl(
    params: { workspaceId?: string },
    body: UploadAudioFromUrlBody
  ): Promise<AudioTranscriptDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<AudioTranscriptDoc>(
      `/white-label/${workspaceId}/data-source/audio/url`,
      body
    );
  }

  /**
   * List audio transcripts
   */
  async list(params: { workspaceId?: string } = {}): Promise<AudioTranscriptDoc[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<AudioTranscriptDoc[]>(
      `/white-label/${workspaceId}/data-source/audio`
    );
  }

  /**
   * Get an audio transcript by ID
   */
  async get(params: { workspaceId?: string; audioId: string }): Promise<AudioTranscriptDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<AudioTranscriptDoc>(
      `/white-label/${workspaceId}/data-source/audio/${params.audioId}`
    );
  }

  /**
   * Update an audio transcript
   */
  async update(
    params: { workspaceId?: string; audioId: string },
    body: UpdateAudioBody
  ): Promise<AudioTranscriptDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.patch<AudioTranscriptDoc>(
      `/white-label/${workspaceId}/data-source/audio/${params.audioId}`,
      body
    );
  }

  /**
   * Delete an audio transcript
   */
  async delete(params: { workspaceId?: string; audioId: string }): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.delete(
      `/white-label/${workspaceId}/data-source/audio/${params.audioId}`
    );
  }

  /**
   * Generate RAG file from audio transcript
   */
  async generateRagFile(
    params: { workspaceId?: string; audioId: string },
    body: GenerateRagFileBody
  ): Promise<AudioTranscriptDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<AudioTranscriptDoc>(
      `/white-label/${workspaceId}/data-source/audio/${params.audioId}/rag-file`,
      body
    );
  }

  /**
   * Generate fine-tune file from audio transcript
   */
  async generateFineTuneFile(
    params: { workspaceId?: string; audioId: string },
    body: GenerateFineTuneFileBody
  ): Promise<AudioTranscriptDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<AudioTranscriptDoc>(
      `/white-label/${workspaceId}/data-source/audio/${params.audioId}/finetune-file`,
      body
    );
  }

  /**
   * Create a scoped AudioNamespace with a preset workspaceId
   */
  withWorkspace(workspaceId: string): AudioNamespace {
    return new AudioNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
