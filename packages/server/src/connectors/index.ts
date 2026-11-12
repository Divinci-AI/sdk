/**
 * Connectors Client
 *
 * Server-side management of whitelabel data connectors — today focused on the
 * `web_crawl` provider: point a connector at a website (or sitemap/URL feed)
 * and it crawls into a chosen RAG vector, optionally on a recurring schedule.
 *
 * Wire paths verified against the public-api whitelabel connectors router
 * (`/white-label/:whitelabelId/connectors/*`) on 2026-07-19.
 */

import { ServerHttpClient } from "../http-client.js";

/** Settings for a web_crawl connector (mirrors the server's WebCrawlProviderSettings). */
export interface WebCrawlSettings {
  /** "crawl" follows links from rootUrl; "feed" ingests an explicit sitemap/URL list. */
  mode: "crawl" | "feed";
  /** Crawl root (mode=crawl) — may be a deep subpath. */
  rootUrl?: string;
  /** Feed source (mode=feed): a sitemap.xml or a URL-list/JSON feed. */
  feedUrl?: string;
  /** Feed parser (mode=feed). */
  feedFormat?: "sitemap" | "url-list" | "json";
  /** Explicit URL list (mode=feed) scraped directly instead of fetching feedUrl. */
  feedUrls?: string[];
  /** The RagVector this connector ingests into. */
  targetVectorId: string;
  /** Max pages to traverse. */
  limit?: number;
  /** Restrict the crawl to these path prefixes. */
  allowedPaths?: string[];
  /** Skip these path prefixes. */
  excludePaths?: string[];
  /** Parse + follow sitemap.xml during a crawl (finds pages behind grids/pagination). */
  runSitemap?: boolean;
  /** (mode=crawl) Also crawl sub-domains of the root's registrable domain. */
  crawlSubdomains?: boolean;
  /** (mode=crawl) Build/refresh the product catalog from schema.org JSON-LD Product entities. */
  buildProductCatalog?: boolean;
  /** Recurring crawl on/off. */
  autoSync?: boolean;
  /** Recurrence cadence in minutes; default 10080 (weekly). */
  syncIntervalMinutes?: number;
  /** Crawl into a fresh draft vector and repoint live releases on success —
   * REQUIRED when the target vector is attached to a published release
   * (without it, chunk writes are rejected by the live-vector guard). */
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

/**
 * Settings for a `wordpress` connector (mirrors the server's
 * WordPressProviderSettings). The connector pulls REST-exposed post types out
 * of a WordPress install and ingests them into a RAG vector.
 */
export interface WordPressSettings {
  /** Site root, e.g. `https://example.com` — NOT the /wp-json path. */
  siteUrl: string;
  /** The RagVector this connector ingests into. */
  targetVectorId: string;
  /**
   * REST bases to ingest — a custom post type's `rest_base`, not its post-type
   * name (they differ often enough to matter). Defaults to posts + pages.
   * `wordpressDiscover()` reports what a given site actually exposes.
   */
  postTypes?: string[];
  /** Only ingest items modified at/after this ISO-8601 instant (manual backfill window). */
  modifiedAfter?: string;
  /** Max items per post type. Safety cap, not a target. */
  limit?: number;
  /** Restrict to these category slugs (posts only). */
  categorySlugs?: string[];
  /** Skip items whose slug matches any of these. */
  excludeSlugs?: string[];
  /** Ingest drafts/private posts. Requires `auth`; off by default. */
  includeNonPublished?: boolean;
  /** WordPress Application Password (WP 5.6+), sent as HTTP Basic. Encrypted at rest. */
  auth?: { username: string; applicationPassword: string };
  /** Recurring sync on/off. */
  autoSync?: boolean;
  /** Recurrence cadence in minutes; default daily. */
  syncIntervalMinutes?: number;
  /** Ingest into a draft vector and repoint live releases on success —
   * REQUIRED when the target vector backs a published release. */
  swapOnSuccess?: boolean;
  [extension: string]: unknown;
}

/** Response of wordpressDiscover(). */
export interface WordPressDiscoverResponse {
  site: {
    name?: string;
    description?: string;
    home?: string;
    gmtOffsetHours?: number;
    timezoneString?: string;
    /** Set when the site redirected (http→https, www→apex). */
    redirected?: boolean;
    /** Store THIS as the connector's siteUrl when the site redirected. */
    resolvedSiteUrl?: string;
  };
  /** Content post types, editor plumbing filtered out — the suggestion list. */
  postTypes: Array<{ name: string; restBase: string; label?: string }>;
  /** Every REST-exposed rest_base, including plumbing. */
  allPostTypes: string[];
}

/** Response of wordpressStart(). */
export interface WordPressStartResponse {
  status: string;
  connectionId: string;
  siteUrl: string;
  postTypes: string[];
  targetVectorId: string;
}

/** Response of stats(). */
export interface ConnectorStats {
  connectionStats?: Record<string, unknown>;
  syncStats?: Record<string, unknown>;
}

/** Provider settings + sync config, as returned by settings(). */
export interface ConnectorSettings {
  providerSettings: Record<string, unknown>;
  syncConfig: Record<string, unknown>;
}

/** A file listed from a provider's own storage. */
export interface ConnectorFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  path?: string;
  modifiedAt?: string;
  isFolder?: boolean;
  [extension: string]: unknown;
}

export class ConnectorsClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  /**
   * Route family depends on the auth mode -- see ServerHttpClient.usesApiKey.
   * `/api/v1/connectors/*` is gated by requirePermissions("connector:read" |
   * "connector:write") and infers the workspace from the key, so it is the
   * only surface an API-key session can reach; `/white-label/:id/connectors/*`
   * is JWT/session-gated and 403s an API key. Same idiom as model-edits.
   *
   * v1 covers every sub-path this client builds EXCEPT `/:provider/files` and
   * `/:provider/refresh` -- those are whitelabel-only, and the two methods
   * that use them throw below rather than emitting a confusing 404.
   */
  private base(workspaceId: string): string {
    if (this.httpClient.usesApiKey) return "/api/v1/connectors";
    return `/white-label/${workspaceId}/connectors`;
  }

  /** Guard for the two sub-paths v1 does not mount. */
  private requireWhitelabelAuth(method: string): void {
    if (this.httpClient.usesApiKey) {
      throw new Error(
        `connectors.${method}() is not available on /api/v1/connectors -- it is ` +
          `only mounted on the whitelabel router, which needs OAuth. ` +
          `Run \`divinci auth login\`, or use a method backed by a v1 route.`
      );
    }
  }

  /**
   * Create (or update) a web_crawl connector and kick off a crawl into its
   * target vector. Idempotent on the crawl root/feed URL — re-calling with
   * updated settings updates the stored connection, so this is also how a
   * recurring connector's settings get corrected.
   */
  async webCrawlStart(
    workspaceId: string,
    settings: WebCrawlSettings
  ): Promise<WebCrawlStartResponse> {
    return this.httpClient.post<WebCrawlStartResponse>(
      `${this.base(workspaceId)}/web-crawl/start`,
      { settings }
    );
  }

  /** List the workspace's connector connections (all providers). */
  async list(workspaceId: string): Promise<{ connections: ConnectorConnection[] }> {
    return this.httpClient.get<{ connections: ConnectorConnection[] }>(
      this.base(workspaceId)
    );
  }

  /** Sync-job history for one connection (most recent first). */
  async syncJobs(
    workspaceId: string,
    connectionId: string
  ): Promise<{ jobs: ConnectorSyncJob[] }> {
    return this.httpClient.get<{ jobs: ConnectorSyncJob[] }>(
      `${this.base(workspaceId)}/${connectionId}/sync`
    );
  }

  /**
   * Inspect a WordPress site before connecting it: its name, UTC offset, and
   * every REST-exposed post type.
   *
   * Worth calling first every time. The most common reason a customer's
   * content "isn't there" after a sync is a custom post type registered
   * without `show_in_rest: true`, which makes it invisible to the REST API
   * entirely — this is what shows that, instead of an empty sync with no
   * explanation. It also reports `resolvedSiteUrl` when the site redirects
   * (http→https, www→apex); store THAT as the connector's siteUrl, because an
   * Application Password is withheld across a cross-origin hop.
   */
  async wordpressDiscover(
    workspaceId: string,
    params: { siteUrl: string; auth?: WordPressSettings["auth"] }
  ): Promise<WordPressDiscoverResponse> {
    return this.httpClient.post<WordPressDiscoverResponse>(
      `${this.base(workspaceId)}/wordpress/discover`,
      params
    );
  }

  /**
   * Create (or update) a `wordpress` connector and start a sync into its
   * target vector. Idempotent on the site URL — re-calling with updated
   * settings updates the stored connection.
   *
   * Returns 202 as soon as the connector is persisted; the sync itself runs
   * server-side. Track it with `syncJobs()`.
   */
  async wordpressStart(
    workspaceId: string,
    settings: WordPressSettings
  ): Promise<WordPressStartResponse> {
    return this.httpClient.post<WordPressStartResponse>(
      `${this.base(workspaceId)}/wordpress/start`,
      { settings }
    );
  }

  /** Connection status for one provider (`connected: false` when absent). */
  async get(
    workspaceId: string,
    provider: string
  ): Promise<{ connected: boolean; provider?: string; connection?: ConnectorConnection; fileCount?: number }> {
    return this.httpClient.get(`${this.base(workspaceId)}/${provider}`);
  }

  /** Revoke a provider's connection (best-effort token revocation upstream). */
  async disconnect(
    workspaceId: string,
    provider: string
  ): Promise<{ success: boolean; provider: string }> {
    return this.httpClient.post(`${this.base(workspaceId)}/${provider}/disconnect`, {});
  }

  /** Force an OAuth access-token refresh for a provider. */
  async refresh(
    workspaceId: string,
    provider: string
  ): Promise<{ success: boolean; expiresAt?: string }> {
    this.requireWhitelabelAuth("refresh");
    return this.httpClient.post(`${this.base(workspaceId)}/${provider}/refresh`, {});
  }

  /** Provider settings + sync config for one provider. */
  async settings(workspaceId: string, provider: string): Promise<ConnectorSettings> {
    return this.httpClient.get<ConnectorSettings>(
      `${this.base(workspaceId)}/${provider}/settings`
    );
  }

  /**
   * Update provider settings and/or sync config. `syncConfig.autoSync` is the
   * switch the recurring-sync crons filter on, so this is how a connector is
   * put on (or taken off) a schedule after it exists.
   */
  async updateSettings(
    workspaceId: string,
    provider: string,
    body: {
      providerSettings?: Record<string, unknown>;
      syncConfig?: {
        autoSync?: boolean;
        /** Minimum 15 — smaller values are ignored server-side. */
        syncIntervalMinutes?: number;
        syncFilter?: string;
        targetTypes?: Array<"rag" | "fine-tuning">;
      };
    }
  ): Promise<ConnectorSettings> {
    return this.httpClient.put<ConnectorSettings>(
      `${this.base(workspaceId)}/${provider}/settings`,
      body
    );
  }

  /** Browse the files a provider exposes (before/independent of syncing them). */
  async files(
    workspaceId: string,
    provider: string,
    opts: { path?: string; cursor?: string; limit?: number; query?: string } = {}
  ): Promise<{ files: ConnectorFile[]; nextCursor?: string }> {
    this.requireWhitelabelAuth("files");
    const qs = new URLSearchParams();
    if (opts.path) qs.set("path", opts.path);
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (typeof opts.limit === "number") qs.set("limit", String(opts.limit));
    if (opts.query) qs.set("query", opts.query);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.httpClient.get(`${this.base(workspaceId)}/${provider}/files${suffix}`);
  }

  /**
   * Trigger a sync now for an existing connection. Returns 409 when one is
   * already in progress (stale jobs are auto-cancelled first).
   */
  async syncStart(
    workspaceId: string,
    connectionId: string,
    body: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    return this.httpClient.post(`${this.base(workspaceId)}/${connectionId}/sync`, body);
  }

  /** Cancel every pending/running sync job for a connection. */
  async syncCancel(
    workspaceId: string,
    connectionId: string
  ): Promise<{ success: boolean; cancelledCount: number }> {
    return this.httpClient.post(
      `${this.base(workspaceId)}/${connectionId}/sync/cancel`,
      {}
    );
  }

  /** Connection + sync statistics across every connector in the workspace. */
  async stats(workspaceId: string): Promise<ConnectorStats> {
    return this.httpClient.get<ConnectorStats>(`${this.base(workspaceId)}/stats/overview`);
  }
}
