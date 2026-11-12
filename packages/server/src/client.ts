/**
 * Divinci Server Client
 *
 * Main entry point for the Divinci AI Server SDK
 */

import type { DivinciServerConfig } from "@divinci-ai/types";
import { ServerHttpClient } from "./http-client.js";
import { WorkspaceClient } from "./workspaces/index.js";
import { ReleaseClient } from "./releases/index.js";
import { TermsClient } from "./terms/index.js";
import { ModelEditsClient } from "./model-edits/index.js";
import { SkillsClient } from "./skills/index.js";
import { AiChatsClient } from "./ai-chats/index.js";
import { McpServersClient } from "./mcp-servers/index.js";
import { RagClient } from "./rag/index.js";
import { ApiKeyClient } from "./api-keys/index.js";
import { BYOKClient } from "./byok/index.js";
import { HermesAgentsClient } from "./hermes-agents/index.js";
import { X402Client } from "./x402/index.js";
import { ArenaClient } from "./arena/index.js";
import { TranscriptClient } from "./transcripts/index.js";
import { AudioClient } from "./audio/index.js";
import { FineTuneClient } from "./fine-tune/index.js";
import { ConfigClient } from "./config/index.js";
import { GroupClient } from "./groups/index.js";
import { PermissionClient } from "./permissions/index.js";
import { TrainingDataClient } from "./training-data/index.js";
import { QAClient } from "./qa/index.js";
import { MetaHarnessClient } from "./meta-harness/index.js";
import { NotificationClient } from "./notifications/index.js";
import { AnalyticsClient } from "./analytics/index.js";
import { MetricsClient } from "./metrics/index.js";
import { PhoneUsageClient } from "./phone-usage/index.js";
import { ConnectorsClient } from "./connectors/index.js";
import { ExternalToolsClient } from "./external-tools/index.js";
import { UsageClient } from "./usage/index.js";
import { FeedbackClient } from "./feedback/index.js";
import { SpendGuardClient } from "./services/client.js";
import { RedTeamClient } from "./red-team/index.js";

/**
 * Divinci Server client options
 */
export interface DivinciServerOptions extends DivinciServerConfig {
  /** Default workspace ID for operations */
  defaultWorkspaceId?: string;
}

/**
 * Divinci Server Client class
 *
 * @example
 * ```typescript
 * const divinci = new DivinciServer({
 *   apiKey: process.env.DIVINCI_API_KEY!,
 *   defaultWorkspaceId: "workspace-id",
 * });
 *
 * // List releases
 * const releases = await divinci.releases.list("workspace-id");
 *
 * // Upload document to RAG
 * const doc = await divinci.rag.uploadDocument(
 *   "workspace-id",
 *   "collection-id",
 *   fileBuffer,
 *   "document.pdf"
 * );
 *
 * // Search RAG
 * const results = await divinci.rag.search(
 *   "workspace-id",
 *   "collection-id",
 *   "What is the return policy?"
 * );
 * ```
 */
export class DivinciServer {
  /** HTTP client for API requests */
  private readonly httpClient: ServerHttpClient;
  /** Client configuration */
  private readonly _config: DivinciServerOptions;
  /** Workspace client */
  private workspaceClient: WorkspaceClient | null = null;
  /** Release client */
  private releaseClient: ReleaseClient | null = null;
  private termsClient: TermsClient | null = null;
  private modelEditsClient: ModelEditsClient | null = null;
  private skillsClient: SkillsClient | null = null;
  private aiChatsClient: AiChatsClient | null = null;
  private mcpServersClient: McpServersClient | null = null;
  /** RAG client */
  private ragClient: RagClient | null = null;
  /** API Key client */
  private apiKeyClient: ApiKeyClient | null = null;
  /** BYOK (provider credentials) client */
  private byokClient: BYOKClient | null = null;
  private hermesAgentsClient: HermesAgentsClient | null = null;
  /** x402 payment client */
  private x402Client: X402Client | null = null;
  /** Arena client */
  private arenaClient: ArenaClient | null = null;
  /** Transcript client */
  private transcriptClient: TranscriptClient | null = null;
  /** Audio client */
  private audioClient: AudioClient | null = null;
  /** Fine-tune client */
  private fineTuneClient: FineTuneClient | null = null;
  /** Config client */
  private configClient: ConfigClient | null = null;
  /** Group client */
  private groupClient: GroupClient | null = null;
  /** Permission client */
  private permissionClient: PermissionClient | null = null;
  /** Training data client */
  private trainingDataClient: TrainingDataClient | null = null;
  /** QA client */
  private qaClient: QAClient | null = null;
  /** Meta-harness client (orchestration loop / proposals) */
  private metaHarnessClient: MetaHarnessClient | null = null;
  /** Notification client (notifications + channels + triggers + flaggers) */
  private notificationClient: NotificationClient | null = null;
  /** Analytics client (product analytics for AI releases) */
  private analyticsClient: AnalyticsClient | null = null;
  /** Metrics client (pipeline telemetry + custom alert configs) */
  private metricsClient: MetricsClient | null = null;
  private phoneUsageClient: PhoneUsageClient | null = null;
  private connectorsClient: ConnectorsClient | null = null;
  private externalToolsClient: ExternalToolsClient | null = null;
  /** Usage client (API-key usage stats + billing reports) */
  private usageClient: UsageClient | null = null;
  /** Feedback client (admin-tier read of message feedback) */
  private feedbackClient: FeedbackClient | null = null;
  /** Spend Guard client (cost tracking, budget enforcement, alerting) */
  private spendGuardClient: SpendGuardClient | null = null;
  /** Red-team client (deployed-release adversarial probes) */
  private redTeamClient: RedTeamClient | null = null;

  constructor(options: DivinciServerOptions) {
    if (!options.apiKey && !options.accessToken) {
      throw new Error("API key or access token is required for server SDK");
    }

    this._config = {
      baseUrl: "https://api.divinci.app",
      timeout: 30000,
      maxRetries: 3,
      debug: false,
      ...options,
    };

    this.httpClient = new ServerHttpClient(this._config);

    // Wire x402 auto-pay: when enabled with a wallet, register a hook so any
    // request that 402s is paid + retried transparently. Created eagerly here
    // (not lazily via the getter) because the request path that triggers a 402
    // — e.g. chat — may never touch the `x402` getter.
    if (this._config.x402?.autoPayment && this._config.x402?.wallet) {
      this.httpClient.setX402PayHook((details) => this.x402.resolvePaymentHeader(details));
    }
  }

  /**
   * Workspace management client
   */
  get workspaces(): WorkspaceClient {
    if (!this.workspaceClient) {
      this.workspaceClient = new WorkspaceClient(this.httpClient);
    }
    return this.workspaceClient;
  }

  /**
   * Release management client
   */
  get releases(): ReleaseClient {
    if (!this.releaseClient) {
      this.releaseClient = new ReleaseClient(this.httpClient);
    }
    return this.releaseClient;
  }

  /**
   * Terms of Service admin client (versioned ToS / disclaimer documents)
   */
  get terms(): TermsClient {
    if (!this.termsClient) {
      this.termsClient = new TermsClient(this.httpClient);
    }
    return this.termsClient;
  }

  /**
   * Model Edits — activation-level knowledge editing. Browse an entity's
   * associations, suppress or restore one, and revert.
   */
  get modelEdits(): ModelEditsClient {
    if (!this.modelEditsClient) {
      this.modelEditsClient = new ModelEditsClient(
        this.httpClient,
        this._config.defaultWorkspaceId
      );
    }
    return this.modelEditsClient;
  }

  /** Skills catalog + the workspace's configured skill instances (read; P1). */
  get skills(): SkillsClient {
    if (!this.skillsClient) {
      this.skillsClient = new SkillsClient(this.httpClient);
    }
    return this.skillsClient;
  }

  /** User-owned AIChats (OAuth/accessToken surface) — e.g. message emoji reactions. */
  get aiChats(): AiChatsClient {
    if (!this.aiChatsClient) {
      this.aiChatsClient = new AiChatsClient(this.httpClient);
    }
    return this.aiChatsClient;
  }

  /** The workspace's external MCP servers (Phase 1 — management/CRUD). */
  get mcpServers(): McpServersClient {
    if (!this.mcpServersClient) {
      this.mcpServersClient = new McpServersClient(this.httpClient);
    }
    return this.mcpServersClient;
  }

  /**
   * RAG operations client
   */
  get rag(): RagClient {
    if (!this.ragClient) {
      this.ragClient = new RagClient(this.httpClient);
    }
    return this.ragClient;
  }

  /**
   * API key management client
   */
  get apiKeys(): ApiKeyClient {
    if (!this.apiKeyClient) {
      this.apiKeyClient = new ApiKeyClient(this.httpClient);
    }
    return this.apiKeyClient;
  }

  /**
   * BYOK (Bring Your Own Key) client — provider credentials per whitelabel.
   *
   * @example
   * ```typescript
   * // Create a Neo4j BYOK
   * const byok = await divinci.byok.create("workspace-id", {
   *   name: "Neo4j Aura (GCP)",
   *   providerId: "NEO4J_HYBRID",
   *   auth: { uri: "neo4j+s://...", username: "neo4j", password: "...", database: "neo4j" }
   * });
   *
   * // Rotate credentials in place — RAG vectors keep their byok ref
   * await divinci.byok.rotate("workspace-id", byok._id, {
   *   auth: { uri: "neo4j+s://new-host...", username: "neo4j", password: "...", database: "neo4j" }
   * });
   * ```
   */
  get byok(): BYOKClient {
    if (!this.byokClient) {
      this.byokClient = new BYOKClient(this.httpClient);
    }
    return this.byokClient;
  }

  /**
   * Hosted Hermes Agents client — Divinci-hosted, isolated Hermes agents.
   *
   * @example
   * ```typescript
   * const agent = await divinci.hermesAgents.create("workspace-id", {
   *   title: "Support Bot",
   *   hermesModel: "vertex_ai/gemini-2.5-flash", // platform model, no key needed
   * });
   * // agent.proxyApiKey → drop into any OpenAI-compatible client
   * const reply = await divinci.hermesAgents.chat("workspace-id", agent._id, [
   *   { role: "user", content: "ping" },
   * ]);
   * ```
   */
  get hermesAgents(): HermesAgentsClient {
    if (!this.hermesAgentsClient) {
      this.hermesAgentsClient = new HermesAgentsClient(this.httpClient);
    }
    return this.hermesAgentsClient;
  }

  /**
   * Arena operations client
   *
   * @example
   * ```typescript
   * // Enable arena
   * await divinci.arena.enable("ws-123", { variants: [...] });
   *
   * // Get results
   * const results = await divinci.arena.getResults("ws-123");
   *
   * // Manage presets
   * const presets = await divinci.arena.presets.list("ws-123");
   * ```
   */
  get arena(): ArenaClient {
    if (!this.arenaClient) {
      this.arenaClient = new ArenaClient(this.httpClient);
    }
    return this.arenaClient;
  }

  /**
   * Transcript management client
   */
  get transcripts(): TranscriptClient {
    if (!this.transcriptClient) {
      this.transcriptClient = new TranscriptClient(this.httpClient);
    }
    return this.transcriptClient;
  }

  /**
   * Audio transcript management client
   */
  get audio(): AudioClient {
    if (!this.audioClient) {
      this.audioClient = new AudioClient(this.httpClient);
    }
    return this.audioClient;
  }

  /**
   * Fine-tuning job management client
   */
  get fineTune(): FineTuneClient {
    if (!this.fineTuneClient) {
      this.fineTuneClient = new FineTuneClient(this.httpClient);
    }
    return this.fineTuneClient;
  }

  /**
   * Workspace configuration client
   */
  get config(): ConfigClient {
    if (!this.configClient) {
      this.configClient = new ConfigClient(this.httpClient);
    }
    return this.configClient;
  }

  /**
   * User group management client
   */
  get groups(): GroupClient {
    if (!this.groupClient) {
      this.groupClient = new GroupClient(this.httpClient);
    }
    return this.groupClient;
  }

  /**
   * Permission management client
   */
  get permissions(): PermissionClient {
    if (!this.permissionClient) {
      this.permissionClient = new PermissionClient(this.httpClient);
    }
    return this.permissionClient;
  }

  /**
   * Training data generation client
   *
   * Generate Q&A training datasets from RAG files and audio transcripts.
   * Export to fine-tune files or QA test suites.
   */
  get trainingData(): TrainingDataClient {
    if (!this.trainingDataClient) {
      this.trainingDataClient = new TrainingDataClient(this.httpClient);
    }
    return this.trainingDataClient;
  }

  /**
   * Quality assurance client
   *
   * Manage QA test suites and run post-fine-tune validation.
   */
  get qa(): QAClient {
    if (!this.qaClient) {
      this.qaClient = new QAClient(this.httpClient);
    }
    return this.qaClient;
  }

  /**
   * Meta-harness orchestration client
   *
   * Loop config, iterations history, proposals review/accept/reject.
   * Backing `MetaHarnessClient` was added by a parallel agent (2026-04-22)
   * but they forgot to expose the getter here — causing the CLI package
   * to fail to build with "Property 'metaHarness' does not exist on type
   * 'DivinciServer'". Wiring the getter unblocks the build.
   */
  get metaHarness(): MetaHarnessClient {
    if (!this.metaHarnessClient) {
      this.metaHarnessClient = new MetaHarnessClient(this.httpClient);
    }
    return this.metaHarnessClient;
  }

  /**
   * Notification client — notifications CRUD plus the configuration surfaces
   * for custom notification implementations (delivery channels, triggers,
   * and LLM-driven custom flaggers).
   *
   * @example
   * ```typescript
   * const { docs } = await divinci.notifications.list("ws-123", { isRead: false });
   * await divinci.notifications.flaggers.create("ws-123", { ... });
   * ```
   */
  get notifications(): NotificationClient {
    if (!this.notificationClient) {
      this.notificationClient = new NotificationClient(this.httpClient);
    }
    return this.notificationClient;
  }

  /**
   * Analytics client — product analytics for AI releases (metrics, trends,
   * experiments, funnel, event ingestion).
   *
   * @example
   * ```typescript
   * const { current } = await divinci.analytics.metrics("ws-123", { timeRange: "7d" });
   * ```
   */
  get analytics(): AnalyticsClient {
    if (!this.analyticsClient) {
      this.analyticsClient = new AnalyticsClient(this.httpClient);
    }
    return this.analyticsClient;
  }

  /**
   * Metrics client — pipeline telemetry + custom alert configurations.
   *
   * @example
   * ```typescript
   * const result = await divinci.metrics.pipeline("ws-123", "pipe-1", { timeRange: "24h" });
   * ```
   */
  get metrics(): MetricsClient {
    if (!this.metricsClient) {
      this.metricsClient = new MetricsClient(this.httpClient);
    }
    return this.metricsClient;
  }

  /**
   * Phone Usage client — unbilled voice-call (LiveKit) and SMS/MMS (Twilio)
   * usage for a workspace, at cost.
   *
   * @example
   * ```typescript
   * const voice = await divinci.phoneUsage.voice("ws-123");
   * const sms = await divinci.phoneUsage.sms("ws-123");
   * ```
   */
  get phoneUsage(): PhoneUsageClient {
    if (!this.phoneUsageClient) {
      this.phoneUsageClient = new PhoneUsageClient(this.httpClient);
    }
    return this.phoneUsageClient;
  }

  /**
   * Connectors client — manage data connectors; today focused on web_crawl
   * (crawl a website/sitemap into a RAG vector, optionally recurring).
   *
   * @example
   * ```typescript
   * await divinci.connectors.webCrawlStart("ws-123", {
   *   mode: "crawl",
   *   rootUrl: "https://docs.example.com",
   *   targetVectorId: "vec-456",
   *   runSitemap: true,
   *   autoSync: true,
   *   swapOnSuccess: true, // required when the vector backs a published release
   * });
   * ```
   */
  get connectors(): ConnectorsClient {
    if (!this.connectorsClient) {
      this.connectorsClient = new ConnectorsClient(this.httpClient);
    }
    return this.connectorsClient;
  }

  /**
   * External tools client — the third-party RAG ecosystem: register an HTTPS
   * endpoint as a document parser (RAG/Chunker) or a search backend
   * (RAG/Retriever). Divinci calls it; it never hosts the code.
   *
   * @example
   * ```
   * await divinci.externalTools.create("ws-123", {
   *   toolType: "RAG/Retriever",
   *   slug: "acme-search",
   *   title: "Acme Search",
   *   endpointUrl: "https://search.acme.example/divinci",
   *   authType: "bearer",
   *   authSecret: process.env.ACME_TOKEN,
   * });
   * ```
   */
  get externalTools(): ExternalToolsClient {
    if (!this.externalToolsClient) {
      this.externalToolsClient = new ExternalToolsClient(this.httpClient);
    }
    return this.externalToolsClient;
  }

  /**
   * Usage client — workspace API-key usage statistics + billing reports.
   *
   * @example
   * ```typescript
   * const { stats } = await divinci.usage.apiKeyUsage("ws-123", "openai");
   * ```
   */
  get usage(): UsageClient {
    if (!this.usageClient) {
      this.usageClient = new UsageClient(this.httpClient);
    }
    return this.usageClient;
  }

  /**
   * Spend Guard client — cost tracking, budget enforcement, and alerting
   * for external services (RunPod GPU, Google AI VEO/TTS, etc.).
   *
   * @example
   * ```typescript
   * const budget = await divinci.spendGuard.checkBudget("runpod", "user_123");
   * if (!budget.allowed) throw new Error(budget.reason);
   * ```
   */
  get spendGuard(): SpendGuardClient {
    if (!this.spendGuardClient) {
      this.spendGuardClient = new SpendGuardClient(this.httpClient);
    }
    return this.spendGuardClient;
  }

  /**
   * Red-team client — probe a DEPLOYED release against the shared
   * TrustBench corpus (prompt injection, jailbreak, leak, exfil,
   * harmful content, indirect injection, scope violation).
   *
   * One category per `run()` call; use `runSweep()` to walk them all.
   * Check `measured` before treating a 0.0 attack-success rate as a
   * perfect score.
   *
   * @example
   * ```typescript
   * const plan = await divinci.redTeam.plan("ws-123");
   * const batch = await divinci.redTeam.run("ws-123", {
   *   releaseId: "rel-456",
   *   category: "prompt-injection",
   *   systemPrompt: "You are a support assistant…",
   * });
   * if (!batch.measured) throw new Error("category was not fully measured");
   * ```
   */
  get redTeam(): RedTeamClient {
    if (!this.redTeamClient) {
      this.redTeamClient = new RedTeamClient(this.httpClient);
    }
    return this.redTeamClient;
  }

  /**
   * Feedback client — admin-tier READ of the message feedback a whitelabel's
   * releases received (consumers submit it via the chat endpoints).
   *
   * @example
   * ```typescript
   * const { docs } = await divinci.feedback.list("ws-123", { sentiment: "negative", hasText: true });
   * const stats = await divinci.feedback.stats("ws-123");
   * ```
   */
  get feedback(): FeedbackClient {
    if (!this.feedbackClient) {
      this.feedbackClient = new FeedbackClient(this.httpClient);
    }
    return this.feedbackClient;
  }

  /**
   * x402 payment client
   */
  get x402(): X402Client {
    if (!this.x402Client) {
      this.x402Client = new X402Client(this.httpClient, this._config.x402);
    }
    return this.x402Client;
  }

  /**
   * Get the default workspace ID
   */
  getDefaultWorkspaceId(): string | undefined {
    return this._config.defaultWorkspaceId;
  }

  /**
   * Set the default workspace ID
   */
  setDefaultWorkspaceId(workspaceId: string): void {
    this._config.defaultWorkspaceId = workspaceId;
  }

  /**
   * Get the HTTP client (for advanced use cases)
   */
  getHttpClient(): ServerHttpClient {
    return this.httpClient;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<DivinciServerOptions> {
    return { ...this._config };
  }

  /**
   * Validate the API key
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.apiKeys.validate(this._config.apiKey);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Divinci server client instance
 *
 * @example
 * ```typescript
 * const divinci = createServer({
 *   apiKey: process.env.DIVINCI_API_KEY!,
 * });
 * ```
 */
export function createServer(options: DivinciServerOptions): DivinciServer {
  return new DivinciServer(options);
}
