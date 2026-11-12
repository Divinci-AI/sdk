/**
 * RAG Client
 *
 * Server-side RAG (Retrieval-Augmented Generation) operations
 */

import type {
  EmbeddingKeySource,
  EmbeddingModelInfo,
  RagCollection,
  RagDocument,
  RagSearchResult,
  CreateRagCollectionOptions,
  RagSearchOptions,
  ListDocumentsOptions,
  PaginatedResponse,
} from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";


/**
 * Normalize a /api/v1/rag/targets item (or raw vector doc) to the published
 * RagCollection shape. Fields the real API does not expose (chunkCount,
 * storageSizeBytes, chunkSize/chunkOverlap) are zero-filled — they were part
 * of the original aspirational SDK design and have no server counterpart yet.
 */
function toRagCollection(raw: Record<string, unknown>, workspaceId: string): RagCollection {
  const id = String(raw.id ?? raw._id ?? "");
  const status = String(raw.status ?? "ready");
  return {
    id,
    name: String(raw.title ?? raw.name ?? id),
    description: typeof raw.description === "string" ? raw.description : undefined,
    workspaceId,
    status: status === "ready" || status === "active" ? "active"
      : status === "error" ? "error"
      : status === "archived" ? "archived"
      : "processing",
    documentCount: Number(raw.fileCount ?? 0),
    chunkCount: 0,
    storageSizeBytes: 0,
    embeddingModel: String(raw.embeddingModel ?? ""),
    settings: {
      chunkSize: 0,
      chunkOverlap: 0,
      maxChunksPerQuery: Number(raw.contextPerMessage ?? 0),
      similarityThreshold: Number(raw.minimumSimilarity ?? 0),
    },
    metadata: (raw.metadata ?? {}) as RagCollection["metadata"],
  };
}

/**
 * Normalize a /api/v1/rag/files item (raw RagVectorFile2 doc, annotated with
 * `ragVectors`) to the published RagDocument shape.
 */
function toRagDocument(raw: Record<string, unknown>, fallbackCollectionId = ""): RagDocument {
  const ragVectors = Array.isArray(raw.ragVectors) ? (raw.ragVectors as Array<{ _id?: string }>) : [];
  const originalName = String(raw.originalFilename ?? raw.title ?? "");
  const rawStatus = String(raw.status ?? "pending");
  const status: RagDocument["status"] =
    rawStatus === "completed" ? "completed"
      : /fail|error/i.test(rawStatus) ? "error"
      : rawStatus === "pending" ? "pending"
      : "processing";
  return {
    id: String(raw._id ?? ""),
    collectionId: ragVectors[0]?._id ? String(ragVectors[0]._id) : fallbackCollectionId,
    originalName,
    fileType: originalName.includes(".") ? originalName.split(".").pop() ?? "" : "",
    mimeType: String(raw.mimeType ?? ""),
    fileSizeBytes: Number(raw.fileSizeBytes ?? 0),
    status,
    chunkCount: Number(raw.chunksCount ?? 0),
    error: typeof raw.failureReason === "string" ? raw.failureReason : undefined,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    documentMetadata: (raw.metadata ?? undefined) as Record<string, unknown> | undefined,
    metadata: {} as RagDocument["metadata"],
  };
}

/** Shape of one /api/v1/rag/context chunk. */
interface ContextChunk {
  content: string;
  score: number | null;
  source: string | null;
  fileId: string | null;
  vectorId: string | null;
}

function contextChunksToSearchResults(chunks: ContextChunk[], minScore?: number): RagSearchResult[] {
  return chunks
    .filter((c) => minScore === undefined || (c.score ?? 0) >= minScore)
    .map((c, i) => ({
      chunk: {
        id: c.vectorId ?? `chunk_${i}`,
        documentId: c.fileId ?? "",
        content: c.content,
        tokenCount: 0,
        chunkIndex: i,
      },
      score: c.score ?? 0,
      document: {
        id: c.fileId ?? "",
        originalName: c.source ?? "",
        fileType: "",
      },
    }));
}

/**
 * RAG client for server-side operations
 */
export class RagClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  // ============================================
  // Collection Operations
  // ============================================

  /**
   * List RAG collections for a workspace
   */
  async listCollections(
    workspaceId: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<PaginatedResponse<RagCollection>> {
    // Real route: GET /api/v1/rag/targets (workspace implied by the API key).
    // The previous /api/v1/whitelabel/... path never existed on the server.
    const response = await this.httpClient.get<{ targets: Array<Record<string, unknown>>; total: number }>(
      `/api/v1/rag/targets`
    );
    const all = (response.targets ?? []).map((t) => toRagCollection(t, workspaceId));
    const data = options.limit ? all.slice(0, options.limit) : all;
    return { data, hasMore: data.length < all.length, total: response.total ?? all.length };
  }

  /**
   * Get a RAG collection by ID
   */
  async getCollection(workspaceId: string, collectionId: string): Promise<RagCollection> {
    // No single-target GET exists on /api/v1 — resolve via the targets list.
    const response = await this.httpClient.get<{ targets: Array<Record<string, unknown>> }>(
      `/api/v1/rag/targets`
    );
    const match = (response.targets ?? []).find((t) => String(t.id) === collectionId);
    if (!match) {
      throw new Error(`RAG collection ${collectionId} not found in workspace ${workspaceId}`);
    }
    return toRagCollection(match, workspaceId);
  }

  /**
   * Create a new RAG collection
   */
  async createCollection(
    options: Omit<CreateRagCollectionOptions, "workspaceId"> & { workspaceId: string }
  ): Promise<RagCollection> {
    // Real route: POST /api/v1/rag/targets. The server requires a
    // vectorIndexTool; default to "vectorize" (the managed default backend).
    const response = await this.httpClient.post<Record<string, unknown>>(
      `/api/v1/rag/targets`,
      {
        title: options.name,
        vectorIndexTool: "vectorize",
        ...(options.embeddingModel && { embeddingModel: options.embeddingModel }),
        ...(options.embeddingAuthId && { embeddingAuthId: options.embeddingAuthId }),
        ...(options.settings?.similarityThreshold !== undefined && { minimumSimilarity: options.settings.similarityThreshold }),
        ...(options.settings?.maxChunksPerQuery !== undefined && { contextPerMessage: options.settings.maxChunksPerQuery }),
        ...(options.compressionStrategy && { compressionStrategy: options.compressionStrategy }),
        ...(options.compressionTargetRatio && { compressionTargetRatio: options.compressionTargetRatio }),
      }
    );
    const target = (response.collection ?? response.target ?? response) as Record<string, unknown>;
    return toRagCollection(target, options.workspaceId);
  }

  /**
   * Update a RAG collection's metadata (name, description)
   */
  async updateCollection(
    workspaceId: string,
    collectionId: string,
    options: {
      name?: string;
      description?: string;
      settings?: Partial<RagCollection["settings"]>;
    }
  ): Promise<RagCollection> {
    // Real route: PATCH /api/v1/rag/targets/:id — supports retrieval settings
    // (minimumSimilarity, contextPerMessage, embeddingModel, compression*).
    // The server does not support renaming via this surface; `name` and
    // `description` are accepted for signature compatibility but ignored.
    await this.httpClient.patch<Record<string, unknown>>(
      `/api/v1/rag/targets/${collectionId}`,
      {
        ...(options.settings?.similarityThreshold !== undefined && { minimumSimilarity: options.settings.similarityThreshold }),
        ...(options.settings?.maxChunksPerQuery !== undefined && { contextPerMessage: options.settings.maxChunksPerQuery }),
      }
    );
    return this.getCollection(workspaceId, collectionId);
  }

  /**
   * Update retrieval settings for a RAG collection.
   *
   * These settings affect query-time behavior only — no re-indexing required.
   *
   * @param workspaceId   - The workspace (whitelabel) ID
   * @param collectionId  - The RAG vector index ID
   * @param settings      - Fields to update (all optional)
   *   - minimumSimilarity:     Score threshold for vector search (0-1, default 0.62)
   *   - contextPerMessage:     Max chunks returned per query (default 5)
   *   - embeddingModel:        Embedding model for indexing and querying
   *   - compressionStrategy:   Context compression strategy (default "none")
   *   - compressionTargetRatio:Compression target ratio (2-128). Only meaningful
   *                            when compressionStrategy != "none".
   */
  async updateCollectionSettings(
    _workspaceId: string,
    collectionId: string,
    settings: {
      minimumSimilarity?: number;
      contextPerMessage?: number;
      embeddingModel?: string;
      /** BYOK key id (provider VOYAGE) to embed with, or null to go back to Divinci's key. */
      embeddingAuthId?: string | null;
      compressionStrategy?: import("@divinci-ai/types").CompressionStrategy;
      compressionTargetRatio?: number;
    }
  ): Promise<{ success: boolean; collection: { id: string; minimumSimilarity: number; contextPerMessage: number; embeddingModel?: string; compressionStrategy?: string; compressionTargetRatio?: number } }> {
    return this.httpClient.patch(
      `/api/v1/rag/targets/${collectionId}`,
      settings
    );
  }

  /**
   * List the embedding models this API offers, with their dimensions and who may hold each key.
   *
   * `keySource` is "divinci" (only Divinci's key), "byok" (only yours) or "either". Filtering is
   * done here, on the one list the server returns, so every client sees the same catalogue.
   * `keySource: "byok"` also matches "either": a model that takes both takes yours.
   */
  async listEmbeddingModels(
    options: { provider?: string; vectorDb?: string; keySource?: EmbeddingKeySource } = {}
  ): Promise<EmbeddingModelInfo[]> {
    const response = await this.httpClient.get<{ models: EmbeddingModelInfo[] }>(`/api/v1/rag/embedding-models`);
    return (response.models ?? []).filter((m) =>
      (!options.provider || m.provider === options.provider.toLowerCase())
      && (!options.vectorDb || m.compatibleVectorDbs.includes(options.vectorDb))
      && (!options.keySource || m.keySource === options.keySource || (options.keySource === "byok" && m.keySource === "either"))
    );
  }

  /**
   * Delete a RAG collection
   */
  async deleteCollection(_workspaceId: string, collectionId: string): Promise<void> {
    await this.httpClient.delete(
      `/api/v1/rag/targets/${collectionId}`
    );
  }

  // ============================================
  // Document Operations
  // ============================================

  /**
   * List documents in a collection
   */
  async listDocuments(
    _workspaceId: string,
    collectionId: string,
    options: Omit<ListDocumentsOptions, "collectionId"> = {}
  ): Promise<PaginatedResponse<RagDocument>> {
    // Real route: GET /api/v1/rag/files (page/limit). The server has no
    // collection-scoped file list, so the collection + status filters apply
    // client-side over the returned page (each file carries a `ragVectors`
    // annotation) — a page can therefore return fewer than `limit` matches.
    const page = options.cursor ? Math.max(parseInt(options.cursor, 10) || 1, 1) : 1;
    const limit = options.limit ?? 50;
    const files = await this.httpClient.get<Array<Record<string, unknown>>>(
      `/api/v1/rag/files`,
      { page, limit }
    );
    const rows = Array.isArray(files) ? files : [];
    const docs = rows
      .map((f) => toRagDocument(f, collectionId))
      .filter((d) => {
        const vectors = (rows.find((r) => String(r._id) === d.id)?.ragVectors ?? []) as Array<{ _id?: string }>;
        const inCollection = vectors.some((v) => String(v._id) === collectionId);
        const statusOk = !options.status || d.status === options.status;
        return inCollection && statusOk;
      });
    const hasMore = rows.length === limit;
    return { data: docs, hasMore, ...(hasMore ? { nextCursor: String(page + 1) } : {}) };
  }

  /**
   * Upload a document to a collection
   */
  async uploadDocument(
    _workspaceId: string,
    collectionId: string,
    file: Buffer | Blob,
    fileName: string,
    options: {
      mimeType?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<RagDocument> {
    // Real route: POST /api/v1/rag/files (multipart) — same contract the CLI
    // upload command uses. ragVectorIds assigns the file to the collection.
    const additionalFields: Record<string, string> = {
      ragVectorIds: JSON.stringify([collectionId]),
      title: fileName,
      description: "",
      chunkingTool: "langextract",
      chunkingToolConfig: JSON.stringify({ langextract: { chapterAware: false } }),
    };

    if (options.metadata) {
      additionalFields["metadata"] = JSON.stringify(options.metadata);
    }

    const response = await this.httpClient.upload<unknown>(
      `/api/v1/rag/files`,
      file,
      fileName,
      additionalFields
    );
    // The direct-create endpoint supports multi-file uploads and returns an
    // ARRAY of file docs; single-object {file} / flat shapes are tolerated.
    const raw = Array.isArray(response)
      ? (response[0] as Record<string, unknown>)
      : ((response as Record<string, unknown>).file ?? response) as Record<string, unknown>;
    return toRagDocument(raw ?? {}, collectionId);
  }

  /**
   * Get document status
   */
  async getDocument(
    _workspaceId: string,
    collectionId: string,
    documentId: string
  ): Promise<RagDocument> {
    const raw = await this.httpClient.get<Record<string, unknown>>(
      `/api/v1/rag/files/${documentId}`
    );
    return toRagDocument(raw, collectionId);
  }

  /**
   * Delete a document from a collection
   */
  async deleteDocument(
    _workspaceId: string,
    _collectionId: string,
    documentId: string
  ): Promise<void> {
    await this.httpClient.delete(
      `/api/v1/rag/files/${documentId}`
    );
  }

  /**
   * Reprocess a document (re-chunk and re-embed)
   */
  async reprocessDocument(
    workspaceId: string,
    collectionId: string,
    documentId: string
  ): Promise<RagDocument> {
    // Real route: POST /api/v1/rag/files/:fileId/reindex, then re-read the
    // doc so callers get the post-requeue status.
    await this.httpClient.post(
      `/api/v1/rag/files/${documentId}/reindex`
    );
    return this.getDocument(workspaceId, collectionId, documentId);
  }

  /**
   * Set or clear the source URL on a RAG file.
   *
   * The URL is shown as a clickable backlink on the chat context bubble for
   * every chunk of this file. HTML-scraped pages get it automatically at
   * ingestion; use this to assign a URL to uploads/transcripts (or correct
   * one). Pass `null` to clear. Only http(s) URLs are accepted (400 otherwise).
   *
   * Note: calls the workspace-scoped route directly (works with both a
   * workspace API key holding `whitelabel:rag` and an OAuth user token).
   */
  async setDocumentSourceUrl(
    workspaceId: string,
    documentId: string,
    sourceUrl: string | null
  ): Promise<{ _id: string; sourceUrl: string | null }> {
    return this.httpClient.post<{ _id: string; sourceUrl: string | null }>(
      `/white-label/${workspaceId}/rag-vector/files/${documentId}/source-url`,
      { sourceUrl }
    );
  }

  // ============================================
  // Search Operations
  // ============================================

  /**
   * Search across RAG collections
   */
  async search(
    _workspaceId: string,
    collectionId: string,
    query: string,
    options: Omit<RagSearchOptions, "collectionIds" | "query"> = {}
  ): Promise<RagSearchResult[]> {
    // Real route: POST /api/v1/rag/context — semantic retrieval against one
    // collection. minScore applies client-side (the server filters by the
    // collection's own minimumSimilarity setting).
    const response = await this.httpClient.post<{ chunks: ContextChunk[] }>(
      `/api/v1/rag/context`,
      {
        query,
        collectionId,
        ...(options.limit !== undefined && { topK: options.limit }),
      }
    );
    return contextChunksToSearchResults(response.chunks ?? [], options.minScore);
  }

  /**
   * Search across multiple collections
   */
  async searchMultiple(
    workspaceId: string,
    collectionIds: string[],
    query: string,
    options: Omit<RagSearchOptions, "collectionIds" | "query"> = {}
  ): Promise<RagSearchResult[]> {
    // No multi-collection endpoint exists on /api/v1 — fan out one /context
    // call per collection and merge by score. (If the collections share a
    // RagVectorGroup, prefer a single /context call with groupId.)
    const perCollection = await Promise.all(
      collectionIds.map((collectionId) =>
        this.search(workspaceId, collectionId, query, options).catch(() => [] as RagSearchResult[])
      )
    );
    const merged = perCollection.flat().sort((a, b) => b.score - a.score);
    return options.limit !== undefined ? merged.slice(0, options.limit) : merged;
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Upload multiple documents
   */
  async uploadDocuments(
    workspaceId: string,
    collectionId: string,
    files: Array<{
      file: Buffer | Blob;
      fileName: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<RagDocument[]> {
    const results: RagDocument[] = [];

    for (const { file, fileName, metadata } of files) {
      const doc = await this.uploadDocument(workspaceId, collectionId, file, fileName, {
        metadata,
      });
      results.push(doc);
    }

    return results;
  }

  /**
   * Wait for document processing to complete
   */
  async waitForProcessing(
    workspaceId: string,
    collectionId: string,
    documentId: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<RagDocument> {
    const { timeout = 300000, pollInterval = 2000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const doc = await this.getDocument(workspaceId, collectionId, documentId);

      if (doc.status === "completed" || doc.status === "error") {
        return doc;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Document processing timed out after ${timeout}ms`);
  }

  /**
   * Append a small text chunk to a RAG collection synchronously.
   *
   * Returns once the chunk is searchable (read-after-write contract).
   * Bypasses the chunks-workflow document pipeline — use this for
   * short individual memories / events, not full documents. For full
   * documents continue to use uploadDocument().
   *
   * Caps: text ≤16KB, metadata ≤4KB. Hard reject (413) over caps.
   *
   * Latency target: p95 ≤500ms returning, search of just-written
   * chunks ≤200ms p95.
   *
   * Phase 2 of the as-above-so-below-rts SDK integration. See
   * strategy/implementation/2026-05-05-phase2-rag-append-chunk.md
   * for the architecture.
   */
  async appendChunk(
    workspaceId: string,
    ragVectorId: string,
    options: AppendChunkOptions,
  ): Promise<AppendChunkResponse> {
    return this.httpClient.post<AppendChunkResponse>(
      `/api/v1/rag/${ragVectorId}/chunks/append`,
      {
        workspaceId,
        text: options.text,
        metadata: options.metadata,
      },
    );
  }

  /**
   * Search a RAG collection by semantic similarity.
   *
   * Backed by the workspace's configured mem0 resource. ragVectorId
   * scopes the search by mem0 user_id; mem0 handles query embedding,
   * cosine ranking, and threshold filtering server-side.
   *
   * Latency target: p95 ≤200ms, p99 ≤400ms for top-5.
   *
   * Phase 2 of the as-above-so-below-rts SDK integration.
   */
  async searchChunks(
    workspaceId: string,
    ragVectorId: string,
    options: SearchChunksOptions,
  ): Promise<SearchChunksResponse> {
    return this.httpClient.post<SearchChunksResponse>(
      `/api/v1/rag/${ragVectorId}/chunks/search`,
      {
        workspaceId,
        query: options.query,
        limit: options.limit,
        minScore: options.minScore,
        filter: options.filter,
      },
    );
  }
}

/**
 * Options for appending a chunk to a RAG collection.
 */
export interface AppendChunkOptions {
  /** Chunk text (≤16KB UTF-8) */
  text: string;
  /** Free-form metadata stored alongside the chunk (≤4KB JSON) */
  metadata?: Record<string, unknown>;
}

/**
 * Response from appendChunk.
 */
export interface AppendChunkResponse {
  /** Generated chunk ID assigned by the mem0 backing store */
  chunkId: string;
  /** Always true when this method returns 200 — read-after-write guarantee */
  searchable: true;
  /** Server-side processing latency in milliseconds */
  latencyMs: number;
}

/**
 * Options for searching chunks within a RAG collection.
 */
export interface SearchChunksOptions {
  /** Query text — embedded server-side and matched against chunk vectors */
  query: string;
  /** Max results to return. Default 5, max 50. */
  limit?: number;
  /** Minimum cosine similarity score (0-1). Default 0. */
  minScore?: number;
  /** Filter results by chunk metadata */
  filter?: Record<string, unknown>;
}

/**
 * One result from searchChunks.
 */
export interface ChunkSearchResult {
  chunkId: string;
  text: string;
  metadata?: Record<string, unknown>;
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Response from searchChunks.
 */
export interface SearchChunksResponse {
  results: ChunkSearchResult[];
  /** Server-side processing latency in milliseconds */
  latencyMs: number;
}
