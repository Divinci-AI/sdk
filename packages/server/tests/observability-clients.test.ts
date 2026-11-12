/**
 * Notification / Analytics / Metrics / Usage client tests
 *
 * Paths and verbs encode the VERIFIED wire truth (public-api whitelabel
 * router, audited 2026-06-10).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationClient } from "../src/notifications/index.js";
import { AnalyticsClient } from "../src/analytics/index.js";
import { MetricsClient } from "../src/metrics/index.js";
import { UsageClient } from "../src/usage/index.js";
import { FeedbackClient } from "../src/feedback/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ServerHttpClient;
}

describe("NotificationClient", () => {
  let http: ServerHttpClient;
  let client: NotificationClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new NotificationClient(http);
  });

  it("list() GETs /notification with notificationType mapping", async () => {
    http.get = vi.fn().mockResolvedValue({ docs: [], pagination: {} });

    await client.list("ws-1", { isRead: false, type: "system", tags: ["a", "b"] });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/notification",
      expect.objectContaining({ isRead: false, notificationType: "system", tags: "a,b" })
    );
  });

  it("getCounts() GETs /notification/counts", async () => {
    http.get = vi.fn().mockResolvedValue({ total: 5, unread: 2 });

    const counts = await client.getCounts("ws-1");

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/counts",
      expect.any(Object)
    );
    expect(counts.unread).toBe(2);
  });

  it("markAsRead() PATCHes /:id/read", async () => {
    http.patch = vi.fn().mockResolvedValue({ _id: "n-1", isRead: true });

    await client.markAsRead("ws-1", "n-1", true);

    expect(http.patch).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/n-1/read",
      { isRead: true }
    );
  });

  it("setTags() PUTs /:id/tags", async () => {
    http.put = vi.fn().mockResolvedValue({ _id: "n-1", tags: ["x"] });

    await client.setTags("ws-1", "n-1", ["x"]);

    expect(http.put).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/n-1/tags",
      { tags: ["x"] }
    );
  });

  it("note helpers hit /notes routes with POST/PUT/DELETE", async () => {
    http.post = vi.fn().mockResolvedValue({ _id: "n-1" });
    http.put = vi.fn().mockResolvedValue({ _id: "n-1" });
    http.delete = vi.fn().mockResolvedValue({ _id: "n-1" });

    await client.addNote("ws-1", "n-1", "hello");
    await client.updateNote("ws-1", "n-1", "note-1", "edited");
    await client.deleteNote("ws-1", "n-1", "note-1");

    expect(http.post).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/n-1/notes",
      { content: "hello" }
    );
    expect(http.put).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/n-1/notes/note-1",
      { content: "edited" }
    );
    expect(http.delete).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/n-1/notes/note-1"
    );
  });

  it("channels sub-client hits /delivery-channel routes", async () => {
    http.post = vi.fn().mockResolvedValue({ _id: "ch-1" });
    http.get = vi.fn().mockResolvedValue([]);

    await client.channels.list("ws-1", { verified: true });
    await client.channels.test("ws-1", "ch-1");

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/delivery-channel",
      { verified: true }
    );
    expect(http.post).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/delivery-channel/ch-1/test",
      {}
    );
  });

  it("triggers sub-client uses PUT for update", async () => {
    http.put = vi.fn().mockResolvedValue({ _id: "t-1" });

    const input = {
      title: "T",
      description: "",
      triggerByDefault: false,
      rules: [],
      channels: [],
    };
    await client.triggers.update("ws-1", "t-1", input);

    expect(http.put).toHaveBeenCalledWith(
      "/white-label/ws-1/notification/delivery-trigger/t-1",
      input
    );
  });

  it("flaggers sub-client supports CRUD + testRun", async () => {
    http.post = vi.fn().mockResolvedValue({ flagged: true });
    http.get = vi.fn().mockResolvedValue([]);

    await client.flaggers.list("ws-1");
    const result = await client.flaggers.testRun("ws-1", "f-1", "sample");

    expect(http.get).toHaveBeenCalledWith("/white-label/ws-1/notification-flagger");
    expect(http.post).toHaveBeenCalledWith(
      "/white-label/ws-1/notification-flagger/f-1/test-run",
      { prompt: "sample" }
    );
    expect(result).toEqual({ flagged: true });
  });
});

describe("AnalyticsClient", () => {
  let http: ServerHttpClient;
  let client: AnalyticsClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new AnalyticsClient(http);
  });

  it("metrics() GETs /analytics/products/metrics", async () => {
    http.get = vi.fn().mockResolvedValue({ current: {}, previous: {} });

    await client.metrics("ws-1", { timeRange: "30d" });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/analytics/products/metrics",
      { timeRange: "30d" }
    );
  });

  it("experiments() GETs /experiments with filters", async () => {
    http.get = vi.fn().mockResolvedValue({ experiments: [], totalExperiments: 0 });

    await client.experiments("ws-1", { status: "running" });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/analytics/products/experiments",
      { experimentId: undefined, status: "running" }
    );
  });

  it("trackEvents() POSTs the batch", async () => {
    http.post = vi.fn().mockResolvedValue({ accepted: 1, rejected: 0 });

    await client.trackEvents("ws-1", [{ event: "product_view", productId: "p-1" }]);

    expect(http.post).toHaveBeenCalledWith(
      "/white-label/ws-1/analytics/products/events",
      { events: [{ event: "product_view", productId: "p-1" }] }
    );
  });
});

describe("MetricsClient", () => {
  let http: ServerHttpClient;
  let client: MetricsClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new MetricsClient(http);
  });

  it("pipeline() GETs /pipeline/metrics/:id", async () => {
    http.get = vi.fn().mockResolvedValue({ metrics: {} });

    await client.pipeline("ws-1", "pipe-1", { timeRange: "24h" });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/pipeline/metrics/pipe-1",
      { nodeType: undefined, timeRange: "24h" }
    );
  });

  it("setAlertConfig() POSTs /alerts/config", async () => {
    http.post = vi.fn().mockResolvedValue({ success: true, config: {} });

    const input = {
      nodeType: "embedding",
      metric: "errorRate",
      thresholds: { warning: 0.05 },
      notificationChannels: [
        { type: "webhook" as const, config: { url: "https://x.example.com" } },
      ],
    };
    await client.setAlertConfig("ws-1", "pipe-1", input);

    expect(http.post).toHaveBeenCalledWith(
      "/white-label/ws-1/pipeline/metrics/pipe-1/alerts/config",
      input
    );
  });

  it("deleteAlertConfig() DELETEs with query params", async () => {
    http.delete = vi.fn().mockResolvedValue({ success: true });

    await client.deleteAlertConfig("ws-1", "pipe-1", {
      nodeType: "embedding",
      metric: "errorRate",
    });

    expect(http.delete).toHaveBeenCalledWith(
      "/white-label/ws-1/pipeline/metrics/pipe-1/alerts/config?nodeType=embedding&metric=errorRate"
    );
  });

  it("exportMetrics() joins nodeTypes", async () => {
    http.get = vi.fn().mockResolvedValue({ rows: [] });

    await client.exportMetrics("ws-1", "pipe-1", {
      nodeTypes: ["a", "b"],
      format: "json",
    });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/pipeline/metrics/pipe-1/export",
      { timeRange: undefined, nodeTypes: "a,b", format: "json" }
    );
  });
});

describe("UsageClient", () => {
  let http: ServerHttpClient;
  let client: UsageClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new UsageClient(http);
  });

  it("apiKeyUsage() GETs /:orgName/usage with date range", async () => {
    http.get = vi.fn().mockResolvedValue({ success: true, stats: {} });

    await client.apiKeyUsage("ws-1", "openai", { startDate: 1, endDate: 2 });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/workspace-api-keys/openai/usage",
      { startDate: 1, endDate: 2 }
    );
  });

  it("billingReport() GETs /billing-report", async () => {
    http.get = vi.fn().mockResolvedValue({});

    await client.billingReport("ws-1");

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/workspace-api-keys/billing-report"
    );
  });
});

describe("FeedbackClient", () => {
  let http: ServerHttpClient;
  let client: FeedbackClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new FeedbackClient(http);
  });

  it("list() GETs /message-feedback mapping filters + hasText→'true'", async () => {
    http.get = vi.fn().mockResolvedValue({ docs: [], pagination: {} });

    await client.list("ws-1", { sentiment: "negative", source: "anonymous", hasText: true });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/message-feedback",
      expect.objectContaining({
        sentiment: "negative",
        source: "anonymous",
        hasText: "true",
      })
    );
  });

  it("list() converts page→offset and sort→sort-by/sort-dir", async () => {
    http.get = vi.fn().mockResolvedValue({ docs: [], pagination: {} });

    await client.list("ws-1", { page: 2, limit: 25, sort: "createdAt", sortDirection: "asc" });

    expect(http.get).toHaveBeenCalledWith(
      "/white-label/ws-1/message-feedback",
      expect.objectContaining({
        limit: 25,
        offset: 50,
        "sort-by": "createdAt",
        "sort-dir": "asc",
      })
    );
  });

  it("list() uses default limit (50) for offset when limit omitted", async () => {
    http.get = vi.fn().mockResolvedValue({ docs: [], pagination: {} });

    await client.list("ws-1", { page: 3 });

    const params = (http.get as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params).toMatchObject({ offset: 150, limit: undefined });
  });

  it("stats() GETs /stats with stats filters only", async () => {
    http.get = vi.fn().mockResolvedValue({ total: 0 });

    await client.stats("ws-1", { releaseId: "rel-1", source: "authed" });

    expect(http.get).toHaveBeenCalledWith("/white-label/ws-1/message-feedback/stats", {
      releaseId: "rel-1",
      source: "authed",
      createdAfter: undefined,
      createdBefore: undefined,
    });
  });

  it("get() GETs /:feedbackId", async () => {
    http.get = vi.fn().mockResolvedValue({ id: "fb-1" });

    await client.get("ws-1", "fb-1");

    expect(http.get).toHaveBeenCalledWith("/white-label/ws-1/message-feedback/fb-1");
  });
});
