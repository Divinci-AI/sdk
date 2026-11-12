/**
 * @divinci-ai/client
 *
 * Divinci AI Client SDK for browser applications
 */

// Main client
export { DivinciClient, createClient } from "./client.js";
export type { DivinciClientOptions, AuthState } from "./client.js";

// HTTP client (for advanced use cases)
export { HttpClient, SimpleTokenStorage } from "./http-client.js";
export type { RequestOptions, TokenStorage } from "./http-client.js";

// Namespaces
export { RagNamespace, VectorIndexNamespace, ArenaNamespace, ArenaPresetsNamespace, BaseNamespace, HomepageChatNamespace, AnonymousChatNamespace, SiteControlNamespace, ModelEditsNamespace } from "./namespaces/index.js";
export type {
  NamespaceContext,
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
  RagVectorDoc,
  CreateVectorIndexBody,
  UpdateVectorIndexBody,
  ForkVectorIndexBody,
  HomepageTranscriptMessage,
  HomepageVerifyResult,
  HomepageConfirmResult,
  HomepageSendResult,
  FreeChatGateConfigResult,
  SiteActionDescriptor,
  SiteActionParameter,
  SiteActionHandler,
  SiteActionConfirm,
  SiteControlExecuteResult,
  ParsedSiteAction,
  ResolvedSiteAction,
  PreparedReply,
} from "./namespaces/index.js";

// WebSocket
export {
  WebSocketManager,
  ManagedWebSocket,
  ChatWebSocket,
  TranscriptWebSocket,
  EventEmitter,
} from "./websocket/index.js";
export type {
  WebSocketState,
  WebSocketOptions,
  WebSocketManagerConfig,
} from "./websocket/index.js";

// Chat client
export { ChatClient } from "./chat/index.js";
export type { ChatStreamEvent, StreamOptions } from "./chat/index.js";

// Errors
export {
  DivinciError,
  AuthenticationError,
  ValidationError,
  RateLimitError,
  QuotaExceededError,
  PaymentRequiredError,
  NotFoundError,
  NetworkError,
  StreamError,
  TimeoutError,
} from "./errors.js";

// Re-export types for convenience
export type {
  // Config
  DivinciClientConfig,
  ExternalUserConfig,
  // Chat
  ChatThread,
  ChatMessage,
  ChatResponse,
  ChatStreamChunk,
  SendMessageOptions,
  CreateChatOptions,
  ListChatsOptions,
  MessageRole,
  // Arena
  ArenaResponseVariant,
  ArenaSelectResponse,
  ArenaRegenerateVariantResponse,
  ArenaEnableBody,
  ArenaEnableResponse,
  ArenaResultsResponse,
  ArenaVariantResult,
  ArenaTestBody,
  ArenaTestResponse,
  ArenaCostEstimateBody,
  ArenaCostEstimateResponse,
  ArenaPreset,
  ArenaPresetExportFormat,
  ArenaPresetActivateResponse,
  ArenaPresetResultsResponse,
  CreateArenaPresetBody,
  UpdateArenaPresetBody,
  ArenaConfig,
  ArenaVariant,
  ArenaMode,
  ArenaStreamingStatus,
  ArenaInlineScores,
  PipelineTimingMetrics,
  // Release
  Release,
  ReleaseConfig,
  ReleaseTheme,
  ReleaseStatus,
  // Common
  PaginationOptions,
  PaginatedResponse,
  ObjectId,
  ISODateString,
  // Errors
  DivinciErrorData,
  ErrorCode,
} from "@divinci-ai/types";
