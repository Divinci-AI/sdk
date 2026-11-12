/**
 * SDK Namespaces
 *
 * Hierarchical API namespaces for organizing SDK methods
 */

export { BaseNamespace, type NamespaceContext } from "./base.js";

// Model Edits (activation-level knowledge editing via LarQL).
export { ModelEditsNamespace } from "./model-edits/index.js";
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

// Homepage free-chat (email-gated, keyless public chat)
//
// @deprecated — use FreeChatGateNamespace instead. The homepage-chat
// namespace is pinned to one Release server-side via env var and is
// scheduled for removal once the Divinci.ai homepage cuts over to
// FreeChatGate (P5 of strategy/2026-05-29-standardize-free-chat-gate.md).
export { HomepageChatNamespace } from "./homepage-chat/index.js";
export type {
  HomepageTranscriptMessage,
  HomepageVerifyResult,
  HomepageConfirmResult,
  HomepageSendResult,
} from "./homepage-chat/index.js";

// Free-Chat Gate (release-configurable, keyless email-gated public chat).
// Generalization of the homepage-chat flow that takes the Release id
// per call; supports four verification modes (none / captcha-only /
// captcha+OTP / captcha+magic-link).
export { FreeChatGateNamespace } from "./free-chat-gate/index.js";
export type {
  FreeChatGateMode,
  FreeChatGateStartArgs,
  FreeChatGateStartResult,
  FreeChatGateVerifyOtpResult,
  FreeChatGateStateResult,
  FreeChatGateTranscriptMessage,
  FreeChatGateSendResult,
  FreeChatGateConfigResult,
  SiteActionDescriptor,
  SiteActionParameter,
} from "./free-chat-gate/index.js";

// Site Control (v1) — execute assistant-emitted navigation/action directives.
export { SiteControlNamespace } from "./site-control/index.js";
export type {
  SiteActionHandler,
  SiteActionConfirm,
  SiteControlExecuteResult,
  ParsedSiteAction,
  ResolvedSiteAction,
  PreparedReply,
} from "./site-control/index.js";

// Terms of Service (versioned per-release acceptance gate)
export { TermsNamespace } from "./terms/index.js";
export type { AcceptTermsResult } from "./terms/index.js";

// RAG
export {
  RagNamespace,
  VectorIndexNamespace,
  type RagVectorDoc,
  type CreateVectorIndexBody,
  type UpdateVectorIndexBody,
  type ForkVectorIndexBody,
} from "./rag/index.js";

// Audio
export {
  AudioNamespace,
  VoiceprintsNamespace,
  AudioBulkNamespace,
  type AudioTranscriptDoc,
  type AudioSpeaker,
  type TranscriptSegment,
  type VoiceprintDoc,
  type UploadAudioBody,
  type UploadAudioFromUrlBody,
  type UpdateAudioBody,
  type GenerateRagFileBody,
  type GenerateFineTuneFileBody,
  type BulkAudioBody,
  type BulkGenerateRagFilesBody,
} from "./audio/index.js";

// User
export {
  UserNamespace,
  BalanceNamespace,
  PaymentNamespace,
  PreferencesNamespace,
  AudioPreferencesNamespace,
  SavedReleasesNamespace,
  type UserBalanceResponse,
  type PaymentMethod,
  type DepositFundsBody,
  type DepositResponse,
  type Transaction,
  type TransactionRange,
  type AudioToolPreferences,
  type SavedReleasesDoc,
} from "./user/index.js";

// API Keys
export {
  ApiKeyNamespace,
  type ApiKeyDoc,
  type ApiKeyPermissions,
  type ApiKeyRateLimit,
  type CreateApiKeyBody,
  type UpdateApiKeyBody,
  type CreatedApiKeyResponse,
  type RotateApiKeyResponse,
  type ApiKeyUser,
} from "./api-keys/index.js";

// BYOK (Bring Your Own Key) — provider credentials per whitelabel
export {
  BYOKNamespace,
  type BYOKDoc,
  type BYOKEndpointTestResult,
  type BYOKListResponse,
  type CreateBYOKBody,
  type UpdateBYOKMetaBody,
  type RotateBYOKAuthBody,
} from "./byok/index.js";

// Style-pattern — per-workspace rules driving the Phase 4 chat-response rewriter
export {
  StylePatternNamespace,
  type StylePatternCategory,
  type StylePatternRuleDoc,
  type ProposedRuleDoc,
  type ResponseEditSource,
  type ResponseEditExampleDoc,
  type StylePatternAuditEntry,
  type ListRulesParams,
  type ListProposedParams,
  type ListExamplesParams,
  type TestRewriteBody,
  type TestRewriteResult,
  type ApproveProposedBody,
  type RejectProposedBody,
  type ToggleRuleBody,
  type ListAuditParams,
  type FineTuneTrainingRunStatus,
  type FineTuneTrainingRunTrigger,
  type FineTuneTrainingRunDoc,
  type CreateTrainingRunBody,
  type CreateTrainingRunResult,
  type ListTrainingRunsParams,
  type ExportTrainingRunJsonlParams,
  type ExportTrainingRunJsonlStats,
  type ExportTrainingRunJsonlResponse,
  type TransitionTrainingRunBody,
  type TransitionTrainingRunResult,
} from "./style-pattern/index.js";

// Fine-Tune
export {
  FineTuneNamespace,
  FineTuneFilesNamespace,
  type FineTuneDoc,
  type FineTuneHyperparameters,
  type FineTuneMetrics,
  type CreateFineTuneBody,
  type ForkFineTuneBody,
  type FineTuneFileDoc,
  type FineTuneFileEntry,
  type CreateFineTuneFileBody,
} from "./fine-tune/index.js";

// Arena
export {
  ArenaNamespace,
  ArenaPresetsNamespace,
} from "./arena/index.js";

// Notifications (incl. delivery channels, triggers, and custom flaggers)
export {
  NotificationsNamespace,
  NotesNamespace,
  DeliveryChannelsNamespace,
  DeliveryTriggersNamespace,
  NotificationFlaggersNamespace,
  type NotificationDoc,
  type NotificationType,
  type NotificationNote,
  type ListNotificationsFilters,
  type NotificationsListResponse,
  type NotificationCounts,
  type TagSuggestion,
  type WebhookRetryPolicy,
  type EmailChannelInput,
  type WebhookChannelInput,
  type DeliveryChannelInput,
  type DeliveryChannelDoc,
  type WebhookDeliveryLog,
  type DeliveryTriggerRule,
  type DeliveryTriggerInput,
  type DeliveryTriggerDoc,
  type NotificationFlaggerInput,
  type NotificationFlaggerDoc,
} from "./notifications/index.js";

// Analytics (product analytics for AI releases)
export {
  AnalyticsNamespace,
  type AnalyticsTimeRange,
  type ProductMetricsPeriod,
  type ProductMetricsResponse,
  type ProductTrendPoint,
  type ProductTrendsResponse,
  type ProductPerformanceRow,
  type ProductPerformanceResponse,
  type ExperimentResult,
  type ExperimentResultsResponse,
  type FunnelStage,
  type ConversionFunnelResponse,
  type ProductEventInput,
  type TrackEventsResponse,
  type RealtimeMetrics,
} from "./analytics/index.js";

// Metrics (pipeline telemetry + custom alert configs)
export {
  MetricsNamespace,
  type MetricTimeRange,
  type AlertSeverity,
  type NodeMetrics,
  type PipelineMetricsResponse,
  type MetricAlert,
  type PipelineAlertsResponse,
  type AlertThresholdConfig,
  type AlertNotificationChannel,
  type MetricAlertConfig,
  type SetAlertConfigInput,
  type MetricsExportRows,
} from "./metrics/index.js";

// Phone Usage (unbilled voice-call + SMS/MMS usage — see the phone billing guide)
export {
  PhoneUsageNamespace,
  type VoiceUsageResponse,
  type SmsUsageResponse,
} from "./phone-usage/index.js";

// Connectors (web_crawl → RAG vector, recurring sync)
export {
  ConnectorsNamespace,
  type WebCrawlSettings,
  type ConnectorConnection,
  type ConnectorSyncJob,
  type WebCrawlStartResponse,
} from "./connectors/index.js";

// External tools (workspace-registered document parsers)
export {
  ExternalToolsNamespace,
  type ExternalTool,
  type ExternalToolType,
  type ExternalToolAuthType,
  type ExternalToolPricing,
  type ExternalToolHealth,
  type CreateExternalToolInput,
  type UpdateExternalToolInput,
  type DeleteExternalToolResult,
} from "./external-tools/index.js";

// Feedback (admin-tier read of message feedback)
export {
  FeedbackNamespace,
  type MessageFeedbackRecord,
  type FeedbackListResult,
  type MessageFeedbackStats,
  type ListFeedbackOptions,
  type FeedbackStatsOptions,
  type FeedbackSource,
} from "./feedback/index.js";

export { AnonymousChatNamespace } from "./anonymous-chat/index.js";
