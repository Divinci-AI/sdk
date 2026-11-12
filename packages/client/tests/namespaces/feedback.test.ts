/**
 * FeedbackNamespace tests — paths/params encode the verified wire truth
 * (/white-label/:id/message-feedback{,/stats,/:id}). Pagination maps page→offset
 * and sort/sortDirection→sort-by/sort-dir, which is what the server reads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedbackNamespace } from "../../src/namespaces/feedback/index.js";
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

describe("FeedbackNamespace", () => {
  let mockHttpClient: HttpClient;
  let feedback: FeedbackNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    feedback = new FeedbackNamespace(mockHttpClient, { workspaceId: "ws-123" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list() GETs the message-feedback root with default (empty) params", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ docs: [], pagination: {} });

    await feedback.list();

    expect(mockHttpClient.get).toHaveBeenCalledWith("/white-label/ws-123/message-feedback", {
      releaseId: undefined,
      sentiment: undefined,
      source: undefined,
      hasText: undefined,
      createdAfter: undefined,
      createdBefore: undefined,
      limit: undefined,
      offset: undefined,
      "sort-by": undefined,
      "sort-dir": undefined,
    });
  });

  it("list() maps filters and converts hasText→'true'", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ docs: [], pagination: {} });

    await feedback.list({
      releaseId: "rel-1",
      sentiment: "negative",
      source: "anonymous",
      hasText: true,
      createdAfter: 1000,
      createdBefore: 2000,
    });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/message-feedback",
      expect.objectContaining({
        releaseId: "rel-1",
        sentiment: "negative",
        source: "anonymous",
        hasText: "true",
        createdAfter: 1000,
        createdBefore: 2000,
      })
    );
  });

  it("list() converts page→offset using the provided limit", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ docs: [], pagination: {} });

    await feedback.list({ page: 2, limit: 25, sort: "createdAt", sortDirection: "asc" });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/message-feedback",
      expect.objectContaining({
        limit: 25,
        offset: 50,
        "sort-by": "createdAt",
        "sort-dir": "asc",
      })
    );
  });

  it("list() converts page→offset using the default limit (50) when limit omitted", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ docs: [], pagination: {} });

    await feedback.list({ page: 3 });

    const [, params] = vi.mocked(mockHttpClient.get).mock.calls[0];
    expect(params).toMatchObject({ offset: 150, limit: undefined });
  });

  it("list() leaves offset undefined when no page is given", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ docs: [], pagination: {} });

    await feedback.list({ limit: 10 });

    const [, params] = vi.mocked(mockHttpClient.get).mock.calls[0];
    expect(params).toMatchObject({ offset: undefined, limit: 10 });
  });

  it("stats() GETs /stats with only the stats filters", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ total: 0 });

    await feedback.stats({ releaseId: "rel-1", source: "authed", createdAfter: 1000 });

    expect(mockHttpClient.get).toHaveBeenCalledWith("/white-label/ws-123/message-feedback/stats", {
      releaseId: "rel-1",
      source: "authed",
      createdAfter: 1000,
      createdBefore: undefined,
    });
  });

  it("get() GETs /:feedbackId", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ id: "fb-1" });

    await feedback.get({ feedbackId: "fb-1" });

    expect(mockHttpClient.get).toHaveBeenCalledWith("/white-label/ws-123/message-feedback/fb-1");
  });

  it("throws a clear error when no workspaceId is available", async () => {
    const unscoped = new FeedbackNamespace(mockHttpClient, {});
    await expect(unscoped.list()).rejects.toThrow(/workspaceId is required/);
  });

  it("withWorkspace() scopes subsequent calls to the new id", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ docs: [], pagination: {} });

    await feedback.withWorkspace("ws-999").list();

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-999/message-feedback",
      expect.any(Object)
    );
  });
});
