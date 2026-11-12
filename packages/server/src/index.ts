/**
 * @divinci-ai/server
 *
 * Divinci AI Server SDK for Node.js applications
 */

// Main client
export { DivinciServer, createServer } from "./client.js";
export type { DivinciServerOptions } from "./client.js";

// HTTP client (for advanced use cases)
export { ServerHttpClient, ServerApiError } from "./http-client.js";
export type { RequestOptions, StreamResponse } from "./http-client.js";

// Resource clients
export { WorkspaceClient } from "./workspaces/index.js";
export type { WorkspaceUsage } from "./workspaces/index.js";

export { ReleaseClient } from "./releases/index.js";
export { TermsClient } from "./terms/index.js";
export { ModelEditsClient } from "./model-edits/index.js";
export type {
  ModelEditOp,
  ModelEditStatus,
  ModelEditProbeResult,
  ModelEditAssociation,
  DescribeEntityResult,
  ModelEdit,
  CreateModelEditInput,
  CreateModelEditResult,
  RevertModelEditResult,
  ListModelEditsFilter,
} from "./model-edits/index.js";
export type { TermsOfServiceDoc, CreateTermsInput, UpdateTermsInput } from "./terms/index.js";
export { AiChatsClient } from "./ai-chats/index.js";
export type { EmojiReactionResult } from "./ai-chats/index.js";
export { McpServersClient } from "./mcp-servers/index.js";
export type {
  McpServerView,
  McpTransport,
  McpAuthType,
  CreateMcpServerInput,
  UpdateMcpServerInput,
} from "./mcp-servers/index.js";
export { SkillsClient } from "./skills/index.js";
export type {
  SkillActionPublic,
  SkillIntegrationPublic,
  SkillConnectionStatus,
  SkillToolOverride,
  WhitelabelSkillView,
  CreateSkillInput,
  UpdateSkillInput,
  SkillConnectStart,
} from "./skills/index.js";
export type { ReleaseAnalytics, ReleaseAnalyticsOptions } from "./releases/index.js";

export { RagClient } from "./rag/index.js";

export { ApiKeyClient } from "./api-keys/index.js";
export type { ApiKeyValidationResult } from "./api-keys/index.js";

export { BYOKClient } from "./byok/index.js";
export type {
  BYOK,
  BYOKListResponse,
  CreateBYOKBody,
  UpdateBYOKMetaBody,
  RotateBYOKAuthBody,
  BYOKEndpointTestResult,
} from "./byok/index.js";

export { HermesAgentsClient } from "./hermes-agents/index.js";
export type {
  HermesAgent,
  HermesAgentSummary,
  HermesAgentStatus,
  CreateHermesAgentBody,
  UpdateHermesAgentBody,
  HermesChatMessage,
  HermesChatResponse,
  // NB: this barrel is an explicit allowlist, not `export *` — a type added to
  // hermes-agents/index.ts is invisible to consumers until it is listed here.
  HermesProactiveConfigInput,
  HermesProactiveRun,
} from "./hermes-agents/index.js";

export { ArenaClient } from "./arena/index.js";
export { ArenaPresetsClient } from "./arena/index.js";

export { TranscriptClient } from "./transcripts/index.js";
export type {
  ListTranscriptsOptions,
  CreateTranscriptOptions,
  AddMessageOptions,
  Transcript,
  TranscriptMessage,
} from "./transcripts/index.js";

export { AudioClient } from "./audio/index.js";
export type {
  ListAudioOptions,
  AudioTranscript,
  AudioRagResult,
} from "./audio/index.js";

export { FineTuneClient } from "./fine-tune/index.js";
export type {
  ListFineTuneOptions,
  CreateFineTuneOptions,
  FineTuneJob,
  FineTuneStatus,
} from "./fine-tune/index.js";

export { ConfigClient } from "./config/index.js";
export type { WorkspaceConfig } from "./config/index.js";

export { TrainingDataClient } from "./training-data/index.js";
export type {
  TrainingDataJob,
  TrainingDataQAPair,
  TrainingDataResult,
  GenerateOptions,
  ExportOptions,
  ExportToQAOptions,
  ExportToQAResult,
  CostEstimate,
  SamplingStrategy,
} from "./training-data/index.js";

export { QAClient } from "./qa/index.js";
export type {
  QASuite,
  QARunResult,
  CreateSuiteOptions,
  RunOptions,
  ScoreGenerator,
} from "./qa/index.js";

export {
  RedTeamClient,
  RED_TEAM_CATEGORIES,
  isRedTeamCategory,
} from "./red-team/index.js";
export type {
  RedTeamCategory,
  RedTeamSeverity,
  RedTeamCategoryInfo,
  RedTeamPlanResponse,
  RedTeamProbeResult,
  RedTeamRemediationItem,
  RedTeamScore,
  RedTeamBatchResponse,
  RedTeamRunOptions,
  RedTeamSweepOptions,
  RedTeamSweepResponse,
} from "./red-team/index.js";

export { X402Client, createX402Wallet } from "./x402/index.js";
export type {
  ToolPricing,
  PaymentHistoryOptions,
  PaymentRecord,
  PaymentVerificationResult,
  WalletBalance,
} from "./x402/index.js";
export { X402_PAYMENT_HEADER, encodePaymentHeader, extractPaymentDetails } from "./x402/header.js";
export type { X402PayHook } from "./http-client.js";

// Notifications (incl. delivery channels, triggers, custom flaggers)
export {
  NotificationClient,
  NotificationChannelsClient,
  NotificationTriggersClient,
  NotificationFlaggersClient,
} from "./notifications/index.js";
export type {
  NotificationDoc,
  ListNotificationsFilters,
  NotificationsListResponse,
  WebhookRetryPolicy,
  DeliveryChannelInput,
  DeliveryChannelDoc,
  DeliveryTriggerRule,
  DeliveryTriggerInput,
  DeliveryTriggerDoc,
  NotificationFlaggerInput,
  NotificationFlaggerDoc,
} from "./notifications/index.js";

// Analytics (product analytics for AI releases)
export { AnalyticsClient } from "./analytics/index.js";
export type {
  AnalyticsTimeRange,
  ProductMetricsResponse,
  ProductTrendsResponse,
  ProductPerformanceResponse,
  ExperimentResultsResponse,
  ConversionFunnelResponse,
  ProductEventInput,
} from "./analytics/index.js";

// Metrics (pipeline telemetry + custom alert configs)
export { MetricsClient } from "./metrics/index.js";
export type {
  MetricTimeRange,
  AlertThresholdConfig,
  AlertNotificationChannel,
  MetricAlertConfig,
  MetricAlert,
  SetAlertConfigInput,
} from "./metrics/index.js";

// Phone Usage (unbilled voice-call + SMS/MMS usage)
export { PhoneUsageClient } from "./phone-usage/index.js";
export type { VoiceUsageResponse, SmsUsageResponse } from "./phone-usage/index.js";

// External tools (third-party RAG parsers and retrievers)
export { ExternalToolsClient } from "./external-tools/index.js";
export type {
  ExternalTool,
  ExternalToolType,
  ExternalToolAuthType,
  CreateExternalToolInput,
  UpdateExternalToolInput,
} from "./external-tools/index.js";

// Connectors (web_crawl / wordpress → RAG vector, recurring sync)
export { ConnectorsClient } from "./connectors/index.js";
export type {
  WebCrawlSettings,
  ConnectorConnection,
  ConnectorSyncJob,
  WebCrawlStartResponse,
  WordPressSettings,
  WordPressDiscoverResponse,
  WordPressStartResponse,
  ConnectorStats,
  ConnectorSettings,
  ConnectorFile,
} from "./connectors/index.js";

// Usage (workspace API-key usage stats + billing reports)
export { UsageClient } from "./usage/index.js";
export type { UsageStatsResponse } from "./usage/index.js";

// Feedback (admin-tier read of message feedback)
export { FeedbackClient } from "./feedback/index.js";
export type {
  MessageFeedbackRecord,
  FeedbackListResult,
  MessageFeedbackStats,
  ListFeedbackOptions,
  FeedbackStatsOptions,
  FeedbackSource,
} from "./feedback/index.js";

// Spend Guard (cost tracking, budget enforcement, alerting)
export { SpendGuardClient } from "./services/client.js";
export type {
  ProviderName,
  SpendBudget,
  SpendRecord,
  DailySpendSummary,
  SpendAlert,
  SpendStorage,
} from "./services/spend-guard.js";
export { SPEND_LIMITS, COST_ESTIMATES } from "./services/spend-guard.js";

export { D1HttpSpendStorage } from "./services/d1-spend-storage.js";
export type { D1HttpStorageOptions } from "./services/d1-spend-storage.js";

// Re-export types for convenience
export type {
  // Config
  DivinciServerConfig,
  X402Config,
  X402Wallet,
  X402PaymentDetails,
  X402PaymentReceipt,
  // Workspace
  Workspace,
  WorkspaceSettings,
  WorkspaceLimits,
  CreateWorkspaceOptions,
  UpdateWorkspaceOptions,
  ListWorkspacesOptions,
  // Release
  Release,
  ReleaseConfig,
  ReleaseTheme,
  ReleaseStatus,
  CreateReleaseOptions,
  UpdateReleaseOptions,
  ListReleasesOptions,
  // RAG
  RagCollection,
  RagDocument,
  RagChunk,
  RagSearchResult,
  CreateRagCollectionOptions,
  RagSearchOptions,
  ListDocumentsOptions,
  // API Key
  ApiKey,
  ApiKeyWithSecret,
  ApiKeyStatus,
  ApiKeyUsageStats,
  CreateApiKeyOptions,
  UpdateApiKeyOptions,
  ListApiKeysOptions,
  // Arena
  ArenaConfig,
  ArenaVariant,
  ArenaMode,
  ArenaEnableBody,
  ArenaEnableResponse,
  ArenaResultsResponse,
  ArenaVariantResult,
  ArenaTestBody,
  ArenaTestResponse,
  ArenaTestSelectBody,
  ArenaCostEstimateBody,
  ArenaCostEstimateResponse,
  ArenaPreset,
  ArenaPresetExportFormat,
  ArenaPresetActivateResponse,
  ArenaPresetResultsResponse,
  CreateArenaPresetBody,
  UpdateArenaPresetBody,
  ArenaSelectResponse,
  ArenaRegenerateVariantResponse,
  ArenaRoutingEstimateBody,
  ArenaRoutingEstimateResponse,
  // Common
  PaginationOptions,
  PaginatedResponse,
  ObjectId,
  ISODateString,
} from "@divinci-ai/types";
