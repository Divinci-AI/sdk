/**
 * Divinci Client
 *
 * Main entry point for the Divinci AI SDK
 */

import type {
  DivinciClientConfig,
  Release,
  ExternalUserConfig,
} from "@divinci-ai/types";
import { HttpClient, SimpleTokenStorage, type TokenStorage } from "./http-client.js";
import { ChatClient } from "./chat/index.js";
import {
  RagNamespace,
  AudioNamespace,
  UserNamespace,
  ApiKeyNamespace,
  BYOKNamespace,
  FineTuneNamespace,
  NotificationsNamespace,
  AnalyticsNamespace,
  MetricsNamespace,
  PhoneUsageNamespace,
  ConnectorsNamespace,
  ExternalToolsNamespace,
  FeedbackNamespace,
  ArenaNamespace,
  StylePatternNamespace,
  HomepageChatNamespace,
  AnonymousChatNamespace,
  FreeChatGateNamespace,
  SiteControlNamespace,
  TermsNamespace,
  ModelEditsNamespace,
  type NamespaceContext,
} from "./namespaces/index.js";
import { WebSocketManager } from "./websocket/index.js";
import { DivinciError, ValidationError } from "./errors.js";

/**
 * Divinci client options
 */
export interface DivinciClientOptions extends DivinciClientConfig {
  /** Custom token storage implementation */
  tokenStorage?: TokenStorage;
}

/**
 * Authentication state
 */
export interface AuthState {
  /** Whether the user is authenticated */
  authenticated: boolean;
  /** User info (if authenticated) */
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
  /** External user config (for API key auth) */
  externalUser?: ExternalUserConfig;
}

/**
 * Divinci Client class
 *
 * @example
 * ```typescript
 * const divinci = new DivinciClient({
 *   releaseId: "your-release-id",
 *   apiKey: "your-api-key", // Optional for authenticated access
 * });
 *
 * // Create a chat
 * const chat = await divinci.chat.create();
 *
 * // Send a message with streaming
 * await divinci.chat.stream(chat.id, "Hello!", {
 *   onChunk: (content) => console.log(content),
 * });
 * ```
 */
export class DivinciClient {
  /** HTTP client for API requests */
  private readonly httpClient: HttpClient;
  /** Client configuration */
  private readonly config: DivinciClientOptions;
  /** Namespace context (workspaceId, releaseId) */
  private readonly namespaceContext: NamespaceContext;
  /** Release data (loaded lazily) */
  private release: Release | null = null;
  /** Chat client instance */
  private chatClient: ChatClient | null = null;
  /** RAG namespace instance */
  private ragNamespace: RagNamespace | null = null;
  /** Audio namespace instance */
  private audioNamespace: AudioNamespace | null = null;
  /** User namespace instance */
  private userNamespace: UserNamespace | null = null;
  /** API Keys namespace instance */
  private apiKeysNamespace: ApiKeyNamespace | null = null;
  /** BYOK namespace instance */
  private byokNamespace: BYOKNamespace | null = null;
  private stylePatternNamespace: StylePatternNamespace | null = null;
  /** Fine-Tune namespace instance */
  private fineTuneNamespace: FineTuneNamespace | null = null;
  /** Notifications namespace instance */
  private notificationsNamespace: NotificationsNamespace | null = null;
  /** Analytics namespace instance */
  private analyticsNamespace: AnalyticsNamespace | null = null;
  /** Metrics namespace instance */
  private metricsNamespace: MetricsNamespace | null = null;
  private phoneUsageNamespace: PhoneUsageNamespace | null = null;
  private connectorsNamespace: ConnectorsNamespace | null = null;
  private externalToolsNamespace: ExternalToolsNamespace | null = null;
  /** Feedback namespace instance (admin-tier read of message feedback) */
  private feedbackNamespace: FeedbackNamespace | null = null;
  /** Arena namespace instance */
  private arenaNamespace: ArenaNamespace | null = null;
  /** Homepage free-chat namespace instance */
  private homepageChatNamespace: HomepageChatNamespace | null = null;
  private anonymousChatNamespace: AnonymousChatNamespace | null = null;
  /** Free-Chat Gate namespace instance (release-configurable email gate). */
  private freeChatGateNamespace: FreeChatGateNamespace | null = null;
  private siteControlNamespace: SiteControlNamespace | null = null;
  /** Terms of Service namespace instance (versioned acceptance gate). */
  private termsNamespace: TermsNamespace | null = null;
  private modelEditsNamespace: ModelEditsNamespace | null = null;
  /** WebSocket manager instance */
  private wsManager: WebSocketManager | null = null;
  /** Token storage for WebSocket auth */
  private readonly tokenStorage: TokenStorage;

  constructor(options: DivinciClientOptions) {
    // Validate required options
    if (!options.releaseId) {
      throw new ValidationError("releaseId is required", {
        code: "VALIDATION_ERROR",
        details: {
          fieldErrors: [
            {
              field: "releaseId",
              message: "Release ID is required",
              code: "required",
            },
          ],
        },
      });
    }

    this.config = {
      baseUrl: "https://api.divinci.app",
      wsBaseUrl: "wss://live.divinci.app",
      timeout: 30000,
      maxRetries: 3,
      debug: false,
      streaming: true,
      ...options,
    };

    // Handle userToken: create SimpleTokenStorage if userToken is provided
    // and no custom tokenStorage is given
    let tokenStorage: TokenStorage | undefined = options.tokenStorage;
    if (options.userToken && !options.tokenStorage) {
      tokenStorage = new SimpleTokenStorage(options.userToken);
    }

    // Store token storage for WebSocket auth
    this.tokenStorage = tokenStorage || new SimpleTokenStorage("");

    this.httpClient = new HttpClient(this.config, tokenStorage);

    // Initialize namespace context
    this.namespaceContext = {
      workspaceId: options.workspaceId,
      releaseId: options.releaseId,
    };
  }

  /**
   * Chat client for messaging operations
   */
  get chat(): ChatClient {
    if (!this.chatClient) {
      this.chatClient = new ChatClient(this.httpClient, this.config.releaseId);
    }
    return this.chatClient;
  }

  /**
   * Homepage free-chat namespace — email-gated, keyless public chat (e.g. the
   * divinci.ai homepage assistant). No API key needed; a verified-email token
   * gates access and the release is pinned server-side.
   *
   * @example
   * ```typescript
   * await divinci.homepageChat.verifyEmail(email, turnstileToken);
   * await divinci.homepageChat.confirmEmail(email, code);
   * const { reply, remaining } = await divinci.homepageChat.send("What is Divinci?");
   * ```
   */
  get homepageChat(): HomepageChatNamespace {
    if (!this.homepageChatNamespace) {
      this.homepageChatNamespace = new HomepageChatNamespace(this.httpClient, this.namespaceContext);
    }
    return this.homepageChatNamespace;
  }

  /**
   * Generic anonymous chat against a release with `allowAnonymousChat: true` —
   * no account, no email gate. The public release-backed chat used by embed /
   * docs-assistant widgets.
   *
   * const { reply } = await divinci.anonymousChat.send("How do I install the SDK?");
   */
  get anonymousChat(): AnonymousChatNamespace {
    if (!this.anonymousChatNamespace) {
      this.anonymousChatNamespace = new AnonymousChatNamespace(this.httpClient, this.namespaceContext);
    }
    return this.anonymousChatNamespace;
  }

  /**
   * Free-Chat Gate namespace (release-configurable email-gated public
   * chat). Supersedes {@link homepageChat} for any whitelabel whose
   * Release has `freeChatGate.mode !== "none"`.
   *
   * @example
   * ```typescript
   * // captcha+otp mode:
   * await divinci.freeChatGate.start({ releaseId, turnstileToken, email });
   * await divinci.freeChatGate.verifyOtp({ email, otpCode });
   * const { reply, remaining } = await divinci.freeChatGate.send("Hi!");
   *
   * // captcha-only mode:
   * const { token } = await divinci.freeChatGate.start({ releaseId, turnstileToken });
   * const { reply } = await divinci.freeChatGate.send("Hi!");
   * ```
   *
   * See strategy/2026-05-29-standardize-free-chat-gate.md for the
   * full design + mode-by-mode UX.
   */
  get freeChatGate(): FreeChatGateNamespace {
    if (!this.freeChatGateNamespace) {
      this.freeChatGateNamespace = new FreeChatGateNamespace(this.httpClient, this.namespaceContext);
    }
    return this.freeChatGateNamespace;
  }

  /**
   * Site Control namespace (v1) — execute the navigation/action directives a
   * deployed assistant emits (`divinci-action` blocks), same-origin. Fetch
   * descriptors with `loadDescriptors(releaseId)` (or `setDescriptors` from
   * `freeChatGate.getConfig().siteActions`), then run each reply through
   * `process(reply)` to strip the block + navigate. v1 ships navigation only;
   * mutations are deferred until confirmation lands.
   *
   * @example
   * ```typescript
   * await divinci.siteControl.loadDescriptors(releaseId);
   * const { reply } = await divinci.freeChatGate.send("take me to pricing");
   * const { cleanedText } = await divinci.siteControl.process(reply); // navigates
   * render(cleanedText);
   * ```
   */
  get siteControl(): SiteControlNamespace {
    if (!this.siteControlNamespace) {
      this.siteControlNamespace = new SiteControlNamespace(this.httpClient, this.namespaceContext);
    }
    return this.siteControlNamespace;
  }

  /**
   * Terms of Service namespace — versioned per-release acceptance gate.
   *
   * When a release's published ToS version changes, message sends fail with
   * a 403 TERMS_NOT_ACCEPTED ({@link TermsNotAcceptedError}) until the new
   * version is accepted.
   *
   * @example
   * ```typescript
   * const gate = await divinci.terms.getForRelease();
   * if (gate.required) {
   *   renderMarkdown(gate.title, gate.content);
   *   await divinci.terms.accept({ tosId: gate.tosId!, version: gate.version! });
   * }
   * ```
   */
  get terms(): TermsNamespace {
    if (!this.termsNamespace) {
      this.termsNamespace = new TermsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.termsNamespace;
  }

  /**
   * Model Edits namespace — activation-level knowledge editing.
   * Browse an entity's associations, suppress or restore one, and revert.
   */
  get modelEdits(): ModelEditsNamespace {
    if (!this.modelEditsNamespace) {
      this.modelEditsNamespace = new ModelEditsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.modelEditsNamespace;
  }

  /**
   * RAG namespace for vector index operations
   *
   * @example
   * ```typescript
   * // Create a vector index
   * const vector = await divinci.rag.vectorIndex.create(
   *   { workspaceId: "ws-123" },
   *   { title: "My Docs", description: "...", vectorIndexTool: "qdrant" }
   * );
   *
   * // List vector indexes
   * const vectors = await divinci.rag.vectorIndex.list({ workspaceId: "ws-123" });
   * ```
   */
  get rag(): RagNamespace {
    if (!this.ragNamespace) {
      this.ragNamespace = new RagNamespace(this.httpClient, this.namespaceContext);
    }
    return this.ragNamespace;
  }

  /**
   * Arena namespace for multi-model comparison operations
   *
   * @example
   * ```typescript
   * // Select a winning variant
   * await divinci.arena.selectChatVariant({
   *   chatId: "chat-123",
   *   messageId: "msg-456",
   *   selectedIndex: 0,
   * });
   *
   * // Get arena results
   * const results = await divinci.arena.getResults({ workspaceId: "ws-123" });
   *
   * // Manage presets
   * const presets = await divinci.arena.presets.list({ workspaceId: "ws-123" });
   * await divinci.arena.presets.activate({ workspaceId: "ws-123", presetId: "p-456" });
   * ```
   */
  get arena(): ArenaNamespace {
    if (!this.arenaNamespace) {
      this.arenaNamespace = new ArenaNamespace(this.httpClient, this.namespaceContext);
    }
    return this.arenaNamespace;
  }

  /**
   * WebSocket manager for real-time connections
   *
   * The SDK handles ticket-based authentication automatically.
   * A short-lived ticket is obtained before each connection for security.
   * Just call connect methods and the auth flow is handled internally.
   *
   * @example
   * ```typescript
   * // Connect to chat transcript updates
   * const chatWs = await divinci.websocket.connectToChat("chat-123");
   * chatWs.onMessage.subscribe((event) => {
   *   console.log("Update:", event.data);
   * });
   *
   * // Connect to workspace transcript
   * const transcriptWs = await divinci.websocket.connectToTranscript("ws-123", "t-456");
   * transcriptWs.onMessage.subscribe((event) => {
   *   console.log("Transcript:", event.data);
   * });
   *
   * // Generic connection
   * const ws = await divinci.websocket.connect("/custom/path");
   * ```
   */
  get websocket(): WebSocketManager {
    if (!this.wsManager) {
      // Derive liveBaseUrl from wsBaseUrl (wss:// -> https://)
      const wsBaseUrl = this.config.wsBaseUrl || "wss://live.divinci.app";
      const liveBaseUrl = wsBaseUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

      this.wsManager = new WebSocketManager(
        {
          wsBaseUrl,
          liveBaseUrl,
          debug: this.config.debug,
        },
        this.tokenStorage
      );
    }
    return this.wsManager;
  }

  /**
   * Audio namespace for transcription and voiceprint operations
   *
   * @example
   * ```typescript
   * // Upload audio file
   * const transcript = await divinci.audio.upload(
   *   { workspaceId: "ws-123" },
   *   { mediaFile: file, title: "Recording" }
   * );
   *
   * // List voiceprints
   * const voiceprints = await divinci.audio.voiceprints.list({ workspaceId: "ws-123" });
   * ```
   */
  get audio(): AudioNamespace {
    if (!this.audioNamespace) {
      this.audioNamespace = new AudioNamespace(this.httpClient, this.namespaceContext);
    }
    return this.audioNamespace;
  }

  /**
   * User namespace for account operations
   *
   * @example
   * ```typescript
   * // Get balance
   * const balance = await divinci.user.balance.get();
   *
   * // Update audio preferences
   * await divinci.user.preferences.audio.update({ defaultTranscriberTool: "whisper" });
   * ```
   */
  get user(): UserNamespace {
    if (!this.userNamespace) {
      this.userNamespace = new UserNamespace(this.httpClient, this.namespaceContext);
    }
    return this.userNamespace;
  }

  /**
   * API Keys namespace for managing workspace API keys
   *
   * @example
   * ```typescript
   * // Create API key
   * const key = await divinci.apiKeys.create(
   *   { workspaceId: "ws-123" },
   *   { name: "Production", permissions: { chat: true } }
   * );
   *
   * // Rotate key
   * const { newSecretKey } = await divinci.apiKeys.rotate({
   *   workspaceId: "ws-123",
   *   keyId: key._id
   * });
   * ```
   */
  get apiKeys(): ApiKeyNamespace {
    if (!this.apiKeysNamespace) {
      this.apiKeysNamespace = new ApiKeyNamespace(this.httpClient, this.namespaceContext);
    }
    return this.apiKeysNamespace;
  }

  /**
   * BYOK namespace for managing provider credentials (Neo4j, OpenAI, etc.)
   *
   * @example
   * ```typescript
   * // Create a Neo4j BYOK
   * const byok = await divinci.byok.create(
   *   { workspaceId: "ws-123" },
   *   {
   *     name: "Neo4j Aura (GCP)",
   *     providerId: "NEO4J_HYBRID",
   *     auth: { uri: "neo4j+s://...", username: "neo4j", password: "...", database: "neo4j" }
   *   }
   * );
   *
   * // Rotate credentials in place — RAG vectors continue to reference the same id
   * await divinci.byok.rotate(
   *   { workspaceId: "ws-123", keyId: byok._id },
   *   { auth: { uri: "neo4j+s://new-host...", ... } }
   * );
   * ```
   */
  get byok(): BYOKNamespace {
    if (!this.byokNamespace) {
      this.byokNamespace = new BYOKNamespace(this.httpClient, this.namespaceContext);
    }
    return this.byokNamespace;
  }

  /**
   * Style-pattern namespace for managing per-workspace rewrite rules.
   *
   * @example
   * ```typescript
   * // List enabled rules:
   * const { patterns } = await divinci.stylePattern.listRules({
   *   workspaceId: "ws-123", enabled: true,
   * });
   *
   * // Dry-run a sample against rules:
   * const result = await divinci.stylePattern.testRewrite(
   *   { workspaceId: "ws-123" },
   *   { response: "As Dr. Fuhrman, I recommend..." },
   * );
   *
   * // Approve a mined proposal:
   * await divinci.stylePattern.approveProposed({
   *   workspaceId: "ws-123", proposedId: "abc",
   * });
   * ```
   */
  get stylePattern(): StylePatternNamespace {
    if (!this.stylePatternNamespace) {
      this.stylePatternNamespace = new StylePatternNamespace(this.httpClient, this.namespaceContext);
    }
    return this.stylePatternNamespace;
  }

  /**
   * Fine-Tune namespace for training custom models
   *
   * @example
   * ```typescript
   * // Upload training file
   * const file = await divinci.fineTune.files.upload(
   *   { workspaceId: "ws-123" },
   *   { file: trainingData, name: "training.jsonl" }
   * );
   *
   * // Create fine-tune job
   * const job = await divinci.fineTune.create(
   *   { workspaceId: "ws-123" },
   *   { title: "Support Model", finetuneTool: "openai", trainingFileIds: [file._id] }
   * );
   * ```
   */
  get fineTune(): FineTuneNamespace {
    if (!this.fineTuneNamespace) {
      this.fineTuneNamespace = new FineTuneNamespace(this.httpClient, this.namespaceContext);
    }
    return this.fineTuneNamespace;
  }

  /**
   * Notifications namespace for workspace notifications
   *
   * @example
   * ```typescript
   * // List unread notifications
   * const { docs } = await divinci.notifications.list(
   *   { workspaceId: "ws-123" },
   *   { isRead: false }
   * );
   *
   * // Mark as read
   * await divinci.notifications.markAsRead(
   *   { workspaceId: "ws-123", notificationId: "n-456" },
   *   true
   * );
   * ```
   */
  get notifications(): NotificationsNamespace {
    if (!this.notificationsNamespace) {
      this.notificationsNamespace = new NotificationsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.notificationsNamespace;
  }

  /**
   * Analytics namespace — product analytics for AI releases.
   *
   * @example
   * ```typescript
   * const { current, previous } = await divinci.analytics.metrics(
   *   { timeRange: "7d" }, { workspaceId: "ws-123" }
   * );
   *
   * // Record custom analytics events from your own UI
   * await divinci.analytics.trackEvents(
   *   [{ event: "product_click", productId: "sku-1" }],
   *   { workspaceId: "ws-123" }
   * );
   * ```
   */
  get analytics(): AnalyticsNamespace {
    if (!this.analyticsNamespace) {
      this.analyticsNamespace = new AnalyticsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.analyticsNamespace;
  }

  /**
   * Metrics namespace — pipeline telemetry + custom alert configurations.
   *
   * @example
   * ```typescript
   * const result = await divinci.metrics.pipeline("pipe-1", { timeRange: "24h" }, { workspaceId: "ws-123" });
   *
   * // Custom alerting → webhook
   * await divinci.metrics.setAlertConfig("pipe-1", {
   *   nodeType: "embedding",
   *   metric: "errorRate",
   *   thresholds: { warning: 0.05, critical: 0.2 },
   *   notificationChannels: [{ type: "webhook", config: { url: "https://ops.example.com/alert" } }],
   * }, { workspaceId: "ws-123" });
   * ```
   */
  get metrics(): MetricsNamespace {
    if (!this.metricsNamespace) {
      this.metricsNamespace = new MetricsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.metricsNamespace;
  }

  /**
   * Phone Usage namespace — unbilled voice-call (LiveKit) and SMS/MMS
   * (Twilio) usage for a workspace, at cost.
   *
   * @example
   * ```typescript
   * const voice = await divinci.phoneUsage.voice({ workspaceId: "ws-123" });
   * const sms = await divinci.phoneUsage.sms({ workspaceId: "ws-123" });
   * ```
   */
  get phoneUsage(): PhoneUsageNamespace {
    if (!this.phoneUsageNamespace) {
      this.phoneUsageNamespace = new PhoneUsageNamespace(this.httpClient, this.namespaceContext);
    }
    return this.phoneUsageNamespace;
  }

  /**
   * Connectors namespace — manage data connectors; today focused on web_crawl
   * (crawl a website/sitemap into a RAG vector, optionally recurring).
   *
   * @example
   * ```typescript
   * await divinci.connectors.webCrawlStart({
   *   mode: "crawl",
   *   rootUrl: "https://docs.example.com",
   *   targetVectorId: "vec-456",
   *   runSitemap: true,
   *   autoSync: true,
   *   swapOnSuccess: true, // required when the vector backs a published release
   * }, { workspaceId: "ws-123" });
   * ```
   */
  get connectors(): ConnectorsNamespace {
    if (!this.connectorsNamespace) {
      this.connectorsNamespace = new ConnectorsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.connectorsNamespace;
  }

  /**
   * External tools namespace — register document parsers this workspace owns,
   * which the ingestion path calls instead of a built-in chunker.
   *
   * The endpoint receives raw customer documents, so register only one the
   * workspace owner has approved.
   *
   * @example
   * ```typescript
   * const tool = await divinci.externalTools.create({
   *   toolType: "RAG/Chunker",
   *   slug: "acme-parser",
   *   title: "Acme Parser",
   *   endpointUrl: "https://parse.acme.com/v1/chunks",
   *   authType: "bearer",
   *   authSecret: process.env.ACME_KEY,
   * });
   * // tool.toolId -> "ext:<workspace>:acme-parser", the id RAG documents store
   * ```
   */
  get externalTools(): ExternalToolsNamespace {
    if (!this.externalToolsNamespace) {
      this.externalToolsNamespace = new ExternalToolsNamespace(this.httpClient, this.namespaceContext);
    }
    return this.externalToolsNamespace;
  }

  /**
   * Feedback namespace — admin-tier READ of the message feedback a whitelabel's
   * releases received (consumers submit it via `client.chat.submitFeedback`).
   *
   * @example
   * ```typescript
   * const fb = divinci.feedback.withWorkspace("ws-123");
   * const { docs } = await fb.list({ sentiment: "negative", hasText: true });
   * const stats = await fb.stats();
   * ```
   */
  get feedback(): FeedbackNamespace {
    if (!this.feedbackNamespace) {
      this.feedbackNamespace = new FeedbackNamespace(this.httpClient, this.namespaceContext);
    }
    return this.feedbackNamespace;
  }

  /**
   * Get the current release configuration
   */
  async getRelease(): Promise<Release> {
    if (!this.release) {
      // NOTE: the live endpoint is the ux route `/white-label-release/:id`
      // (the previous `/api/v1/whitelabel-releases/:id` path 404s — verified
      // against staging by tests/integration). The wire document is
      // Mongo-shaped (`_id`); normalize the declared `id` field additively.
      const raw = await this.httpClient.get<Release & { _id?: string; title?: string }>(
        `/white-label-release/${this.config.releaseId}`
      );
      // Normalize: _id → id, title → name (backwards-compat alias)
      const withId: Release = raw.id ? raw : { ...raw, id: raw._id as string };
      this.release = withId.name ? withId : { ...withId, name: withId.title };
    }
    return this.release;
  }

  /**
   * Refresh release configuration from server
   */
  async refreshRelease(): Promise<Release> {
    this.release = null;
    return this.getRelease();
  }

  /**
   * Set authentication token
   */
  async setToken(token: string, expiresAt?: number): Promise<void> {
    await this.httpClient.setToken(token, expiresAt);
  }

  /**
   * Set refresh token
   */
  async setRefreshToken(token: string): Promise<void> {
    await this.httpClient.setRefreshToken(token);
  }

  /**
   * Clear authentication
   */
  async logout(): Promise<void> {
    await this.httpClient.clearTokens();
  }

  /**
   * Check if client is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.httpClient.getToken();
    return token !== null;
  }

  /**
   * Validate API key
   */
  async validateApiKey(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      await this.httpClient.post("/api/v1/auth/validate-key", {
        apiKey: this.config.apiKey,
      });
      return true;
    } catch (error) {
      if (error instanceof DivinciError && error.status === 401) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Configure external user for API key authentication
   */
  setExternalUser(user: ExternalUserConfig): void {
    this.config.externalUser = user;
  }

  /**
   * Create a new client instance with workspace context
   *
   * This allows you to make workspace-scoped calls without passing workspaceId each time.
   *
   * @example
   * ```typescript
   * const workspaceSdk = divinci.withWorkspace("ws-123");
   *
   * // Now workspaceId is inherited automatically
   * const vectors = await workspaceSdk.rag.vectorIndex.list();
   * const vector = await workspaceSdk.rag.vectorIndex.create(
   *   {},  // workspaceId inherited
   *   { title: "My Docs", description: "...", vectorIndexTool: "qdrant" }
   * );
   * ```
   */
  withWorkspace(workspaceId: string): DivinciClient {
    return new DivinciClient({
      ...this.config,
      workspaceId,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<DivinciClientOptions> {
    return { ...this.config };
  }

  /**
   * Get the HTTP client (for advanced use cases)
   */
  getHttpClient(): HttpClient {
    return this.httpClient;
  }
}

/**
 * Create a Divinci client instance
 *
 * @example
 * ```typescript
 * const divinci = createClient({
 *   releaseId: "your-release-id",
 * });
 * ```
 */
export function createClient(options: DivinciClientOptions): DivinciClient {
  return new DivinciClient(options);
}
