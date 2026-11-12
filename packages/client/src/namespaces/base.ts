/**
 * Base Namespace class for SDK resource namespaces
 *
 * Provides common functionality for all namespaces including:
 * - HTTP client access
 * - Context inheritance (workspaceId, releaseId)
 * - Lazy sub-namespace initialization
 */

import type { HttpClient } from "../http-client.js";

/**
 * Context passed to namespaces
 */
export interface NamespaceContext {
  /** Workspace ID (used for workspace-scoped operations) */
  workspaceId?: string;
  /** Release ID (used for release-scoped operations) */
  releaseId?: string;
}

/**
 * Base class for all SDK namespaces
 *
 * @example
 * ```typescript
 * class RagNamespace extends BaseNamespace {
 *   private _vectorIndex: VectorIndexNamespace | null = null;
 *
 *   get vectorIndex(): VectorIndexNamespace {
 *     if (!this._vectorIndex) {
 *       this._vectorIndex = new VectorIndexNamespace(this.httpClient, this.context);
 *     }
 *     return this._vectorIndex;
 *   }
 * }
 * ```
 */
export abstract class BaseNamespace {
  /** HTTP client for making API requests */
  protected readonly httpClient: HttpClient;
  /** Context with workspace and release IDs */
  protected readonly context: NamespaceContext;

  constructor(httpClient: HttpClient, context: NamespaceContext = {}) {
    this.httpClient = httpClient;
    this.context = context;
  }

  /**
   * Get workspace ID from context or params
   * Throws if workspaceId is required but not provided
   */
  protected getWorkspaceId(params?: { workspaceId?: string }): string {
    const workspaceId = params?.workspaceId ?? this.context.workspaceId;
    if (!workspaceId) {
      throw new Error(
        "workspaceId is required. Either pass it in params or set it via sdk.withWorkspace(id)"
      );
    }
    return workspaceId;
  }

  /**
   * Get release ID from context or params
   * Throws if releaseId is required but not provided
   */
  protected getReleaseId(params?: { releaseId?: string }): string {
    const releaseId = params?.releaseId ?? this.context.releaseId;
    if (!releaseId) {
      throw new Error(
        "releaseId is required. Either pass it in params or set it via sdk.withRelease(id)"
      );
    }
    return releaseId;
  }

  /**
   * Create a new context with updated values
   */
  protected withContext(updates: Partial<NamespaceContext>): NamespaceContext {
    return {
      ...this.context,
      ...updates,
    };
  }
}
