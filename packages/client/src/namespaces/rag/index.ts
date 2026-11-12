/**
 * RAG Namespace
 *
 * Provides access to RAG (Retrieval-Augmented Generation) operations
 * including vector index management, file operations, and search.
 *
 * @example
 * ```typescript
 * const sdk = new DivinciClient({ userToken: "...", releaseId: "..." });
 *
 * // Create a vector index
 * const vector = await sdk.rag.vectorIndex.create(
 *   { workspaceId: "ws-123" },
 *   { title: "My Docs", description: "...", vectorIndexTool: "qdrant" }
 * );
 *
 * // List vector indexes
 * const vectors = await sdk.rag.vectorIndex.list({ workspaceId: "ws-123" });
 * ```
 */

import { BaseNamespace, type NamespaceContext } from "../base.js";
import type { HttpClient } from "../../http-client.js";

/**
 * RAG Vector Index document (response type)
 */
export interface RagVectorDoc {
  _id: string;
  title: string;
  description: string;
  vectorIndexTool: string;
  whitelabelId: string;
  createdAt: number;
  updatedAt: number;
  fileCount?: number;
  status?: string;
}

/**
 * Create vector index request body
 */
export interface CreateVectorIndexBody {
  title: string;
  description: string;
  vectorIndexTool: string;
}

/**
 * Update vector index request body
 */
export interface UpdateVectorIndexBody {
  title: string;
  description: string;
}

/**
 * Fork vector index request body
 */
export interface ForkVectorIndexBody {
  title: string;
}

/**
 * Vector Index Namespace
 *
 * Manages RAG vector indexes (create, list, get, update, delete, fork)
 */
export class VectorIndexNamespace extends BaseNamespace {
  constructor(httpClient: HttpClient, context: NamespaceContext = {}) {
    super(httpClient, context);
  }

  /**
   * Create a new vector index
   *
   * @example
   * ```typescript
   * const vector = await sdk.rag.vectorIndex.create(
   *   { workspaceId: "ws-123" },
   *   { title: "My Docs", description: "Documentation", vectorIndexTool: "qdrant" }
   * );
   * ```
   */
  async create(
    params: { workspaceId?: string },
    body: CreateVectorIndexBody
  ): Promise<RagVectorDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<RagVectorDoc>(
      `/white-label/${workspaceId}/rag-vector`,
      body
    );
  }

  /**
   * List all vector indexes in a workspace
   *
   * @example
   * ```typescript
   * const vectors = await sdk.rag.vectorIndex.list({ workspaceId: "ws-123" });
   * ```
   */
  async list(params: { workspaceId?: string } = {}): Promise<RagVectorDoc[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<RagVectorDoc[]>(
      `/white-label/${workspaceId}/rag-vector`
    );
  }

  /**
   * Get a specific vector index
   *
   * @example
   * ```typescript
   * const vector = await sdk.rag.vectorIndex.get({
   *   workspaceId: "ws-123",
   *   ragId: "rag-456"
   * });
   * ```
   */
  async get(params: {
    workspaceId?: string;
    ragId: string;
  }): Promise<RagVectorDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<RagVectorDoc>(
      `/white-label/${workspaceId}/rag-vector/${params.ragId}`
    );
  }

  /**
   * Update vector index info (title, description)
   *
   * @example
   * ```typescript
   * const updated = await sdk.rag.vectorIndex.update(
   *   { workspaceId: "ws-123", ragId: "rag-456" },
   *   { title: "New Title", description: "New description" }
   * );
   * ```
   */
  async update(
    params: { workspaceId?: string; ragId: string },
    body: UpdateVectorIndexBody
  ): Promise<RagVectorDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<RagVectorDoc>(
      `/white-label/${workspaceId}/rag-vector/${params.ragId}/user-info`,
      body
    );
  }

  /**
   * Fork (clone) a vector index
   *
   * @example
   * ```typescript
   * const forked = await sdk.rag.vectorIndex.fork(
   *   { workspaceId: "ws-123", ragId: "rag-456" },
   *   { title: "Forked Index" }
   * );
   * ```
   */
  async fork(
    params: { workspaceId?: string; ragId: string },
    body: ForkVectorIndexBody
  ): Promise<RagVectorDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<RagVectorDoc>(
      `/white-label/${workspaceId}/rag-vector/${params.ragId}/fork`,
      body
    );
  }

  /**
   * Delete a vector index
   *
   * @example
   * ```typescript
   * await sdk.rag.vectorIndex.delete({
   *   workspaceId: "ws-123",
   *   ragId: "rag-456"
   * });
   * ```
   */
  async delete(params: {
    workspaceId?: string;
    ragId: string;
  }): Promise<RagVectorDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.delete<RagVectorDoc>(
      `/white-label/${workspaceId}/rag-vector/${params.ragId}`
    );
  }
}

/**
 * RAG Namespace
 *
 * Top-level namespace for RAG operations
 */
export class RagNamespace extends BaseNamespace {
  private _vectorIndex: VectorIndexNamespace | null = null;

  constructor(httpClient: HttpClient, context: NamespaceContext = {}) {
    super(httpClient, context);
  }

  /**
   * Vector index operations
   *
   * @example
   * ```typescript
   * // Create a vector index
   * await sdk.rag.vectorIndex.create({ workspaceId }, body);
   *
   * // List vector indexes
   * await sdk.rag.vectorIndex.list({ workspaceId });
   * ```
   */
  get vectorIndex(): VectorIndexNamespace {
    if (!this._vectorIndex) {
      this._vectorIndex = new VectorIndexNamespace(this.httpClient, this.context);
    }
    return this._vectorIndex;
  }

  /**
   * Create a new RAG namespace with workspace context
   */
  withWorkspace(workspaceId: string): RagNamespace {
    return new RagNamespace(
      this.httpClient,
      this.withContext({ workspaceId })
    );
  }
}
