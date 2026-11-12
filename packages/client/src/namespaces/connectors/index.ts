/**
 * Connectors Namespace
 *
 * Manage whitelabel data connectors — today focused on the `web_crawl`
 * provider: point a connector at a website (or sitemap/URL feed) and it
 * crawls into a chosen RAG vector, optionally on a recurring schedule.
 *
 * Wire paths verified against the public-api whitelabel connectors router
 * (`/white-label/:whitelabelId/connectors/*`) on 2026-07-19.
 */

import { BaseNamespace } from "../base.js";

/** Settings for a web_crawl connector (mirrors the server's WebCrawlProviderSettings). */
export interface WebCrawlSettings {
  /** "crawl" follows links from rootUrl; "feed" ingests an explicit sitemap/URL list. */
  mode: "crawl" | "feed";
  rootUrl?: string;
  feedUrl?: string;
  feedFormat?: "sitemap" | "url-list" | "json";
  feedUrls?: string[];
  /** The RagVector this connector ingests into. */
  targetVectorId: string;
  limit?: number;
  allowedPaths?: string[];
  excludePaths?: string[];
  /** Parse + follow sitemap.xml during a crawl (finds pages behind grids/pagination). */
  runSitemap?: boolean;
  crawlSubdomains?: boolean;
  buildProductCatalog?: boolean;
  /** Recurring crawl on/off. */
  autoSync?: boolean;
  /** Recurrence cadence in minutes; default 1440 (daily). */
  syncIntervalMinutes?: number;
  /** Crawl into a fresh draft vector and repoint live releases on success —
   * REQUIRED when the target vector is attached to a published release. */
  swapOnSuccess?: boolean;
  [extension: string]: unknown;
}

/** A connector connection as returned by list(). */
export interface ConnectorConnection {
  _id: string;
  whitelabelId: string;
  provider: string;
  connectionStatus: string;
  syncConfig?: {
    autoSync?: boolean;
    syncIntervalMinutes?: number;
    lastSyncAt?: string;
    targetTypes?: string[];
  };
  providerSettings?: WebCrawlSettings | Record<string, unknown>;
  createdAt?: string;
  lastUsedAt?: string;
  fileCount?: number;
  [extension: string]: unknown;
}

/** A sync job as returned by syncJobs(). */
export interface ConnectorSyncJob {
  _id: string;
  connectionId: string;
  provider: string;
  status: string;
  progress?: {
    totalFiles: number;
    processedFiles: number;
    failedFiles: number;
  };
  errorMessages?: string[];
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  [extension: string]: unknown;
}

/** Response of webCrawlStart(). */
export interface WebCrawlStartResponse {
  status: string;
  mode: "crawl" | "feed";
  rootUrl?: string;
  targetVectorId: string;
}

export class ConnectorsNamespace extends BaseNamespace {
  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/connectors`;
  }

  /**
   * Create (or update) a web_crawl connector and kick off a crawl into its
   * target vector. Idempotent on the crawl root/feed URL.
   */
  async webCrawlStart(
    settings: WebCrawlSettings,
    params: { workspaceId?: string } = {}
  ): Promise<WebCrawlStartResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<WebCrawlStartResponse>(
      `${this.base(workspaceId)}/web-crawl/start`,
      { settings }
    );
  }

  /** List the workspace's connector connections (all providers). */
  async list(params: { workspaceId?: string } = {}): Promise<{ connections: ConnectorConnection[] }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<{ connections: ConnectorConnection[] }>(this.base(workspaceId));
  }

  /** Sync-job history for one connection (most recent first). */
  async syncJobs(
    connectionId: string,
    params: { workspaceId?: string } = {}
  ): Promise<{ jobs: ConnectorSyncJob[] }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<{ jobs: ConnectorSyncJob[] }>(
      `${this.base(workspaceId)}/${connectionId}/sync`
    );
  }
}
