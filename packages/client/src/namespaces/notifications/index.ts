/**
 * Notifications Namespace
 *
 * Handles workspace notifications, notes, delivery channels, delivery
 * triggers, and custom notification flaggers.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/notification` — singular) on 2026-06-10.
 */

import { BaseNamespace } from "../base.js";
import type { HttpClient } from "../../http-client.js";
import type { NamespaceContext } from "../base.js";

/**
 * Notification document
 *
 * Wire fields: `notificationType` (not `type`), `details` payload, epoch-ms
 * timestamps. Legacy declared fields kept optional for compatibility.
 */
export interface NotificationDoc {
  _id: string;
  whitelabelId?: string;
  /** Notification type (wire field name) */
  notificationType?: string;
  /** @deprecated wire sends `notificationType` */
  type?: NotificationType;
  /** Emoji/icon for the notification */
  icon?: string;
  title: string;
  /** @deprecated wire sends `details` payload, not a flat message */
  message?: string;
  /** Structured payload for the notification */
  details?: Record<string, unknown>;
  isRead: boolean;
  tags: string[];
  notes: NotificationNote[];
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  /** Epoch ms on wire */
  createdAt: string | number;
  /** Epoch ms on wire */
  updatedAt: string | number;
}

/**
 * Notification types
 */
export type NotificationType =
  | "info"
  | "warning"
  | "error"
  | "success"
  | "audio_complete"
  | "rag_complete"
  | "finetune_complete"
  | "system";

/**
 * Notification note
 */
export interface NotificationNote {
  _id: string;
  content: string;
  createdAt: string | number;
  updatedAt: string | number;
}

/**
 * List notifications filters
 */
export interface ListNotificationsFilters {
  page?: number;
  limit?: number;
  isRead?: boolean;
  tags?: string[];
  /** Filter by notification type (sent as `notificationType` on the wire) */
  type?: NotificationType | string;
  title?: string;
  /** Filter by recipient email */
  email?: string;
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Notifications list response
 */
export interface NotificationsListResponse {
  docs: NotificationDoc[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    /** Total page count (wire field name) */
    pages?: number;
    /** @deprecated wire sends `pages` */
    totalPages?: number;
  };
}

/**
 * Notification counts
 */
export interface NotificationCounts {
  total: number;
  unread: number;
}

/**
 * Tag suggestion
 */
export interface TagSuggestion {
  tagName: string;
  usageCount: number;
  lastUsed: string;
}

/* ─────────────────────────── Delivery channels ─────────────────────────── */

/** Webhook retry policy */
export interface WebhookRetryPolicy {
  /** 0–10 */
  maxRetries: number;
  backoffType: "linear" | "exponential";
  /** 1 000–60 000 ms */
  initialDelayMs: number;
  /** 1 000–300 000 ms */
  maxDelayMs: number;
}

/** Email channel configuration */
export interface EmailChannelInput {
  channelName: string;
  deliveryMethod: "email";
  details: { emailAddress: string };
}

/** Webhook channel configuration */
export interface WebhookChannelInput {
  channelName: string;
  deliveryMethod: "webhook";
  details: {
    /** Public URL — localhost / private networks / cloud metadata endpoints are rejected */
    url: string;
    method: "POST" | "PUT";
    headers: Record<string, string>;
    /** HMAC secret, min 32 chars */
    secret: string;
    retryPolicy: WebhookRetryPolicy;
    /** 5 000–30 000 ms */
    timeout: number;
  };
}

/** Input for creating/updating a delivery channel */
export type DeliveryChannelInput = EmailChannelInput | WebhookChannelInput;

/** Delivery channel document */
export type DeliveryChannelDoc = DeliveryChannelInput & {
  _id: string;
  target: string;
  verified: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
};

/** Webhook delivery log entry */
export interface WebhookDeliveryLog {
  _id: string;
  channelId: string;
  target: string;
  /** HTTP status of the delivery attempt */
  statusCode?: number;
  success?: boolean;
  error?: string;
  attempt?: number;
  createdAt: string | number;
}

/* ─────────────────────────── Delivery triggers ─────────────────────────── */

/** A tag-matching rule on a delivery trigger */
export type DeliveryTriggerRule =
  | { mode: "if-any-tag"; tags: string[]; action: "triggered" | "fail" }
  | { mode: "if-all-tags"; tags: string[]; action: "triggered" | "fail" }
  | { mode: "if-no-tags"; action: "triggered" | "fail" };

/** Input for creating/updating a delivery trigger */
export interface DeliveryTriggerInput {
  title: string;
  description: string;
  /** Fire for notifications that match no rule */
  triggerByDefault: boolean;
  rules: DeliveryTriggerRule[];
  /** Delivery channel ids to notify when triggered */
  channels: string[];
}

/** Delivery trigger document */
export type DeliveryTriggerDoc = DeliveryTriggerInput & {
  _id: string;
  target: string;
  createdAt?: string | number;
  updatedAt?: string | number;
};

/* ─────────────────────── Custom notification flaggers ─────────────────────── */

/**
 * Input for creating/updating a custom notification flagger.
 *
 * A flagger runs an LLM evaluation (driven by `assistant` + `prefix`) against
 * chat traffic and raises a notification when it flags. `outputKeys` lists
 * the fields to extract from the LLM output.
 */
export interface NotificationFlaggerInput {
  title: string;
  notificationIcon: string;
  notificationMessage: string;
  notificationTags: string[];
  /** AI assistant/model id used to run the flagger */
  assistant: string;
  /** Prompt prefix for the flagger evaluation */
  prefix: string;
  /** Fields to extract from the LLM output */
  outputKeys: string[];
  /** Include the user's input in the flagger call */
  flagInput: boolean;
  /** Also notify the end user (not just admins) */
  notifyUser: boolean;
}

/** Custom notification flagger document */
export type NotificationFlaggerDoc = NotificationFlaggerInput & {
  _id: string;
  target: string;
  createdAt?: string | number;
  updatedAt?: string | number;
};

/**
 * Notes sub-namespace
 */
export class NotesNamespace extends BaseNamespace {
  private workspaceId: string;
  private notificationId: string;

  constructor(
    httpClient: HttpClient,
    context: NamespaceContext,
    workspaceId: string,
    notificationId: string
  ) {
    super(httpClient, context);
    this.workspaceId = workspaceId;
    this.notificationId = notificationId;
  }

  /**
   * Add a note to the notification
   */
  async add(content: string): Promise<NotificationDoc> {
    return this.httpClient.post<NotificationDoc>(
      `/white-label/${this.workspaceId}/notification/${this.notificationId}/notes`,
      { content }
    );
  }

  /**
   * Update a note
   */
  async update(noteId: string, content: string): Promise<NotificationDoc> {
    return this.httpClient.put<NotificationDoc>(
      `/white-label/${this.workspaceId}/notification/${this.notificationId}/notes/${noteId}`,
      { content }
    );
  }

  /**
   * Delete a note
   */
  async delete(noteId: string): Promise<NotificationDoc> {
    return this.httpClient.delete<NotificationDoc>(
      `/white-label/${this.workspaceId}/notification/${this.notificationId}/notes/${noteId}`
    );
  }
}

/**
 * Delivery channels sub-namespace — where notifications get sent (email,
 * webhook). Channels must be verified before they receive real notifications.
 *
 * @example
 * ```typescript
 * const channels = client.notifications.channels({ workspaceId: "ws-123" });
 *
 * // Register a webhook channel (custom notification implementation)
 * const channel = await channels.create({
 *   channelName: "Ops webhook",
 *   deliveryMethod: "webhook",
 *   details: {
 *     url: "https://ops.example.com/divinci-hook",
 *     method: "POST",
 *     headers: {},
 *     secret: "a".repeat(32),
 *     retryPolicy: { maxRetries: 3, backoffType: "exponential", initialDelayMs: 1000, maxDelayMs: 60000 },
 *     timeout: 10000,
 *   },
 * });
 *
 * await channels.test(channel._id);              // send a test notification
 * const { logs } = await channels.deliveryLogs(channel._id);
 * ```
 */
export class DeliveryChannelsNamespace extends BaseNamespace {
  private workspaceId: string;

  constructor(httpClient: HttpClient, context: NamespaceContext, workspaceId: string) {
    super(httpClient, context);
    this.workspaceId = workspaceId;
  }

  private base(): string {
    return `/white-label/${this.workspaceId}/notification/delivery-channel`;
  }

  /** Create a delivery channel (email or webhook). */
  async create(input: DeliveryChannelInput): Promise<DeliveryChannelDoc> {
    return this.httpClient.post<DeliveryChannelDoc>(this.base(), input);
  }

  /** List channels. Pass `verified` to filter. */
  async list(options: { verified?: boolean } = {}): Promise<DeliveryChannelDoc[]> {
    return this.httpClient.get<DeliveryChannelDoc[]>(
      this.base(),
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /** Get a channel by id. */
  async get(channelId: string): Promise<DeliveryChannelDoc> {
    return this.httpClient.get<DeliveryChannelDoc>(`${this.base()}/${channelId}`);
  }

  /** Update a channel's configuration. */
  async update(channelId: string, input: DeliveryChannelInput): Promise<DeliveryChannelDoc> {
    return this.httpClient.post<DeliveryChannelDoc>(`${this.base()}/${channelId}`, input);
  }

  /** Send a test notification to a verified channel. */
  async test(channelId: string): Promise<{ success: boolean; message: string }> {
    return this.httpClient.post<{ success: boolean; message: string }>(
      `${this.base()}/${channelId}/test`,
      {}
    );
  }

  /** Regenerate the channel's verification code. */
  async regenerateVerification(channelId: string): Promise<{ success: boolean; message: string }> {
    return this.httpClient.post<{ success: boolean; message: string }>(
      `${this.base()}/${channelId}/regenerate-verification`,
      {}
    );
  }

  /** Send a verification email (email channels only). */
  async sendVerificationEmail(
    channelId: string
  ): Promise<{ success: boolean; message: string; emailAddress?: string }> {
    return this.httpClient.post<{ success: boolean; message: string; emailAddress?: string }>(
      `${this.base()}/${channelId}/send-verification-email`,
      {}
    );
  }

  /** Recent webhook delivery logs (last 100; webhook channels only). */
  async deliveryLogs(channelId: string): Promise<{ logs: WebhookDeliveryLog[] }> {
    return this.httpClient.get<{ logs: WebhookDeliveryLog[] }>(
      `${this.base()}/${channelId}/delivery-logs`
    );
  }

  /** Delete a channel. Returns the deleted document. */
  async delete(channelId: string): Promise<DeliveryChannelDoc> {
    return this.httpClient.delete<DeliveryChannelDoc>(`${this.base()}/${channelId}`);
  }
}

/**
 * Delivery triggers sub-namespace — tag-matching rules that decide WHICH
 * notifications go to WHICH channels.
 *
 * @example
 * ```typescript
 * const triggers = client.notifications.triggers({ workspaceId: "ws-123" });
 * await triggers.create({
 *   title: "Escalations to ops",
 *   description: "Send anything tagged urgent to the ops webhook",
 *   triggerByDefault: false,
 *   rules: [{ mode: "if-any-tag", tags: ["urgent"], action: "triggered" }],
 *   channels: [channelId],
 * });
 * ```
 */
export class DeliveryTriggersNamespace extends BaseNamespace {
  private workspaceId: string;

  constructor(httpClient: HttpClient, context: NamespaceContext, workspaceId: string) {
    super(httpClient, context);
    this.workspaceId = workspaceId;
  }

  private base(): string {
    return `/white-label/${this.workspaceId}/notification/delivery-trigger`;
  }

  /** Create a delivery trigger. */
  async create(input: DeliveryTriggerInput): Promise<DeliveryTriggerDoc> {
    return this.httpClient.post<DeliveryTriggerDoc>(this.base(), input);
  }

  /** List all triggers for the workspace. */
  async list(): Promise<DeliveryTriggerDoc[]> {
    return this.httpClient.get<DeliveryTriggerDoc[]>(this.base());
  }

  /** Get a trigger by id. */
  async get(triggerId: string): Promise<DeliveryTriggerDoc> {
    return this.httpClient.get<DeliveryTriggerDoc>(`${this.base()}/${triggerId}`);
  }

  /** Replace a trigger's configuration. */
  async update(triggerId: string, input: DeliveryTriggerInput): Promise<DeliveryTriggerDoc> {
    return this.httpClient.put<DeliveryTriggerDoc>(`${this.base()}/${triggerId}`, input);
  }

  /** Delete a trigger. Returns the deleted document. */
  async delete(triggerId: string): Promise<DeliveryTriggerDoc> {
    return this.httpClient.delete<DeliveryTriggerDoc>(`${this.base()}/${triggerId}`);
  }
}

/**
 * Custom notification flaggers sub-namespace — YOUR custom notification
 * implementations. A flagger runs an LLM evaluation against chat traffic and
 * raises a tagged notification when it flags; pair with delivery triggers +
 * channels to route those notifications anywhere (email, webhook).
 *
 * @example
 * ```typescript
 * const flaggers = client.notifications.flaggers({ workspaceId: "ws-123" });
 *
 * const flagger = await flaggers.create({
 *   title: "Refund-request detector",
 *   notificationIcon: "💸",
 *   notificationMessage: "A user asked about refunds",
 *   notificationTags: ["refund", "urgent"],
 *   assistant: "gemini-3-5-flash",
 *   prefix: "Does this message ask for a refund? Answer with JSON {\"flagged\": boolean}",
 *   outputKeys: ["flagged"],
 *   flagInput: true,
 *   notifyUser: false,
 * });
 *
 * // Dry-run against a sample prompt (billed like a normal LLM call)
 * const result = await flaggers.testRun(flagger._id, "I want my money back!");
 * ```
 */
export class NotificationFlaggersNamespace extends BaseNamespace {
  private workspaceId: string;

  constructor(httpClient: HttpClient, context: NamespaceContext, workspaceId: string) {
    super(httpClient, context);
    this.workspaceId = workspaceId;
  }

  private base(): string {
    return `/white-label/${this.workspaceId}/notification-flagger`;
  }

  /** Create a custom flagger. */
  async create(input: NotificationFlaggerInput): Promise<NotificationFlaggerDoc> {
    return this.httpClient.post<NotificationFlaggerDoc>(this.base(), input);
  }

  /** List the workspace's custom flaggers. */
  async list(): Promise<NotificationFlaggerDoc[]> {
    return this.httpClient.get<NotificationFlaggerDoc[]>(this.base());
  }

  /** Get a flagger by id. */
  async get(flaggerId: string): Promise<NotificationFlaggerDoc> {
    return this.httpClient.get<NotificationFlaggerDoc>(`${this.base()}/${flaggerId}`);
  }

  /** Update a flagger. */
  async update(
    flaggerId: string,
    input: Partial<NotificationFlaggerInput>
  ): Promise<NotificationFlaggerDoc> {
    return this.httpClient.post<NotificationFlaggerDoc>(`${this.base()}/${flaggerId}`, input);
  }

  /** Delete a flagger. */
  async delete(flaggerId: string): Promise<NotificationFlaggerDoc> {
    return this.httpClient.delete<NotificationFlaggerDoc>(`${this.base()}/${flaggerId}`);
  }

  /**
   * Test-run the flagger against a sample prompt. Returns the extracted LLM
   * output (the fields named by `outputKeys`). Billed like a normal LLM call.
   */
  async testRun(flaggerId: string, prompt: string): Promise<Record<string, unknown>> {
    return this.httpClient.post<Record<string, unknown>>(
      `${this.base()}/${flaggerId}/test-run`,
      { prompt }
    );
  }
}

/**
 * Notifications Namespace
 *
 * Manages workspace notifications, plus the configuration surfaces for
 * custom notification implementations:
 *
 * - `channels()` — delivery channels (email, webhook)
 * - `triggers()` — tag-routing rules from notifications to channels
 * - `flaggers()` — custom LLM-driven notification flaggers
 *
 * @example
 * ```typescript
 * // List notifications
 * const { docs, pagination } = await client.notifications.list(
 *   { workspaceId: "ws-123" },
 *   { isRead: false, limit: 10 }
 * );
 *
 * // Get unread count
 * const { unread } = await client.notifications.getCounts({ workspaceId: "ws-123" });
 *
 * // Mark as read
 * await client.notifications.markAsRead({ workspaceId: "ws-123", notificationId: "n-456" }, true);
 *
 * // Add a note
 * await client.notifications.notes({ workspaceId: "ws-123", notificationId: "n-456" })
 *   .add("Followed up with customer");
 * ```
 */
export class NotificationsNamespace extends BaseNamespace {
  /**
   * List notifications with filters
   */
  async list(
    params: { workspaceId?: string },
    filters: ListNotificationsFilters = {}
  ): Promise<NotificationsListResponse> {
    const workspaceId = this.getWorkspaceId(params);
    const queryParams: Record<string, string | number | boolean | undefined> = {
      page: filters.page,
      limit: filters.limit,
      isRead: filters.isRead,
      // wire param is `notificationType`
      notificationType: filters.type,
      title: filters.title,
      email: filters.email,
      createdAfter: filters.createdAfter,
      createdBefore: filters.createdBefore,
    };

    // Handle tags array
    if (filters.tags && filters.tags.length > 0) {
      queryParams.tags = filters.tags.join(",");
    }

    return this.httpClient.get<NotificationsListResponse>(
      `/white-label/${workspaceId}/notification`,
      queryParams
    );
  }

  /**
   * Get notification counts
   */
  async getCounts(
    params: { workspaceId?: string },
    filters: Omit<ListNotificationsFilters, "page" | "limit"> = {}
  ): Promise<NotificationCounts> {
    const workspaceId = this.getWorkspaceId(params);
    const { type, tags, ...rest } = filters;
    const queryParams: Record<string, string | number | boolean | undefined> = {
      ...rest,
      notificationType: type,
    };
    if (tags && tags.length > 0) queryParams.tags = tags.join(",");
    return this.httpClient.get<NotificationCounts>(
      `/white-label/${workspaceId}/notification/counts`,
      queryParams
    );
  }

  /**
   * Get a notification by ID
   */
  async get(params: { workspaceId?: string; notificationId: string }): Promise<NotificationDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<NotificationDoc>(
      `/white-label/${workspaceId}/notification/${params.notificationId}`
    );
  }

  /**
   * Mark a notification as read/unread
   */
  async markAsRead(
    params: { workspaceId?: string; notificationId: string },
    isRead: boolean
  ): Promise<NotificationDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.patch<NotificationDoc>(
      `/white-label/${workspaceId}/notification/${params.notificationId}/read`,
      { isRead }
    );
  }

  /**
   * Set tags on a notification
   */
  async setTags(
    params: { workspaceId?: string; notificationId: string },
    tags: string[]
  ): Promise<NotificationDoc> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.put<NotificationDoc>(
      `/white-label/${workspaceId}/notification/${params.notificationId}/tags`,
      { tags }
    );
  }

  /**
   * Get notes sub-namespace for a specific notification
   */
  notes(params: { workspaceId?: string; notificationId: string }): NotesNamespace {
    const workspaceId = this.getWorkspaceId(params);
    return new NotesNamespace(
      this.httpClient,
      this.context,
      workspaceId,
      params.notificationId
    );
  }

  /**
   * Get tag suggestions based on usage
   */
  async getTags(
    params: { workspaceId?: string },
    options: { limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}
  ): Promise<TagSuggestion[]> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<TagSuggestion[]>(
      `/white-label/${workspaceId}/notification/tags`,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Delivery channels sub-namespace (email / webhook destinations)
   */
  channels(params: { workspaceId?: string } = {}): DeliveryChannelsNamespace {
    const workspaceId = this.getWorkspaceId(params);
    return new DeliveryChannelsNamespace(this.httpClient, this.context, workspaceId);
  }

  /**
   * Delivery triggers sub-namespace (tag → channel routing rules)
   */
  triggers(params: { workspaceId?: string } = {}): DeliveryTriggersNamespace {
    const workspaceId = this.getWorkspaceId(params);
    return new DeliveryTriggersNamespace(this.httpClient, this.context, workspaceId);
  }

  /**
   * Custom notification flaggers sub-namespace (LLM-driven custom notifications)
   */
  flaggers(params: { workspaceId?: string } = {}): NotificationFlaggersNamespace {
    const workspaceId = this.getWorkspaceId(params);
    return new NotificationFlaggersNamespace(this.httpClient, this.context, workspaceId);
  }

  /**
   * Create a scoped NotificationsNamespace with a preset workspaceId
   */
  withWorkspace(workspaceId: string): NotificationsNamespace {
    return new NotificationsNamespace(this.httpClient, this.withContext({ workspaceId }));
  }
}
