/**
 * MetricsNamespace tests — paths/params encode the verified wire truth
 * (/white-label/:id/pipeline/metrics/*).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MetricsNamespace,
  type SetAlertConfigInput,
} from "../../src/namespaces/metrics/index.js";
import type { HttpClient } from "../../src/http-client.js";

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpClient;
}

describe("MetricsNamespace", () => {
  let mockHttpClient: HttpClient;
  let metrics: MetricsNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    metrics = new MetricsNamespace(mockHttpClient, { workspaceId: "ws-123" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("query() GETs the metrics root with filters", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ metrics: {} });

    await metrics.query({ pipelineId: "pipe-1", nodeType: "embedding", timeRange: "1h" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics",
      {
        pipelineId: "pipe-1",
        nodeType: "embedding",
        timeRange: "1h",
        includeAlerts: undefined,
      }
    );
  });

  it("pipeline() GETs /:pipelineId", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ pipelineId: "pipe-1", metrics: {} });

    await metrics.pipeline("pipe-1", { timeRange: "24h" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1",
      { nodeType: undefined, timeRange: "24h" }
    );
  });

  it("exportMetrics() joins nodeTypes and passes format", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ rows: [] });

    await metrics.exportMetrics("pipe-1", {
      timeRange: "7d",
      nodeTypes: ["chunking", "embedding"],
      format: "json",
    });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1/export",
      { timeRange: "7d", nodeTypes: "chunking,embedding", format: "json" }
    );
  });

  it("alerts() GETs /:pipelineId/alerts", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ alerts: [], count: 0 });

    await metrics.alerts("pipe-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1/alerts"
    );
  });

  it("acknowledgeAlert() POSTs /alerts/:alertId/acknowledge", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ success: true, alertId: "a-1" });

    await metrics.acknowledgeAlert("pipe-1", "a-1");

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1/alerts/a-1/acknowledge",
      {}
    );
  });

  it("getAlertConfigs() GETs /alerts/config", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ configs: [], count: 0 });

    await metrics.getAlertConfigs("pipe-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1/alerts/config"
    );
  });

  it("setAlertConfig() POSTs the alert config", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ success: true, config: {} });

    const input: SetAlertConfigInput = {
      nodeType: "embedding",
      metric: "errorRate",
      thresholds: { warning: 0.05, critical: 0.2 },
      notificationChannels: [
        { type: "webhook", config: { url: "https://ops.example.com/alert" } },
      ],
    };
    await metrics.setAlertConfig("pipe-1", input);

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1/alerts/config",
      input
    );
  });

  it("deleteAlertConfig() DELETEs with nodeType+metric query", async () => {
    vi.mocked(mockHttpClient.delete).mockResolvedValue({ success: true });

    await metrics.deleteAlertConfig("pipe-1", { nodeType: "embedding", metric: "errorRate" });

    expect(mockHttpClient.delete).toHaveBeenCalledWith(
      "/white-label/ws-123/pipeline/metrics/pipe-1/alerts/config?nodeType=embedding&metric=errorRate"
    );
  });

  it("withWorkspace() returns a scoped namespace", async () => {
    const scoped = metrics.withWorkspace("ws-other");
    vi.mocked(mockHttpClient.get).mockResolvedValue({ alerts: [], count: 0 });

    await scoped.alerts("pipe-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-other/pipeline/metrics/pipe-1/alerts"
    );
  });
});
