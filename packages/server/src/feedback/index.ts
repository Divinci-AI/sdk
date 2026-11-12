/**
 * Feedback Client (server-side, admin-tier READ)
 *
 * Read and aggregate the message feedback a whitelabel's releases received.
 * Consumers SUBMIT feedback per message via the consumer SDK / chat endpoints;
 * this client is the operator's view of that feedback.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/message-feedback{,/stats,/:id}`) on 2026-06-11.
 */

import { ServerHttpClient } from "../http-client.js";
import type {
  MessageFeedbackRecord,
  FeedbackListResult,
  MessageFeedbackStats,
  ListFeedbackOptions,
  FeedbackStatsOptions,
} from "@divinci-ai/types";

export type {
  MessageFeedbackRecord,
  FeedbackListResult,
  MessageFeedbackStats,
  ListFeedbackOptions,
  FeedbackStatsOptions,
  FeedbackSource,
} from "@divinci-ai/types";

/** Default page size matching the server's `handlePagination` default. */
const DEFAULT_LIMIT = 50;

/**
 * Feedback Client
 *
 * @example
 * ```typescript
 * const { docs } = await divinci.feedback.list("ws-123", { sentiment: "negative", hasText: true });
 * const stats = await divinci.feedback.stats("ws-123");
 * console.log(stats.bySentiment, stats.byRelease);
 * ```
 */
export class FeedbackClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/message-feedback`;
  }

  /**
   * List feedback records (paginated, filtered).
   *
   * `page` is 0-based and is converted to the wire `offset` (= page × limit);
   * `sort`/`sortDirection` map to the wire `sort-by`/`sort-dir` params.
   */
  async list(workspaceId: string, options: ListFeedbackOptions = {}): Promise<FeedbackListResult> {
    const limit = options.limit;
    const offset =
      options.page !== undefined ? options.page * (limit ?? DEFAULT_LIMIT) : undefined;

    return this.httpClient.get<FeedbackListResult>(this.base(workspaceId), {
      releaseId: options.releaseId,
      sentiment: options.sentiment,
      source: options.source,
      hasText: options.hasText === true ? "true" : undefined,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      limit,
      offset,
      "sort-by": options.sort,
      "sort-dir": options.sortDirection,
    });
  }

  /** Server-computed aggregate stats (sentiment / source / per-release breakdown). */
  async stats(
    workspaceId: string,
    options: FeedbackStatsOptions = {}
  ): Promise<MessageFeedbackStats> {
    return this.httpClient.get<MessageFeedbackStats>(`${this.base(workspaceId)}/stats`, {
      releaseId: options.releaseId,
      source: options.source,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
    });
  }

  /** Get a single feedback record by id. */
  async get(workspaceId: string, feedbackId: string): Promise<MessageFeedbackRecord> {
    return this.httpClient.get<MessageFeedbackRecord>(`${this.base(workspaceId)}/${feedbackId}`);
  }
}
