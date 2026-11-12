/**
 * RAG (Retrieval-Augmented Generation) types
 */

import type { ObjectId, ResourceMetadata } from "./common.js";

/**
 * RAG collection
 */
export interface RagCollection {
  /** Collection ID */
  id: ObjectId;
  /** Collection name */
  name: string;
  /** Description */
  description?: string;
  /** Workspace ID */
  workspaceId: ObjectId;
  /** Collection status */
  status: RagCollectionStatus;
  /** Number of documents */
  documentCount: number;
  /** Number of chunks */
  chunkCount: number;
  /** Total storage size (bytes) */
  storageSizeBytes: number;
  /** Embedding model used */
  embeddingModel: string;
  /** Collection settings */
  settings: RagCollectionSettings;
  /** Resource metadata */
  metadata: ResourceMetadata;
}

/**
 * RAG collection status
 */
export type RagCollectionStatus = "active" | "processing" | "error" | "archived";

/**
 * RAG collection settings
 */
export interface RagCollectionSettings {
  /** Chunk size (tokens) */
  chunkSize: number;
  /** Chunk overlap (tokens) */
  chunkOverlap: number;
  /** Max chunks per query */
  maxChunksPerQuery: number;
  /** Similarity threshold (0-1) */
  similarityThreshold: number;
}

/**
 * RAG document (file)
 */
export interface RagDocument {
  /** Document ID */
  id: ObjectId;
  /** Collection ID */
  collectionId: ObjectId;
  /** Original file name */
  originalName: string;
  /** File type */
  fileType: string;
  /** MIME type */
  mimeType: string;
  /** File size (bytes) */
  fileSizeBytes: number;
  /** Processing status */
  status: RagDocumentStatus;
  /** Number of chunks created */
  chunkCount: number;
  /** Error message (if status is error) */
  error?: string;
  /** Original source page URL — rendered as a clickable backlink on chat
   * context bubbles. Set automatically for HTML-scraped pages; assignable
   * via setDocumentSourceUrl / PATCH files/:fileId for other sources. */
  sourceUrl?: string;
  /** Document metadata */
  documentMetadata?: Record<string, unknown>;
  /** Resource metadata */
  metadata: ResourceMetadata;
}

/**
 * RAG document processing status
 */
export type RagDocumentStatus =
  | "pending"
  | "uploading"
  | "processing"
  | "chunking"
  | "embedding"
  | "completed"
  | "error";

/**
 * RAG chunk (vector)
 */
export interface RagChunk {
  /** Chunk/vector ID */
  id: string;
  /** Document ID */
  documentId: ObjectId;
  /** Chunk content */
  content: string;
  /** Token count */
  tokenCount: number;
  /** Chunk index within document */
  chunkIndex: number;
  /** Page number (for PDFs) */
  pageNumber?: number;
  /** Chunk metadata */
  metadata?: Record<string, unknown>;
}

/**
 * RAG search result
 */
export interface RagSearchResult {
  /** Chunk */
  chunk: RagChunk;
  /** Similarity score (0-1) */
  score: number;
  /** Source document */
  document: {
    id: ObjectId;
    originalName: string;
    fileType: string;
  };
}

/**
 * Canonical context-compression strategies for RAG retrieval.
 *
 * **Mirror** of @divinci-ai/models COMPRESSION_STRATEGIES — the canonical
 * source on the server side. The drift-guard tests in both packages
 * (workspace/resources/models/tests/compression-strategies.test.ts and
 * workspace/sdk/packages/types/tests/compression-strategies.test.ts)
 * assert these arrays match exactly.
 *
 * **Adding a new strategy:** update both arrays atomically. Both
 * drift-guard tests will fail until the lists agree — that's intentional,
 * it forces atomic updates and prevents the regression class that bit
 * AS-514 twice (constants extraction reverted by linters/agents).
 */
export const COMPRESSION_STRATEGIES = [
  "none",
  "exit",
  "llmlingua2",
  "headroom",
  "recomp-extractive",
  "recomp-abstractive",
  "pisco",
  "clara",
  "core-rag",
] as const;
export type CompressionStrategy = typeof COMPRESSION_STRATEGIES[number];

/** Minimum compression ratio (2x = keep 50% of tokens). */
export const COMPRESSION_RATIO_MIN = 2;
/** Maximum compression ratio (128x = keep ~0.8% of tokens). */
export const COMPRESSION_RATIO_MAX = 128;

/**
 * Options for creating a RAG collection
 */
export interface CreateRagCollectionOptions {
  /** Collection name */
  name: string;
  /** Workspace ID */
  workspaceId: ObjectId;
  /** Description */
  description?: string;
  /** Collection settings */
  settings?: Partial<RagCollectionSettings>;
  /** Compression strategy applied to retrieved chunks before generation. Default: "none" */
  compressionStrategy?: CompressionStrategy;
  /** Compression target ratio (2-128). Only meaningful when compressionStrategy != "none". */
  compressionTargetRatio?: number;
  /**
   * Vector index backend. Accepted values are dispatched in chunks-workflow:
   * "cloudflare-v2" (default), "qdrant", "couchbase-byok",
   * "vertex-ai-vector-search-v2", "neo4j-hybrid", "pageindex".
   * Omitting falls back to the workspace-default backend.
   */
  vectorIndexTool?: string;
  /**
   * Embedding model id, e.g. "@cf/baai/bge-base-en-v1.5", "gemini-embedding-001@1536", "voyage-4".
   * List what is available, and who may hold each model's key, with `RagClient.listEmbeddingModels()`.
   * Omitting uses the server default.
   */
  embeddingModel?: string;
  /**
   * Id of a BYOK key (provider `VOYAGE`) in this workspace to embed with instead of Divinci's key.
   * A reference only. Valid for models whose `keySource` is "byok" or "either".
   */
  embeddingAuthId?: string;
}

/** Who may hold the credential behind an embedding model. */
export type EmbeddingKeySource = "divinci" | "byok" | "either";

/** One embedding model as `GET /api/v1/rag/embedding-models` returns it. */
export interface EmbeddingModelInfo {
  id: string;
  provider: string;
  displayName: string;
  dimensions: number;
  description?: string;
  compatibleVectorDbs: string[];
  recommended?: boolean;
  notes?: string;
  keySource: EmbeddingKeySource;
}

/**
 * Options for uploading a document
 */
export interface UploadDocumentOptions {
  /** Collection ID */
  collectionId: ObjectId;
  /** File to upload */
  file: File | Blob | Buffer;
  /** Original file name */
  fileName: string;
  /** MIME type */
  mimeType?: string;
  /** Document metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for searching RAG
 */
export interface RagSearchOptions {
  /** Collection IDs to search */
  collectionIds: ObjectId[];
  /** Search query */
  query: string;
  /** Max results */
  limit?: number;
  /** Minimum similarity score */
  minScore?: number;
  /** Filter by document metadata */
  filter?: Record<string, unknown>;
}

/**
 * Options for listing documents
 */
export interface ListDocumentsOptions {
  /** Collection ID */
  collectionId: ObjectId;
  /** Filter by status */
  status?: RagDocumentStatus;
  /** Limit results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}
