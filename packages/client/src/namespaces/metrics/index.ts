/**
 * Metrics Namespace
 *
 * Pipeline telemetry for AI releases: per-node latency/error/throughput
 * metrics, CSV/JSON export, active alerts, and CUSTOM alert configurations
 * with in-app / email / webhook notification channels.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/pipeline/metrics/*`) on 2026-06-10.
 */

import { BaseNamespace } from "../base.js";

/** Aggregation window accepted by the metrics routes. */
export type MetricTimeRange = "1m" | "5m" | "1h" | "24h" | "7d" | "30d";

/** Alert severity levels. */
export type AlertSeverity = "warning" | "critical";

/** Base metrics common to all pipeline nodes. */
export interface NodeMetrics {
  count: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  minDuration: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;
  /** requests per minute */
  throughput: number;
  [extension: string]: unknown;
}

/** Metrics for one pipeline, keyed by node type. */
export interface PipelineMetricsResponse {
  pipelineId: string;
  timeRange: string;
  metrics: Record<string, NodeMetrics | unknown>;
  timestamp: number;
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
  severity: AlertSeverity;
  message: string;
  triggeredAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

/** Response of `alerts()`. */
export interface PipelineAlertsResponse {
  pipelineId: string;
  alerts: MetricAlert[];
  count: number;
  timestamp: number;
}

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

/** Input for `setAlertConfig()`. */
export interface SetAlertConfigInput {
  /** Pipeline node type the metric belongs to (e.g. "chunking", "embedding") */
  nodeType: string;
  /** Metric name (e.g. "errorRate", "p95Duration") */
  metric: string;
  /** At least one of warning/critical is required */
  thresholds: AlertThresholdConfig;
  /** Channels notified when the alert fires (default none → in-app only) */
  notificationChannels?: AlertNotificationChannel[];
}

/** Response of `exportMetrics()` with format "json". */
export interface MetricsExportRows {
  rows: Array<Array<string>>;
}

/**
 * Metrics Namespace
 *
 * @example
 * ```typescript
 * const metrics = client.metrics.withWorkspace("ws-123");
 *
 * // Per-node latency/error metrics for a pipeline
 * const { metrics: byNode } = await metrics.pipeline("pipe-1", { timeRange: "24h" });
 *
 * // Custom metric alerting → webhook (custom implementation hook)
 * await metrics.setAlertConfig("pipe-1", {
 *   nodeType: "embedding",
 *   metric: "errorRate",
 *   thresholds: { warning: 0.05, critical: 0.2 },
 *   notificationChannels: [
 *     { type: "webhook", config: { url: "https://ops.example.com/alert" } },
 *   ],
 * });
 *
 * // Active alerts + acknowledge
 * const { alerts } = await metrics.alerts("pipe-1");
 * if (alerts[0]) await metrics.acknowledgeAlert("pipe-1", alerts[0].id);
 * ```
 */
export class MetricsNamespace extends BaseNamespace {
  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/pipeline/metrics`;
  }

  /**
   * Aggregated metrics. With `pipelineId` + `nodeType` returns that node's
   * metrics; with only `pipelineId` returns all node metrics for the pipeline.
   */
  async query(
    options: {
      pipelineId?: string;
      nodeType?: string;
      timeRange?: MetricTimeRange;
      includeAlerts?: boolean;
    } = {},
    params: { workspaceId?: string } = {}
  ): Promise<PipelineMetricsResponse | NodeMetrics> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<PipelineMetricsResponse | NodeMetrics>(
      this.base(workspaceId),
      {
        pipelineId: options.pipelineId,
        nodeType: options.nodeType,
        timeRange: options.timeRange,
        includeAlerts: options.includeAlerts,
      }
    );
  }

  /**
   * All metrics for a specific pipeline, grouped by node type. Pass
   * `nodeType` to narrow to one node.
   */
  async pipeline(
    pipelineId: string,
    options: { nodeType?: string; timeRange?: MetricTimeRange } = {},
    params: { workspaceId?: string } = {}
  ): Promise<PipelineMetricsResponse | NodeMetrics> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<PipelineMetricsResponse | NodeMetrics>(
      `${this.base(workspaceId)}/${pipelineId}`,
      { nodeType: options.nodeType, timeRange: options.timeRange }
    );
  }

  /**
   * Export pipeline metrics. `format: "json"` returns `{ rows }`;
   * `format: "csv"` (default) returns the CSV text.
   */
  async exportMetrics(
    pipelineId: string,
    options: {
      timeRange?: MetricTimeRange;
      /** Comma-joined server-side; restrict export to these node types */
      nodeTypes?: string[];
      format?: "csv" | "json";
    } = {},
    params: { workspaceId?: string } = {}
  ): Promise<MetricsExportRows | string> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<MetricsExportRows | string>(
      `${this.base(workspaceId)}/${pipelineId}/export`,
      {
        timeRange: options.timeRange,
        nodeTypes: options.nodeTypes?.join(","),
        format: options.format,
      }
    );
  }

  /**
   * Active alerts for a pipeline.
   */
  async alerts(
    pipelineId: string,
    params: { workspaceId?: string } = {}
  ): Promise<PipelineAlertsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<PipelineAlertsResponse>(
      `${this.base(workspaceId)}/${pipelineId}/alerts`
    );
  }

  /**
   * Acknowledge an active alert.
   */
  async acknowledgeAlert(
    pipelineId: string,
    alertId: string,
    params: { workspaceId?: string } = {}
  ): Promise<{ success: boolean; alertId: string }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<{ success: boolean; alertId: string }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/${alertId}/acknowledge`,
      {}
    );
  }

  /**
   * List stored alert configurations for a pipeline.
   */
  async getAlertConfigs(
    pipelineId: string,
    params: { workspaceId?: string } = {}
  ): Promise<{ pipelineId: string; configs: MetricAlertConfig[]; count: number }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<{ pipelineId: string; configs: MetricAlertConfig[]; count: number }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/config`
    );
  }

  /**
   * Create or update an alert configuration (upsert keyed on
   * nodeType + metric). This is the custom-metrics-implementation hook:
   * route threshold breaches to in-app, email, or webhook channels.
   */
  async setAlertConfig(
    pipelineId: string,
    input: SetAlertConfigInput,
    params: { workspaceId?: string } = {}
  ): Promise<{ success: boolean; config: MetricAlertConfig }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<{ success: boolean; config: MetricAlertConfig }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/config`,
      input
    );
  }

  /**
   * Delete an alert configuration (identified by nodeType + metric).
   */
  async deleteAlertConfig(
    pipelineId: string,
    options: { nodeType: string; metric: string },
    params: { workspaceId?: string } = {}
  ): Promise<{ success: boolean; nodeType: string; metric: string }> {
    const workspaceId = this.getWorkspaceId(params);
    const query = new URLSearchParams({
      nodeType: options.nodeType,
      metric: options.metric,
    });
    return this.httpClient.delete<{ success: boolean; nodeType: string; metric: string }>(
      `${this.base(workspaceId)}/${pipelineId}/alerts/config?${query.toString()}`
    );
  }

  /**
   * Create a scoped MetricsNamespace with a preset workspaceId
   */
  withWorkspace(workspaceId: string): MetricsNamespace {
    return new MetricsNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
