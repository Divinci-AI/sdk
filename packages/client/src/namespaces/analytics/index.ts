/**
 * Analytics Namespace
 *
 * Product analytics for AI releases: aggregated metrics, time-series trends,
 * per-product performance, A/B experiment results, conversion funnel, and
 * client-side event ingestion.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/analytics/products/*`) on 2026-06-10.
 * All read routes require the `whitelabel:editConfig` permission;
 * `trackEvents()` is anonymous-allowed (rate-limited server-side).
 */

import { BaseNamespace } from "../base.js";

/** Time range accepted by the analytics read routes. */
export type AnalyticsTimeRange = "1d" | "7d" | "30d" | "90d" | string;

/** Aggregated product metrics for a period. */
export interface ProductMetricsPeriod {
  impressions?: number;
  clicks?: number;
  conversions?: number;
  ctr?: number;
  conversionRate?: number;
  satisfactionScore?: number;
  avgOrderValue?: number;
  [key: string]: unknown;
}

/** Response of `metrics()` — current + previous period with derived deltas. */
export interface ProductMetricsResponse {
  current: ProductMetricsPeriod;
  previous: ProductMetricsPeriod;
  timeRange: string;
  generatedAt: string;
  [derived: string]: unknown;
}

/** A single time-series bucket. */
export interface ProductTrendPoint {
  date?: string;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  ctr?: number;
  [key: string]: unknown;
}

/** Response of `trends()`. */
export interface ProductTrendsResponse {
  trends: ProductTrendPoint[];
  timeRange: string;
  granularity: string;
}

/** Per-product performance row. */
export interface ProductPerformanceRow {
  productId?: string;
  productName?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  conversions?: number;
  conversionRate?: number;
  [key: string]: unknown;
}

/** Response of `performance()`. */
export interface ProductPerformanceResponse {
  products: ProductPerformanceRow[];
  totalProducts: number;
  timeRange: string;
}

/** A/B experiment with computed results. */
export interface ExperimentResult {
  experimentId?: string;
  status?: string;
  variants?: unknown[];
  results?: {
    lift?: number;
    pValue?: number;
    significant?: boolean;
    winner?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Response of `experiments()`. */
export interface ExperimentResultsResponse {
  experiments: ExperimentResult[];
  totalExperiments: number;
}

/** Conversion funnel stage. */
export interface FunnelStage {
  stage?: string;
  count?: number;
  dropoffRate?: number;
  [key: string]: unknown;
}

/** Response of `funnel()`. */
export interface ConversionFunnelResponse {
  funnel: FunnelStage[] | Record<string, unknown>;
  timeRange: string;
}

/**
 * Client-side product interaction event. `event` must be one of the
 * server-accepted types — anything else is rejected (counted in `rejected`).
 */
export interface ProductEventInput {
  /** Canonical mapping: impression ← recommendation_impression / recommendations_expanded / product_view; click ← product_click / product_hover / quick_view; conversion ← add_to_cart / save_for_later */
  event:
    | "recommendation_impression"
    | "recommendations_expanded"
    | "product_view"
    | "product_click"
    | "product_hover"
    | "quick_view"
    | "add_to_cart"
    | "save_for_later";
  /** A/B experiment id; omit for organic traffic */
  experimentId?: string;
  /** Variant label (default "control") */
  variant?: string;
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  messageId?: string;
  productId?: string;
  productName?: string;
  productCategory?: string[];
  strategy?: string;
  /** Position of the product in the recommendation list */
  position?: number;
  /** Relevance score [0,1] */
  relevanceScore?: number;
  /** Confidence [0,1] */
  confidence?: number;
  deviceType?: "mobile" | "tablet" | "desktop";
  viewport?: { width: number; height: number };
  /** Conversion price (conversions only; capped server-side) */
  price?: number;
}

/** Response of `trackEvents()`. */
export interface TrackEventsResponse {
  accepted: number;
  rejected: number;
}

/** Realtime metrics snapshot delivered over the SSE stream. */
export interface RealtimeMetrics {
  activeUsers?: number;
  impressionsPerMinute?: number;
  clicksPerMinute?: number;
  ctr?: number;
  [key: string]: unknown;
}

/**
 * Analytics Namespace
 *
 * @example
 * ```typescript
 * const analytics = client.analytics.withWorkspace("ws-123");
 *
 * // Dashboard metrics with previous-period comparison
 * const { current, previous } = await analytics.metrics({ timeRange: "7d" });
 *
 * // Daily trend line
 * const { trends } = await analytics.trends({ timeRange: "30d", granularity: "daily" });
 *
 * // A/B experiment results with statistical significance
 * const { experiments } = await analytics.experiments({ status: "running" });
 *
 * // Custom analytics: record events from your own UI
 * await analytics.trackEvents([
 *   { event: "product_click", productId: "sku-1", sessionId: "s-1" },
 * ]);
 * ```
 */
export class AnalyticsNamespace extends BaseNamespace {
  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/analytics/products`;
  }

  /**
   * Aggregated product metrics for the period, with the previous period for
   * comparison and derived deltas.
   */
  async metrics(
    options: { timeRange?: AnalyticsTimeRange } = {},
    params: { workspaceId?: string } = {}
  ): Promise<ProductMetricsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ProductMetricsResponse>(
      `${this.base(workspaceId)}/metrics`,
      { timeRange: options.timeRange }
    );
  }

  /**
   * Time-series trend data for charts.
   */
  async trends(
    options: { timeRange?: AnalyticsTimeRange; granularity?: "hourly" | "daily" } = {},
    params: { workspaceId?: string } = {}
  ): Promise<ProductTrendsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ProductTrendsResponse>(
      `${this.base(workspaceId)}/trends`,
      { timeRange: options.timeRange, granularity: options.granularity }
    );
  }

  /**
   * Per-product performance rows. `sortBy` is allowlisted server-side to
   * impressions | clicks | ctr | conversions | conversionRate.
   */
  async performance(
    options: {
      timeRange?: AnalyticsTimeRange;
      limit?: number;
      sortBy?: "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate";
    } = {},
    params: { workspaceId?: string } = {}
  ): Promise<ProductPerformanceResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ProductPerformanceResponse>(
      `${this.base(workspaceId)}/performance`,
      { timeRange: options.timeRange, limit: options.limit, sortBy: options.sortBy }
    );
  }

  /**
   * A/B experiment results with variant metrics, lift, p-value, and winner.
   */
  async experiments(
    options: { experimentId?: string; status?: string } = {},
    params: { workspaceId?: string } = {}
  ): Promise<ExperimentResultsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ExperimentResultsResponse>(
      `${this.base(workspaceId)}/experiments`,
      { experimentId: options.experimentId, status: options.status }
    );
  }

  /**
   * Conversion funnel (impressions → clicks → sessions → conversions).
   */
  async funnel(
    options: { timeRange?: AnalyticsTimeRange } = {},
    params: { workspaceId?: string } = {}
  ): Promise<ConversionFunnelResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ConversionFunnelResponse>(
      `${this.base(workspaceId)}/funnel`,
      { timeRange: options.timeRange }
    );
  }

  /**
   * Record a batch of product interaction events (max 50 per call).
   * Anonymous-allowed — safe to call from public landing pages and embeds.
   * Unknown event types are rejected, not erred.
   */
  async trackEvents(
    events: ProductEventInput[],
    params: { workspaceId?: string } = {}
  ): Promise<TrackEventsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<TrackEventsResponse>(
      `${this.base(workspaceId)}/events`,
      { events }
    );
  }

  /**
   * Subscribe to the realtime metrics SSE stream. Emits a snapshot every ~5s;
   * the server closes the stream after 5 minutes — reconnect if you need
   * longer sessions. Returns when the stream ends; abort via `signal`.
   */
  async streamRealtime(
    onMetrics: (metrics: RealtimeMetrics) => void,
    options: { signal?: AbortSignal } = {},
    params: { workspaceId?: string } = {}
  ): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    const baseUrl = this.httpClient.getBaseUrl();
    const url = new URL(`${this.base(workspaceId)}/realtime`, baseUrl);

    const headers: Record<string, string> = { Accept: "text/event-stream" };
    const token = await this.httpClient.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Realtime stream failed (status: ${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            onMetrics(JSON.parse(line.slice(6)) as RealtimeMetrics);
          } catch {
            // skip malformed SSE chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Create a scoped AnalyticsNamespace with a preset workspaceId
   */
  withWorkspace(workspaceId: string): AnalyticsNamespace {
    return new AnalyticsNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
