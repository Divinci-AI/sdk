/**
 * Message feedback types (admin-tier READ surface).
 *
 * Consumers SUBMIT feedback per-message via the chat namespace
 * (`MessageFeedbackInput` / `AnonymousFeedbackInput` in `chat.ts`). These types
 * model the READ side — a whitelabel owner viewing the feedback their releases
 * received. They are decoupled from the server's Notification storage shape.
 */

/** Where a feedback submission originated. */
export type FeedbackSource = "authed" | "anonymous";

/**
 * A single feedback record, as returned by the read API.
 * `sentiment`: -1 = thumbs-down, 1 = thumbs-up, null = free-text feedback only.
 */
export interface MessageFeedbackRecord {
  /** Record id. */
  id: string;
  /** Release the rated message belongs to. */
  releaseId: string;
  /** Human-readable release title, when known. */
  releaseTitle?: string;
  /** Persisted chat id (authed feedback, or anonymous sessions that were saved). */
  chatId?: string;
  /** Server message id (authed) or `anon#<index>` (anonymous). */
  messageRef: string;
  /** -1 = thumbs-down, 1 = thumbs-up, null = feedback-text only. */
  sentiment: -1 | 1 | null;
  /** Free-text the user typed in the thumbs-down dropdown. */
  feedback?: string;
  /** Excerpt of the user's prompt for context (anonymous flow). */
  userPrompt?: string;
  /** Excerpt of the AI response that was rated. */
  responseExcerpt?: string;
  /** Whether the feedback came from an authed user or an anonymous visitor. */
  source: FeedbackSource;
  /** Submitter user id (authed only). */
  userId?: string;
  /** Submitter email (collected on the anonymous form, or resolved for authed). */
  email?: string;
  /** Deep link to the thread (authed only). */
  threadLink?: string;
  /** Submission time, epoch ms. */
  createdAt: number;
  /** Whether the underlying notification has been marked read. */
  isRead: boolean;
}

/** Filters + pagination for `feedback.list()`. */
export interface ListFeedbackOptions {
  /** Only feedback for this release. */
  releaseId?: string;
  /** Filter by sentiment bucket. */
  sentiment?: "positive" | "negative" | "neutral";
  /** Filter by submission origin. */
  source?: FeedbackSource;
  /** Only records that carry free-text feedback. */
  hasText?: boolean;
  /** Lower bound on createdAt (epoch ms). */
  createdAfter?: number;
  /** Upper bound on createdAt (epoch ms). */
  createdBefore?: number;
  /** Page index (0-based). */
  page?: number;
  /** Page size (max 100). */
  limit?: number;
  /** Sort key. */
  sort?: "createdAt" | "_id";
  /** Sort direction (default desc). */
  sortDirection?: "asc" | "desc";
}

/** Filters for `feedback.stats()`. */
export interface FeedbackStatsOptions {
  releaseId?: string;
  source?: FeedbackSource;
  createdAfter?: number;
  createdBefore?: number;
}

/** Paginated `feedback.list()` result. */
export interface FeedbackListResult {
  docs: MessageFeedbackRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/** Aggregated feedback stats for a whitelabel. */
export interface MessageFeedbackStats {
  total: number;
  bySentiment: {
    positive: number;
    negative: number;
    neutral: number;
  };
  bySource: {
    authed: number;
    anonymous: number;
  };
  /** Count of records carrying free-text feedback. */
  withText: number;
  /** Per-release breakdown, ordered by count desc. */
  byRelease: Array<{
    releaseId: string;
    releaseTitle?: string;
    count: number;
    positive: number;
    negative: number;
  }>;
  /** Echo of the time window applied (epoch ms), when supplied. */
  timeRange: {
    from?: number;
    to?: number;
  };
}
