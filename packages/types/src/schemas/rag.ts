/**
 * RAG (Retrieval-Augmented Generation) Zod schemas
 */

import { z } from "zod";
import { ObjectIdSchema, ResourceMetadataSchema } from "./common.js";

/**
 * RAG collection status
 */
export const RagCollectionStatusSchema = z.enum(["active", "processing", "error", "archived"]);

/**
 * RAG collection settings
 */
export const RagCollectionSettingsSchema = z.object({
  /** Chunk size (tokens) */
  chunkSize: z.number().int().positive().max(8000),
  /** Chunk overlap (tokens) */
  chunkOverlap: z.number().int().nonnegative(),
  /** Max chunks per query */
  maxChunksPerQuery: z.number().int().positive().max(50),
  /** Similarity threshold (0-1) */
  similarityThreshold: z.number().min(0).max(1),
});

/**
 * RAG collection
 */
export const RagCollectionSchema = z.object({
  /** Collection ID */
  id: ObjectIdSchema,
  /** Collection name */
  name: z.string().min(1).max(200),
  /** Description */
  description: z.string().max(2000).optional(),
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** Collection status */
  status: RagCollectionStatusSchema,
  /** Number of documents */
  documentCount: z.number().int().nonnegative(),
  /** Number of chunks */
  chunkCount: z.number().int().nonnegative(),
  /** Total storage size (bytes) */
  storageSizeBytes: z.number().int().nonnegative(),
  /** Embedding model used */
  embeddingModel: z.string(),
  /** Collection settings */
  settings: RagCollectionSettingsSchema,
  /** Resource metadata */
  metadata: ResourceMetadataSchema,
});

/**
 * RAG document processing status
 */
export const RagDocumentStatusSchema = z.enum([
  "pending",
  "uploading",
  "processing",
  "chunking",
  "embedding",
  "completed",
  "error",
]);

/**
 * RAG document (file)
 */
export const RagDocumentSchema = z.object({
  /** Document ID */
  id: ObjectIdSchema,
  /** Collection ID */
  collectionId: ObjectIdSchema,
  /** Original file name */
  originalName: z.string(),
  /** File type */
  fileType: z.string(),
  /** MIME type */
  mimeType: z.string(),
  /** File size (bytes) */
  fileSizeBytes: z.number().int().nonnegative(),
  /** Processing status */
  status: RagDocumentStatusSchema,
  /** Number of chunks created */
  chunkCount: z.number().int().nonnegative(),
  /** Error message (if status is error) */
  error: z.string().optional(),
  /** Document metadata */
  documentMetadata: z.record(z.string(), z.unknown()).optional(),
  /** Resource metadata */
  metadata: ResourceMetadataSchema,
});

/**
 * RAG chunk (vector)
 */
export const RagChunkSchema = z.object({
  /** Chunk/vector ID */
  id: z.string(),
  /** Document ID */
  documentId: ObjectIdSchema,
  /** Chunk content */
  content: z.string(),
  /** Token count */
  tokenCount: z.number().int().nonnegative(),
  /** Chunk index within document */
  chunkIndex: z.number().int().nonnegative(),
  /** Page number (for PDFs) */
  pageNumber: z.number().int().positive().optional(),
  /** Chunk metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * RAG search result
 */
export const RagSearchResultSchema = z.object({
  /** Chunk */
  chunk: RagChunkSchema,
  /** Similarity score (0-1) */
  score: z.number().min(0).max(1),
  /** Source document */
  document: z.object({
    id: ObjectIdSchema,
    originalName: z.string(),
    fileType: z.string(),
  }),
});

/**
 * Options for creating a RAG collection
 */
export const CreateRagCollectionOptionsSchema = z.object({
  /** Collection name */
  name: z.string().min(1).max(200),
  /** Workspace ID */
  workspaceId: ObjectIdSchema,
  /** Description */
  description: z.string().max(2000).optional(),
  /** Collection settings */
  settings: RagCollectionSettingsSchema.partial().optional(),
  /**
   * Vector index backend. Accepted values are dispatched in chunks-workflow:
   * "cloudflare-v2" (default), "qdrant", "couchbase-byok",
   * "vertex-ai-vector-search-v2", "neo4j-hybrid", "pageindex".
   * Omitting falls back to the workspace-default backend.
   */
  vectorIndexTool: z.string().optional(),
});

/**
 * Options for uploading a document
 */
export const UploadDocumentOptionsSchema = z.object({
  /** Collection ID */
  collectionId: ObjectIdSchema,
  /** Original file name */
  fileName: z.string(),
  /** MIME type */
  mimeType: z.string().optional(),
  /** Document metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Options for searching RAG
 */
export const RagSearchOptionsSchema = z.object({
  /** Collection IDs to search */
  collectionIds: z.array(ObjectIdSchema).min(1),
  /** Search query */
  query: z.string().min(1),
  /** Max results */
  limit: z.number().int().positive().max(50).optional(),
  /** Minimum similarity score */
  minScore: z.number().min(0).max(1).optional(),
  /** Filter by document metadata */
  filter: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Options for listing documents
 */
export const ListDocumentsOptionsSchema = z.object({
  /** Collection ID */
  collectionId: ObjectIdSchema,
  /** Filter by status */
  status: RagDocumentStatusSchema.optional(),
  /** Limit results */
  limit: z.number().int().positive().max(100).optional(),
  /** Pagination cursor */
  cursor: z.string().optional(),
});

// Type exports using z.infer
export type RagCollectionStatus = z.infer<typeof RagCollectionStatusSchema>;
export type RagCollectionSettings = z.infer<typeof RagCollectionSettingsSchema>;
export type RagCollection = z.infer<typeof RagCollectionSchema>;
export type RagDocumentStatus = z.infer<typeof RagDocumentStatusSchema>;
export type RagDocument = z.infer<typeof RagDocumentSchema>;
export type RagChunk = z.infer<typeof RagChunkSchema>;
export type RagSearchResult = z.infer<typeof RagSearchResultSchema>;
export type CreateRagCollectionOptions = z.infer<typeof CreateRagCollectionOptionsSchema>;
export type UploadDocumentOptions = z.infer<typeof UploadDocumentOptionsSchema>;
export type RagSearchOptions = z.infer<typeof RagSearchOptionsSchema>;
export type ListDocumentsOptions = z.infer<typeof ListDocumentsOptionsSchema>;
