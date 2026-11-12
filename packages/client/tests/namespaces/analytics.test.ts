/**
 * AnalyticsNamespace tests — paths/params encode the verified wire truth
 * (/white-label/:id/analytics/products/*).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AnalyticsNamespace,
  type ProductEventInput,
} from "../../src/namespaces/analytics/index.js";
import type { HttpClient } from "../../src/http-client.js";

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getBaseUrl: vi.fn().mockReturnValue("https://api.example.com"),
    getToken: vi.fn().mockResolvedValue(null),
  } as unknown as HttpClient;
}

describe("AnalyticsNamespace", () => {
  let mockHttpClient: HttpClient;
  let analytics: AnalyticsNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    analytics = new AnalyticsNamespace(mockHttpClient, { workspaceId: "ws-123" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("metrics() GETs /analytics/products/metrics with timeRange", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ current: {}, previous: {} });

    await analytics.metrics({ timeRange: "30d" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/analytics/products/metrics",
      { timeRange: "30d" }
    );
  });

  it("trends() GETs /trends with granularity", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ trends: [] });

    await analytics.trends({ timeRange: "7d", granularity: "hourly" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/analytics/products/trends",
      { timeRange: "7d", granularity: "hourly" }
    );
  });

  it("performance() GETs /performance with limit + sortBy", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ products: [], totalProducts: 0 });

    await analytics.performance({ limit: 10, sortBy: "ctr" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/analytics/products/performance",
      { timeRange: undefined, limit: 10, sortBy: "ctr" }
    );
  });

  it("experiments() GETs /experiments with status filter", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ experiments: [], totalExperiments: 0 });

    await analytics.experiments({ status: "running" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/analytics/products/experiments",
      { experimentId: undefined, status: "running" }
    );
  });

  it("funnel() GETs /funnel", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ funnel: [] });

    await analytics.funnel({ timeRange: "1d" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/analytics/products/funnel",
      { timeRange: "1d" }
    );
  });

  it("trackEvents() POSTs the events batch", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ accepted: 1, rejected: 0 });

    const events: ProductEventInput[] = [
      { event: "product_click", productId: "sku-1", sessionId: "s-1" },
    ];
    const result = await analytics.trackEvents(events);

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/analytics/products/events",
      { events }
    );
    expect(result).toEqual({ accepted: 1, rejected: 0 });
  });

  it("withWorkspace() returns a scoped namespace", async () => {
    const scoped = analytics.withWorkspace("ws-other");
    vi.mocked(mockHttpClient.get).mockResolvedValue({ current: {}, previous: {} });

    await scoped.metrics();

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-other/analytics/products/metrics",
      { timeRange: undefined }
    );
  });
});
