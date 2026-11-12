/**
 * NotificationsNamespace tests
 *
 * Tests for notifications, notes, delivery channels, delivery triggers, and
 * custom notification flaggers. Paths/verbs encode the VERIFIED wire truth
 * (public-api whitelabel router: /white-label/:id/notification — singular).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationsNamespace,
  NotesNamespace,
  DeliveryChannelsNamespace,
  DeliveryTriggersNamespace,
  NotificationFlaggersNamespace,
  type NotificationDoc,
  type NotificationsListResponse,
  type NotificationCounts,
  type TagSuggestion,
  type DeliveryChannelInput,
  type DeliveryTriggerInput,
  type NotificationFlaggerInput,
} from "../../src/namespaces/notifications/index.js";
import type { HttpClient } from "../../src/http-client.js";

// Mock HttpClient
function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    postFormData: vi.fn(),
    getToken: vi.fn(),
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearTokens: vi.fn(),
  } as unknown as HttpClient;
}

// Sample data
const sampleNotification: NotificationDoc = {
  _id: "notif_123",
  whitelabelId: "ws_456",
  notificationType: "audio_complete",
  icon: "🎙️",
  title: "Transcription Complete",
  details: { fileName: "call.mp3" },
  isRead: false,
  tags: ["audio", "important"],
  notes: [
    {
      _id: "note_1",
      content: "Reviewed and approved",
      createdAt: 1704153600000,
      updatedAt: 1704153600000,
    },
  ],
  resourceType: "audio",
  resourceId: "audio_789",
  createdAt: 1704067200000,
  updatedAt: 1704067200000,
};

const sampleListResponse: NotificationsListResponse = {
  docs: [sampleNotification],
  pagination: {
    page: 1,
    limit: 10,
    total: 1,
    pages: 1,
  },
};

const sampleCounts: NotificationCounts = {
  total: 25,
  unread: 10,
};

const sampleTagSuggestion: TagSuggestion = {
  tagName: "important",
  usageCount: 15,
  lastUsed: "2024-01-15T00:00:00Z",
};

describe("NotificationsNamespace", () => {
  let mockHttpClient: HttpClient;
  let notificationsNamespace: NotificationsNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    notificationsNamespace = new NotificationsNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should GET notifications with filters (type maps to notificationType)", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleListResponse);

      await notificationsNamespace.list(
        { workspaceId: "ws-123" },
        { isRead: false, type: "audio_complete" }
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/notification",
        expect.objectContaining({
          isRead: false,
          notificationType: "audio_complete",
        })
      );
    });

    it("should handle pagination params", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleListResponse);

      await notificationsNamespace.list(
        { workspaceId: "ws-123" },
        { page: 2, limit: 20 }
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          page: 2,
          limit: 20,
        })
      );
    });

    it("should handle isRead filter", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleListResponse);

      await notificationsNamespace.list(
        { workspaceId: "ws-123" },
        { isRead: true }
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          isRead: true,
        })
      );
    });

    it("should handle tags array", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleListResponse);

      await notificationsNamespace.list(
        { workspaceId: "ws-123" },
        { tags: ["audio", "important"] }
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tags: "audio,important",
        })
      );
    });

    it("should return NotificationsListResponse", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleListResponse);

      const result = await notificationsNamespace.list(
        { workspaceId: "ws-123" },
        {}
      );

      expect(result.docs).toBeDefined();
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
    });
  });

  describe("getCounts", () => {
    it("should GET notification counts", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleCounts);

      await notificationsNamespace.getCounts({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/counts",
        expect.any(Object)
      );
    });

    it("should map type filter to notificationType", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleCounts);

      await notificationsNamespace.getCounts(
        { workspaceId: "ws-123" },
        { type: "system", tags: ["a", "b"] }
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ notificationType: "system", tags: "a,b" })
      );
    });

    it("should return NotificationCounts", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleCounts);

      const result = await notificationsNamespace.getCounts({
        workspaceId: "ws-123",
      });

      expect(result).toEqual(sampleCounts);
    });
  });

  describe("get", () => {
    it("should GET single notification", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleNotification);

      await notificationsNamespace.get({
        workspaceId: "ws-123",
        notificationId: "notif-456",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456"
      );
    });
  });

  describe("markAsRead", () => {
    it("should PATCH the /read route with isRead true", async () => {
      vi.mocked(mockHttpClient.patch).mockResolvedValue({
        ...sampleNotification,
        isRead: true,
      });

      await notificationsNamespace.markAsRead(
        { workspaceId: "ws-123", notificationId: "notif-456" },
        true
      );

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456/read",
        { isRead: true }
      );
    });

    it("should PATCH the /read route with isRead false", async () => {
      vi.mocked(mockHttpClient.patch).mockResolvedValue(sampleNotification);

      await notificationsNamespace.markAsRead(
        { workspaceId: "ws-123", notificationId: "notif-456" },
        false
      );

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456/read",
        { isRead: false }
      );
    });
  });

  describe("setTags", () => {
    it("should PUT the /tags route", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValue({
        ...sampleNotification,
        tags: ["new-tag"],
      });

      await notificationsNamespace.setTags(
        { workspaceId: "ws-123", notificationId: "notif-456" },
        ["new-tag", "another"]
      );

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456/tags",
        { tags: ["new-tag", "another"] }
      );
    });

    it("should allow empty tags array", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValue({
        ...sampleNotification,
        tags: [],
      });

      await notificationsNamespace.setTags(
        { workspaceId: "ws-123", notificationId: "notif-456" },
        []
      );

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        expect.any(String),
        { tags: [] }
      );
    });
  });

  describe("notes", () => {
    it("should return NotesNamespace for notification", () => {
      const notes = notificationsNamespace.notes({
        workspaceId: "ws-123",
        notificationId: "notif-456",
      });

      expect(notes).toBeInstanceOf(NotesNamespace);
    });
  });

  describe("getTags", () => {
    it("should GET tag suggestions", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleTagSuggestion]);

      await notificationsNamespace.getTags({ workspaceId: "ws-123" });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/tags",
        {}
      );
    });

    it("should accept options", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleTagSuggestion]);

      await notificationsNamespace.getTags(
        { workspaceId: "ws-123" },
        { limit: 10, sortBy: "usageCount", sortOrder: "desc" }
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        { limit: 10, sortBy: "usageCount", sortOrder: "desc" }
      );
    });
  });

  describe("sub-namespace accessors", () => {
    it("channels() returns DeliveryChannelsNamespace", () => {
      const channels = notificationsNamespace.channels({ workspaceId: "ws-123" });
      expect(channels).toBeInstanceOf(DeliveryChannelsNamespace);
    });

    it("triggers() returns DeliveryTriggersNamespace", () => {
      const triggers = notificationsNamespace.triggers({ workspaceId: "ws-123" });
      expect(triggers).toBeInstanceOf(DeliveryTriggersNamespace);
    });

    it("flaggers() returns NotificationFlaggersNamespace", () => {
      const flaggers = notificationsNamespace.flaggers({ workspaceId: "ws-123" });
      expect(flaggers).toBeInstanceOf(NotificationFlaggersNamespace);
    });
  });

  describe("withWorkspace", () => {
    it("should return scoped namespace", () => {
      const scoped = notificationsNamespace.withWorkspace("ws-123");

      expect(scoped).toBeInstanceOf(NotificationsNamespace);
      expect(scoped).not.toBe(notificationsNamespace);
    });

    it("should inherit workspaceId for operations", async () => {
      const scoped = notificationsNamespace.withWorkspace("ws-123");
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleListResponse);

      await scoped.list({}, {});

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/white-label/ws-123/notification",
        expect.any(Object)
      );
    });
  });
});

describe("NotesNamespace", () => {
  let mockHttpClient: HttpClient;
  let notesNamespace: NotesNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    notesNamespace = new NotesNamespace(
      mockHttpClient,
      {},
      "ws-123",
      "notif-456"
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("add", () => {
    it("should POST note content", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleNotification);

      await notesNamespace.add("This is a new note");

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456/notes",
        { content: "This is a new note" }
      );
    });
  });

  describe("update", () => {
    it("should PUT note", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValue(sampleNotification);

      await notesNamespace.update("note-789", "Updated content");

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456/notes/note-789",
        { content: "Updated content" }
      );
    });
  });

  describe("delete", () => {
    it("should DELETE note", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(sampleNotification);

      await notesNamespace.delete("note-789");

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/white-label/ws-123/notification/notif-456/notes/note-789"
      );
    });
  });
});

describe("DeliveryChannelsNamespace", () => {
  let mockHttpClient: HttpClient;
  let channels: DeliveryChannelsNamespace;

  const webhookInput: DeliveryChannelInput = {
    channelName: "Ops webhook",
    deliveryMethod: "webhook",
    details: {
      url: "https://ops.example.com/hook",
      method: "POST",
      headers: {},
      secret: "s".repeat(32),
      retryPolicy: {
        maxRetries: 3,
        backoffType: "exponential",
        initialDelayMs: 1000,
        maxDelayMs: 60000,
      },
      timeout: 10000,
    },
  };

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    channels = new DeliveryChannelsNamespace(mockHttpClient, {}, "ws-123");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("create() POSTs the channel", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ _id: "ch-1", ...webhookInput });

    await channels.create(webhookInput);

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel",
      webhookInput
    );
  });

  it("list() GETs with verified filter", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue([]);

    await channels.list({ verified: true });

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel",
      { verified: true }
    );
  });

  it("get() GETs a single channel", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ _id: "ch-1" });

    await channels.get("ch-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1"
    );
  });

  it("update() POSTs to the channel id", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ _id: "ch-1" });

    await channels.update("ch-1", webhookInput);

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1",
      webhookInput
    );
  });

  it("test() POSTs to /test", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ success: true, message: "sent" });

    await channels.test("ch-1");

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1/test",
      {}
    );
  });

  it("regenerateVerification() POSTs to /regenerate-verification", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ success: true, message: "ok" });

    await channels.regenerateVerification("ch-1");

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1/regenerate-verification",
      {}
    );
  });

  it("sendVerificationEmail() POSTs to /send-verification-email", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ success: true, message: "ok" });

    await channels.sendVerificationEmail("ch-1");

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1/send-verification-email",
      {}
    );
  });

  it("deliveryLogs() GETs /delivery-logs", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ logs: [] });

    await channels.deliveryLogs("ch-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1/delivery-logs"
    );
  });

  it("delete() DELETEs the channel", async () => {
    vi.mocked(mockHttpClient.delete).mockResolvedValue({ _id: "ch-1" });

    await channels.delete("ch-1");

    expect(mockHttpClient.delete).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-channel/ch-1"
    );
  });
});

describe("DeliveryTriggersNamespace", () => {
  let mockHttpClient: HttpClient;
  let triggers: DeliveryTriggersNamespace;

  const triggerInput: DeliveryTriggerInput = {
    title: "Escalations",
    description: "Urgent tags to ops",
    triggerByDefault: false,
    rules: [{ mode: "if-any-tag", tags: ["urgent"], action: "triggered" }],
    channels: ["ch-1"],
  };

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    triggers = new DeliveryTriggersNamespace(mockHttpClient, {}, "ws-123");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("create() POSTs the trigger", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ _id: "t-1", ...triggerInput });

    await triggers.create(triggerInput);

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-trigger",
      triggerInput
    );
  });

  it("list() GETs all triggers", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue([]);

    await triggers.list();

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-trigger"
    );
  });

  it("get() GETs a single trigger", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ _id: "t-1" });

    await triggers.get("t-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-trigger/t-1"
    );
  });

  it("update() PUTs the trigger", async () => {
    vi.mocked(mockHttpClient.put).mockResolvedValue({ _id: "t-1" });

    await triggers.update("t-1", triggerInput);

    expect(mockHttpClient.put).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-trigger/t-1",
      triggerInput
    );
  });

  it("delete() DELETEs the trigger", async () => {
    vi.mocked(mockHttpClient.delete).mockResolvedValue({ _id: "t-1" });

    await triggers.delete("t-1");

    expect(mockHttpClient.delete).toHaveBeenCalledWith(
      "/white-label/ws-123/notification/delivery-trigger/t-1"
    );
  });
});

describe("NotificationFlaggersNamespace", () => {
  let mockHttpClient: HttpClient;
  let flaggers: NotificationFlaggersNamespace;

  const flaggerInput: NotificationFlaggerInput = {
    title: "Refund detector",
    notificationIcon: "💸",
    notificationMessage: "A user asked about refunds",
    notificationTags: ["refund", "urgent"],
    assistant: "gemini-3-5-flash",
    prefix: "Does this message ask for a refund?",
    outputKeys: ["flagged"],
    flagInput: true,
    notifyUser: false,
  };

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    flaggers = new NotificationFlaggersNamespace(mockHttpClient, {}, "ws-123");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("create() POSTs the flagger", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ _id: "f-1", ...flaggerInput });

    await flaggers.create(flaggerInput);

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification-flagger",
      flaggerInput
    );
  });

  it("list() GETs all flaggers", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue([]);

    await flaggers.list();

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification-flagger"
    );
  });

  it("get() GETs a single flagger", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({ _id: "f-1" });

    await flaggers.get("f-1");

    expect(mockHttpClient.get).toHaveBeenCalledWith(
      "/white-label/ws-123/notification-flagger/f-1"
    );
  });

  it("update() POSTs to the flagger id (simpleOwnedCrud convention)", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ _id: "f-1" });

    await flaggers.update("f-1", { title: "Renamed" });

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification-flagger/f-1",
      { title: "Renamed" }
    );
  });

  it("delete() DELETEs the flagger", async () => {
    vi.mocked(mockHttpClient.delete).mockResolvedValue({ _id: "f-1" });

    await flaggers.delete("f-1");

    expect(mockHttpClient.delete).toHaveBeenCalledWith(
      "/white-label/ws-123/notification-flagger/f-1"
    );
  });

  it("testRun() POSTs the sample prompt to /test-run", async () => {
    vi.mocked(mockHttpClient.post).mockResolvedValue({ flagged: true });

    const result = await flaggers.testRun("f-1", "I want my money back!");

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      "/white-label/ws-123/notification-flagger/f-1/test-run",
      { prompt: "I want my money back!" }
    );
    expect(result).toEqual({ flagged: true });
  });
});
