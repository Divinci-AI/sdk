/**
 * Metrics Client
 *
 * Server-side pipeline telemetry for AI releases: per-node latency/error/
 * throughput metrics, CSV/JSON export, active alerts, and CUSTOM alert
 * configurations with in-app / email / webhook notification channels.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/pipeline/metrics/*`) on 2026-06-10.
 */

import { ServerHttpClient } from "../http-client.js";

/** Aggregation window accepted by the metrics routes. */
export type MetricTimeRange = "1m" | "5m" | "1h" | "24h" | "7d" | "30d";

/** Warning/critical thresholds for an alert config. */
export interface AlertThresholdConfig {
  warning?: number;
  critical?: number;
}

/** Where alert notifications get sent. */
export interface AlertNotificationChannel {
  type: "in-app" | "email" | "webhook";
  config: Record<string, unknown>;
}

/** A stored alert configuration. */
export interface MetricAlertConfig {
  whitelabelId: string;
  pipelineId: string;
  nodeType: string;
  metric: string;
  thresholds: AlertThresholdConfig;
  enabled: boolean;
  notificationChannels: AlertNotificationChannel[];
  createdAt: number;
  updatedAt: number;
}

/** An active metric alert. */
export interface MetricAlert {
  id: string;
  nodeType: string;
  pipelineId: string;
  whitelabelId: string;
  metric: string;
  threshold: number;
  currentValue: number;
  severity: "warning" | "critical";
  message: string;
  triggeredAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

/** Input for `setAlertConfig()`. */
export interface SetAlertConfigInput {
  nodeType: string;
  metric: string;
  /** At least one of warning/critical is required */
  thresholds: AlertThresholdConfig;
  notificationChannels?: AlertNotificationChannel[];
}

/**
 * Metrics Client
 *
 * @example
 * ```typescript
 * // Per-node latency/error metrics
 * const result = await divinci.metrics.pipeline("ws-123", "pipe-1", { timeRange: "24h" });
 *
 * // Custom metric alerting → webhook
 * await divinci.metrics.setAlertConfig("ws-123", "pipe-1", {
 *   nodeType: "embedding",
 *   metric: "errorRate",
 *   thresholds: { warning: 0.05, critical: 0.2 },
 *   notificationChannels: [{ type: "webhook", config: { url: "https://ops.example.com" } }],
 * });
 * ```
 */
export class MetricsClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/pipeline/metrics`;
  }

  /** Aggregated metrics; narrow by pipelineId and/or nodeType. */
  async query(
    workspaceId: string,
    options: {
      pipelineId?: string;
      nodeType?: string;
      timeRange?: MetricTimeRange;
      includeAlerts?: boolean;
    } = {}
  ): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(this.base(workspaceId), {
      pipelineId: options.pipelineId,
      nodeType: options.nodeType,
      timeRange: options.timeRange,
      includeAlerts: options.includeAlerts,
    });
  }

  /** All metrics for a specific pipeline, grouped by node type. */
  async pipeline(
    workspaceId: string,
    pipelineId: string,
    options: { nodeType?: string; timeRange?: MetricTimeRange } = {}
  ): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(
      `${this.base(workspaceId)}/${pipelineId}`,
      { nodeType: options.nodeType, timeRange: options.timeRange }
    );
  }

  /** Export metrics — `format: "json"` returns `{ rows }`, default CSV text. */
  async exportMetrics(
    workspaceId: string,
    pipelineId: string,
    options: { timeRange?: MetricTimeRange; nodeTypes?: string[]; format?: "csv" | "json" } = {}
  ): Promise<{ rows: string[][] } | string> {
    return this.httpClient.get<{ rows: string[][] } | string>(
      `${this.base(workspaceId)}/${pipelineId}/export`,
      {
        timeRange: options.timeRange,
        nodeTypes: options.nodeTypes?.join(","),
        format: options.format,
      }
    );
  }

  /** Active alerts for a pipeline. */
  async alerts(
    workspaceId: string,
    pipelineId: string
  ): Promise<{ pipelineId: string; alerts: MetricAlert[]; count: number; timestamp: number }> {
    return this.httpClient.get<{
      pipelineId: string;
      alerts: MetricAlert[];
      count: number;
      timestamp: number;
    }>(`${this.base(workspaceId)}/${pipelineId}/alerts`);
  }

  /** Acknowledge an active alert. */
  async acknowledgeAlert(
    workspaceId: string,
    pipelineId: string,
    alertId: string
  ): Promise<{ success: boolean; alertId: string }> {
    return this.httpClient.post<{ success: boolean; alertId: string }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/${alertId}/acknowledge`,
      {}
    );
  }

  /** List stored alert configurations for a pipeline. */
  async getAlertConfigs(
    workspaceId: string,
    pipelineId: string
  ): Promise<{ pipelineId: string; configs: MetricAlertConfig[]; count: number }> {
    return this.httpClient.get<{
      pipelineId: string;
      configs: MetricAlertConfig[];
      count: number;
    }>(`${this.base(workspaceId)}/${pipelineId}/alerts/config`);
  }

  /**
   * Create or update an alert configuration (upsert on nodeType + metric).
   * The custom-metrics hook: route threshold breaches to in-app / email /
   * webhook channels.
   */
  async setAlertConfig(
    workspaceId: string,
    pipelineId: string,
    input: SetAlertConfigInput
  ): Promise<{ success: boolean; config: MetricAlertConfig }> {
    return this.httpClient.post<{ success: boolean; config: MetricAlertConfig }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/config`,
      input
    );
  }

  /** Delete an alert configuration (identified by nodeType + metric). */
  async deleteAlertConfig(
    workspaceId: string,
    pipelineId: string,
    options: { nodeType: string; metric: string }
  ): Promise<{ success: boolean; nodeType: string; metric: string }> {
    const query = new URLSearchParams({
      nodeType: options.nodeType,
      metric: options.metric,
    });
    return this.httpClient.delete<{ success: boolean; nodeType: string; metric: string }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/config?${query.toString()}`
    );
  }
}
