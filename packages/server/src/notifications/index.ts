/**
 * Notification Client
 *
 * Server-side management of workspace notifications and the configuration
 * surfaces for custom notification implementations:
 *
 * - notifications CRUD (list / counts / get / mark-read / tags / notes)
 * - delivery channels (email, webhook) — where notifications get sent
 * - delivery triggers — tag-matching rules routing notifications to channels
 * - custom notification flaggers — LLM-driven custom notifications
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/notification[-flagger]`) on 2026-06-10.
 */

import { ServerHttpClient } from "../http-client.js";

/** Notification document (wire shape). */
export interface NotificationDoc {
  _id: string;
  whitelabelId?: string;
  notificationType?: string;
  icon?: string;
  title: string;
  details?: Record<string, unknown>;
  isRead: boolean;
  tags: string[];
  notes: Array<{ _id: string; content: string; createdAt: string | number; updatedAt: string | number }>;
  createdAt: string | number;
  updatedAt: string | number;
}

/** Filters for listing notifications. */
export interface ListNotificationsFilters {
  page?: number;
  limit?: number;
  isRead?: boolean;
  tags?: string[];
  /** Sent as `notificationType` on the wire */
  type?: string;
  title?: string;
  email?: string;
  createdAfter?: string;
  createdBefore?: string;
}

/** Paginated notifications list. */
export interface NotificationsListResponse {
  docs: NotificationDoc[];
  pagination: { page: number; limit: number; total: number; pages?: number };
}

/** Webhook retry policy for webhook delivery channels. */
export interface WebhookRetryPolicy {
  maxRetries: number;
  backoffType: "linear" | "exponential";
  initialDelayMs: number;
  maxDelayMs: number;
}

/** Input for creating/updating a delivery channel. */
export type DeliveryChannelInput =
  | { channelName: string; deliveryMethod: "email"; details: { emailAddress: string } }
  | {
      channelName: string;
      deliveryMethod: "webhook";
      details: {
        url: string;
        method: "POST" | "PUT";
        headers: Record<string, string>;
        /** HMAC secret, min 32 chars */
        secret: string;
        retryPolicy: WebhookRetryPolicy;
        timeout: number;
      };
    };

/** Delivery channel document. */
export type DeliveryChannelDoc = DeliveryChannelInput & {
  _id: string;
  target: string;
  verified: boolean;
};

/** A tag-matching rule on a delivery trigger. */
export type DeliveryTriggerRule =
  | { mode: "if-any-tag"; tags: string[]; action: "triggered" | "fail" }
  | { mode: "if-all-tags"; tags: string[]; action: "triggered" | "fail" }
  | { mode: "if-no-tags"; action: "triggered" | "fail" };

/** Input for creating/updating a delivery trigger. */
export interface DeliveryTriggerInput {
  title: string;
  description: string;
  triggerByDefault: boolean;
  rules: DeliveryTriggerRule[];
  channels: string[];
}

/** Delivery trigger document. */
export type DeliveryTriggerDoc = DeliveryTriggerInput & { _id: string; target: string };

/** Input for creating/updating a custom notification flagger. */
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
  flagInput: boolean;
  notifyUser: boolean;
}

/** Custom notification flagger document. */
export type NotificationFlaggerDoc = NotificationFlaggerInput & { _id: string; target: string };

/** Delivery-channel operations. */
export class NotificationChannelsClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/notification/delivery-channel`;
  }

  async create(workspaceId: string, input: DeliveryChannelInput): Promise<DeliveryChannelDoc> {
    return this.httpClient.post<DeliveryChannelDoc>(this.base(workspaceId), input);
  }

  async list(
    workspaceId: string,
    options: { verified?: boolean } = {}
  ): Promise<DeliveryChannelDoc[]> {
    return this.httpClient.get<DeliveryChannelDoc[]>(this.base(workspaceId), {
      verified: options.verified,
    });
  }

  async get(workspaceId: string, channelId: string): Promise<DeliveryChannelDoc> {
    return this.httpClient.get<DeliveryChannelDoc>(`${this.base(workspaceId)}/${channelId}`);
  }

  async update(
    workspaceId: string,
    channelId: string,
    input: DeliveryChannelInput
  ): Promise<DeliveryChannelDoc> {
    return this.httpClient.post<DeliveryChannelDoc>(
      `${this.base(workspaceId)}/${channelId}`,
      input
    );
  }

  /** Send a test notification to a verified channel. */
  async test(workspaceId: string, channelId: string): Promise<{ success: boolean; message: string }> {
    return this.httpClient.post<{ success: boolean; message: string }>(
      `${this.base(workspaceId)}/${channelId}/test`,
      {}
    );
  }

  async regenerateVerification(
    workspaceId: string,
    channelId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.httpClient.post<{ success: boolean; message: string }>(
      `${this.base(workspaceId)}/${channelId}/regenerate-verification`,
      {}
    );
  }

  /** Send a verification email (email channels only). */
  async sendVerificationEmail(
    workspaceId: string,
    channelId: string
  ): Promise<{ success: boolean; message: string; emailAddress?: string }> {
    return this.httpClient.post<{ success: boolean; message: string; emailAddress?: string }>(
      `${this.base(workspaceId)}/${channelId}/send-verification-email`,
      {}
    );
  }

  /** Recent webhook delivery logs (last 100; webhook channels only). */
  async deliveryLogs(
    workspaceId: string,
    channelId: string
  ): Promise<{ logs: Array<Record<string, unknown>> }> {
    return this.httpClient.get<{ logs: Array<Record<string, unknown>> }>(
      `${this.base(workspaceId)}/${channelId}/delivery-logs`
    );
  }

  async delete(workspaceId: string, channelId: string): Promise<DeliveryChannelDoc> {
    return this.httpClient.delete<DeliveryChannelDoc>(`${this.base(workspaceId)}/${channelId}`);
  }
}

/** Delivery-trigger operations. */
export class NotificationTriggersClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/notification/delivery-trigger`;
  }

  async create(workspaceId: string, input: DeliveryTriggerInput): Promise<DeliveryTriggerDoc> {
    return this.httpClient.post<DeliveryTriggerDoc>(this.base(workspaceId), input);
  }

  async list(workspaceId: string): Promise<DeliveryTriggerDoc[]> {
    return this.httpClient.get<DeliveryTriggerDoc[]>(this.base(workspaceId));
  }

  async get(workspaceId: string, triggerId: string): Promise<DeliveryTriggerDoc> {
    return this.httpClient.get<DeliveryTriggerDoc>(`${this.base(workspaceId)}/${triggerId}`);
  }

  async update(
    workspaceId: string,
    triggerId: string,
    input: DeliveryTriggerInput
  ): Promise<DeliveryTriggerDoc> {
    return this.httpClient.put<DeliveryTriggerDoc>(
      `${this.base(workspaceId)}/${triggerId}`,
      input
    );
  }

  async delete(workspaceId: string, triggerId: string): Promise<DeliveryTriggerDoc> {
    return this.httpClient.delete<DeliveryTriggerDoc>(`${this.base(workspaceId)}/${triggerId}`);
  }
}

/** Custom notification flagger operations. */
export class NotificationFlaggersClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/notification-flagger`;
  }

  async create(
    workspaceId: string,
    input: NotificationFlaggerInput
  ): Promise<NotificationFlaggerDoc> {
    return this.httpClient.post<NotificationFlaggerDoc>(this.base(workspaceId), input);
  }

  async list(workspaceId: string): Promise<NotificationFlaggerDoc[]> {
    return this.httpClient.get<NotificationFlaggerDoc[]>(this.base(workspaceId));
  }

  async get(workspaceId: string, flaggerId: string): Promise<NotificationFlaggerDoc> {
    return this.httpClient.get<NotificationFlaggerDoc>(`${this.base(workspaceId)}/${flaggerId}`);
  }

  async update(
    workspaceId: string,
    flaggerId: string,
    input: Partial<NotificationFlaggerInput>
  ): Promise<NotificationFlaggerDoc> {
    return this.httpClient.post<NotificationFlaggerDoc>(
      `${this.base(workspaceId)}/${flaggerId}`,
      input
    );
  }

  async delete(workspaceId: string, flaggerId: string): Promise<NotificationFlaggerDoc> {
    return this.httpClient.delete<NotificationFlaggerDoc>(
      `${this.base(workspaceId)}/${flaggerId}`
    );
  }

  /**
   * Test-run the flagger against a sample prompt. Returns the extracted LLM
   * output. Billed like a normal LLM call.
   */
  async testRun(
    workspaceId: string,
    flaggerId: string,
    prompt: string
  ): Promise<Record<string, unknown>> {
    return this.httpClient.post<Record<string, unknown>>(
      `${this.base(workspaceId)}/${flaggerId}/test-run`,
      { prompt }
    );
  }
}

/**
 * Notification Client
 *
 * @example
 * ```typescript
 * // List unread notifications
 * const { docs } = await divinci.notifications.list("ws-123", { isRead: false });
 *
 * // Custom notification implementation: flagger → trigger → webhook channel
 * const channel = await divinci.notifications.channels.create("ws-123", {
 *   channelName: "Ops",
 *   deliveryMethod: "webhook",
 *   details: { url: "https://ops.example.com/hook", method: "POST", headers: {},
 *     secret: "x".repeat(32),
 *     retryPolicy: { maxRetries: 3, backoffType: "exponential", initialDelayMs: 1000, maxDelayMs: 60000 },
 *     timeout: 10000 },
 * });
 * await divinci.notifications.triggers.create("ws-123", {
 *   title: "Urgent → Ops", description: "", triggerByDefault: false,
 *   rules: [{ mode: "if-any-tag", tags: ["urgent"], action: "triggered" }],
 *   channels: [channel._id],
 * });
 * ```
 */
export class NotificationClient {
  private readonly httpClient: ServerHttpClient;
  /** Delivery channels (email / webhook destinations) */
  public readonly channels: NotificationChannelsClient;
  /** Delivery triggers (tag → channel routing rules) */
  public readonly triggers: NotificationTriggersClient;
  /** Custom notification flaggers (LLM-driven custom notifications) */
  public readonly flaggers: NotificationFlaggersClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
    this.channels = new NotificationChannelsClient(httpClient);
    this.triggers = new NotificationTriggersClient(httpClient);
    this.flaggers = new NotificationFlaggersClient(httpClient);
  }

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/notification`;
  }

  /** List notifications with filters. */
  async list(
    workspaceId: string,
    filters: ListNotificationsFilters = {}
  ): Promise<NotificationsListResponse> {
    const { type, tags, ...rest } = filters;
    const params: Record<string, string | number | boolean | undefined> = {
      ...rest,
      notificationType: type,
    };
    if (tags && tags.length > 0) params.tags = tags.join(",");
    return this.httpClient.get<NotificationsListResponse>(this.base(workspaceId), params);
  }

  /** Notification counts (total + unread). */
  async getCounts(
    workspaceId: string,
    filters: Omit<ListNotificationsFilters, "page" | "limit"> = {}
  ): Promise<{ total: number; unread: number }> {
    const { type, tags, ...rest } = filters;
    const params: Record<string, string | number | boolean | undefined> = {
      ...rest,
      notificationType: type,
    };
    if (tags && tags.length > 0) params.tags = tags.join(",");
    return this.httpClient.get<{ total: number; unread: number }>(
      `${this.base(workspaceId)}/counts`,
      params
    );
  }

  /** Get a notification by id. */
  async get(workspaceId: string, notificationId: string): Promise<NotificationDoc> {
    return this.httpClient.get<NotificationDoc>(
      `${this.base(workspaceId)}/${notificationId}`
    );
  }

  /** Mark a notification read/unread. */
  async markAsRead(
    workspaceId: string,
    notificationId: string,
    isRead: boolean
  ): Promise<NotificationDoc> {
    return this.httpClient.patch<NotificationDoc>(
      `${this.base(workspaceId)}/${notificationId}/read`,
      { isRead }
    );
  }

  /** Replace the tags on a notification. */
  async setTags(
    workspaceId: string,
    notificationId: string,
    tags: string[]
  ): Promise<NotificationDoc> {
    return this.httpClient.put<NotificationDoc>(
      `${this.base(workspaceId)}/${notificationId}/tags`,
      { tags }
    );
  }

  /** Tag suggestions by usage. */
  async getTags(
    workspaceId: string,
    options: { limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}
  ): Promise<Array<{ tagName: string; usageCount: number; lastUsed: string }>> {
    return this.httpClient.get<Array<{ tagName: string; usageCount: number; lastUsed: string }>>(
      `${this.base(workspaceId)}/tags`,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /** Add a note to a notification. */
  async addNote(
    workspaceId: string,
    notificationId: string,
    content: string
  ): Promise<NotificationDoc> {
    return this.httpClient.post<NotificationDoc>(
      `${this.base(workspaceId)}/${notificationId}/notes`,
      { content }
    );
  }

  /** Update a note. */
  async updateNote(
    workspaceId: string,
    notificationId: string,
    noteId: string,
    content: string
  ): Promise<NotificationDoc> {
    return this.httpClient.put<NotificationDoc>(
      `${this.base(workspaceId)}/${notificationId}/notes/${noteId}`,
      { content }
    );
  }

  /** Delete a note. */
  async deleteNote(
    workspaceId: string,
    notificationId: string,
    noteId: string
  ): Promise<NotificationDoc> {
    return this.httpClient.delete<NotificationDoc>(
      `${this.base(workspaceId)}/${notificationId}/notes/${noteId}`
    );
  }
}
