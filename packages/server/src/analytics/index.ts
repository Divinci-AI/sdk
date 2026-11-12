/**
 * Analytics Client
 *
 * Server-side product analytics for AI releases: aggregated metrics,
 * time-series trends, per-product performance, A/B experiment results,
 * conversion funnel, and event ingestion.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/analytics/products/*`) on 2026-06-10.
 */

import { ServerHttpClient } from "../http-client.js";

/** Time range accepted by the analytics read routes. */
export type AnalyticsTimeRange = "1d" | "7d" | "30d" | "90d" | string;

/** Response of `metrics()` — current + previous period with derived deltas. */
export interface ProductMetricsResponse {
  current: Record<string, unknown>;
  previous: Record<string, unknown>;
  timeRange: string;
  generatedAt: string;
  [derived: string]: unknown;
}

/** Response of `trends()`. */
export interface ProductTrendsResponse {
  trends: Array<Record<string, unknown>>;
  timeRange: string;
  granularity: string;
}

/** Response of `performance()`. */
export interface ProductPerformanceResponse {
  products: Array<Record<string, unknown>>;
  totalProducts: number;
  timeRange: string;
}

/** Response of `experiments()`. */
export interface ExperimentResultsResponse {
  experiments: Array<Record<string, unknown>>;
  totalExperiments: number;
}

/** Response of `funnel()`. */
export interface ConversionFunnelResponse {
  funnel: unknown;
  timeRange: string;
}

/** Client-side product interaction event (see EVENT_TYPE_MAP server-side). */
export interface ProductEventInput {
  event:
    | "recommendation_impression"
    | "recommendations_expanded"
    | "product_view"
    | "product_click"
    | "product_hover"
    | "quick_view"
    | "add_to_cart"
    | "save_for_later";
  experimentId?: string;
  variant?: string;
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  messageId?: string;
  productId?: string;
  productName?: string;
  productCategory?: string[];
  strategy?: string;
  position?: number;
  relevanceScore?: number;
  confidence?: number;
  deviceType?: "mobile" | "tablet" | "desktop";
  viewport?: { width: number; height: number };
  price?: number;
}

/**
 * Analytics Client
 *
 * @example
 * ```typescript
 * const { current, previous } = await divinci.analytics.metrics("ws-123", { timeRange: "7d" });
 * const { experiments } = await divinci.analytics.experiments("ws-123", { status: "running" });
 * await divinci.analytics.trackEvents("ws-123", [
 *   { event: "product_click", productId: "sku-1" },
 * ]);
 * ```
 */
export class AnalyticsClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/analytics/products`;
  }

  /** Aggregated product metrics with previous-period comparison. */
  async metrics(
    workspaceId: string,
    options: { timeRange?: AnalyticsTimeRange } = {}
  ): Promise<ProductMetricsResponse> {
    return this.httpClient.get<ProductMetricsResponse>(`${this.base(workspaceId)}/metrics`, {
      timeRange: options.timeRange,
    });
  }

  /** Time-series trend data for charts. */
  async trends(
    workspaceId: string,
    options: { timeRange?: AnalyticsTimeRange; granularity?: "hourly" | "daily" } = {}
  ): Promise<ProductTrendsResponse> {
    return this.httpClient.get<ProductTrendsResponse>(`${this.base(workspaceId)}/trends`, {
      timeRange: options.timeRange,
      granularity: options.granularity,
    });
  }

  /** Per-product performance rows (sortBy allowlisted server-side). */
  async performance(
    workspaceId: string,
    options: {
      timeRange?: AnalyticsTimeRange;
      limit?: number;
      sortBy?: "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate";
    } = {}
  ): Promise<ProductPerformanceResponse> {
    return this.httpClient.get<ProductPerformanceResponse>(
      `${this.base(workspaceId)}/performance`,
      { timeRange: options.timeRange, limit: options.limit, sortBy: options.sortBy }
    );
  }

  /** A/B experiment results with lift, p-value, and winner. */
  async experiments(
    workspaceId: string,
    options: { experimentId?: string; status?: string } = {}
  ): Promise<ExperimentResultsResponse> {
    return this.httpClient.get<ExperimentResultsResponse>(
      `${this.base(workspaceId)}/experiments`,
      { experimentId: options.experimentId, status: options.status }
    );
  }

  /** Conversion funnel (impressions → clicks → sessions → conversions). */
  async funnel(
    workspaceId: string,
    options: { timeRange?: AnalyticsTimeRange } = {}
  ): Promise<ConversionFunnelResponse> {
    return this.httpClient.get<ConversionFunnelResponse>(`${this.base(workspaceId)}/funnel`, {
      timeRange: options.timeRange,
    });
  }

  /**
   * Record a batch of product interaction events (max 50 per call).
   * Unknown event types are rejected (counted in `rejected`), not erred.
   */
  async trackEvents(
    workspaceId: string,
    events: ProductEventInput[]
  ): Promise<{ accepted: number; rejected: number }> {
    return this.httpClient.post<{ accepted: number; rejected: number }>(
      `${this.base(workspaceId)}/events`,
      { events }
    );
  }
}
