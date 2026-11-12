/**
 * Feedback Namespace (admin-tier READ surface)
 *
 * Read and aggregate the message feedback a whitelabel's releases received.
 * Consumers SUBMIT feedback per-message via the chat namespace
 * (`client.chat.submitFeedback` / `submitAnonymousFeedback`); this namespace is
 * the operator's view of that feedback.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/message-feedback`) on 2026-06-11.
 */

import { BaseNamespace } from "../base.js";
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
 * Read message feedback for a whitelabel's releases.
 *
 * @example
 * ```typescript
 * const fb = client.feedback.withWorkspace("ws-123");
 *
 * // Most recent negative feedback that carries written detail
 * const { docs } = await fb.list({ sentiment: "negative", hasText: true });
 *
 * // Aggregate breakdown
 * const stats = await fb.stats();
 * console.log(stats.bySentiment, stats.byRelease);
 * ```
 */
export class FeedbackNamespace extends BaseNamespace {
  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/message-feedback`;
  }

  /**
   * List feedback records (paginated, filtered).
   *
   * `page` is 0-based and is converted to the wire `offset` (= page × limit);
   * `sort`/`sortDirection` map to the wire `sort-by`/`sort-dir` params.
   */
  async list(
    options: ListFeedbackOptions & { workspaceId?: string } = {}
  ): Promise<FeedbackListResult> {
    const workspaceId = this.getWorkspaceId(options);
    const limit = options.limit;
    const offset =
      options.page !== undefined
        ? options.page * (limit ?? DEFAULT_LIMIT)
        : undefined;

    const queryParams: Record<string, string | number | boolean | undefined> = {
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
    };

    return this.httpClient.get<FeedbackListResult>(this.base(workspaceId), queryParams);
  }

  /**
   * Server-computed aggregate stats (sentiment / source / per-release breakdown).
   */
  async stats(
    options: FeedbackStatsOptions & { workspaceId?: string } = {}
  ): Promise<MessageFeedbackStats> {
    const workspaceId = this.getWorkspaceId(options);
    const queryParams: Record<string, string | number | boolean | undefined> = {
      releaseId: options.releaseId,
      source: options.source,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
    };
    return this.httpClient.get<MessageFeedbackStats>(
      `${this.base(workspaceId)}/stats`,
      queryParams
    );
  }

  /** Get a single feedback record by id. */
  async get(params: { workspaceId?: string; feedbackId: string }): Promise<MessageFeedbackRecord> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<MessageFeedbackRecord>(
      `${this.base(workspaceId)}/${params.feedbackId}`
    );
  }

  /** Create a scoped FeedbackNamespace with a preset workspaceId. */
  withWorkspace(workspaceId: string): FeedbackNamespace {
    return new FeedbackNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
