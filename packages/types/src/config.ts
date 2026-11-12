/**
 * SDK Configuration types
 */

/**
 * Base SDK configuration
 */
export interface DivinciConfig {
  /** API key for authentication */
  apiKey?: string;
  /** Base URL for API requests */
  baseUrl?: string;
  /** API version to use */
  apiVersion?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum retries for failed requests */
  maxRetries?: number;
  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Client SDK configuration (browser)
 */
export interface DivinciClientConfig extends DivinciConfig {
  /** Release ID for chat operations */
  releaseId: string;
  /** Enable streaming by default */
  streaming?: boolean;
  /** External user configuration (for API key auth) */
  externalUser?: ExternalUserConfig;
  /**
   * User token for authentication (simplified auth).
   * Must be a short-lived ACCESS token (e.g. the `accessToken` returned by
   * `POST /embed/validate-login`) — never the long-lived refresh token
   * returned by `POST /embed/login`. The refresh token is not a valid
   * Authorization header value and will be rejected.
   * When provided, creates a SimpleTokenStorage internally, which does NOT
   * auto-refresh: once the access token expires (30 min for embed-issued
   * tokens), the caller must re-exchange it (e.g. via `/embed/validate-login`
   * again) and call `client.setToken()` with the new value.
   * Alternative to providing a custom tokenStorage.
   */
  userToken?: string;
  /**
   * Calling origin, used for automatic token refresh.
   * Required only if you also call `client.setRefreshToken()` — `HttpClient`
   * exchanges the refresh token for a new access token via
   * `POST /embed/validate-login`, which checks this origin against the
   * API key's `allowedOrigins` allowlist. In a browser this is typically
   * `window.location.origin`; in a headless/backend-proxied integration,
   * pass the origin of the eventual browser caller. Without it, automatic
   * refresh is skipped (a warning is logged) and the caller must
   * re-authenticate manually.
   */
  origin?: string;
  /** Base URL for WebSocket connections */
  wsBaseUrl?: string;
  /** Default workspace ID for operations */
  workspaceId?: string;
}

/**
 * Server SDK configuration (Node.js)
 */
export interface DivinciServerConfig extends DivinciConfig {
  /** API key for authentication (required unless accessToken is provided) */
  apiKey: string;
  /** OAuth access token (alternative to apiKey) */
  accessToken?: string;
  /** Default workspace ID for operations */
  defaultWorkspaceId?: string;
  /** x402 payment configuration */
  x402?: X402Config;
}

/**
 * External user configuration for embed/client SDK
 */
export interface ExternalUserConfig {
  /** User ID from your system */
  userId: string;
  /** User email */
  email?: string;
  /** User display name */
  name?: string;
  /** User nickname */
  nickname?: string;
  /** Profile picture URL */
  picture?: string;
  /** Membership tier */
  membershipTier?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * x402 payment configuration
 */
export interface X402Config {
  /** Enable x402 payments */
  enabled?: boolean;
  /** Wallet for automatic payments */
  wallet?: X402Wallet;
  /** Auto-pay for premium tools */
  autoPayment?: boolean;
  /** Maximum payment per request (USD) */
  maxPaymentUsd?: number;
  /** Network preference */
  network?: "base" | "base-sepolia";
}

/**
 * x402 wallet interface (canonical v1 — exact EVM scheme).
 *
 * The wallet SIGNS an EIP-3009 transferWithAuthorization for the given payment
 * requirements and returns a PaymentPayload. It does NOT broadcast — the
 * facilitator settles it server-side.
 */
export interface X402Wallet {
  /** Get wallet address */
  getAddress(): Promise<string>;
  /** Sign the payment authorization, returning the canonical PaymentPayload. */
  pay(details: X402PaymentDetails): Promise<X402PaymentReceipt>;
}

/**
 * x402 PaymentRequirements (a single `accepts[]` entry from the 402 body).
 * Named X402PaymentDetails for back-compat with the SDK surface.
 */
export interface X402PaymentDetails {
  /** Payment scheme (e.g. "exact"). */
  scheme: string;
  /** Blockchain network identifier (e.g. "base-sepolia"). */
  network: string;
  /** Required amount in atomic token units (string). */
  maxAmountRequired: string;
  /** Token contract address. */
  asset: string;
  /** Recipient wallet address. */
  payTo: string;
  /** Absolute URL of the protected resource. */
  resource: string;
  /** Human-readable description. */
  description: string;
  /** Response mime type. */
  mimeType: string;
  /** Max seconds allowed to complete payment. */
  maxTimeoutSeconds: number;
  /** EIP-712 domain hints (token name + version). */
  extra: { name: string; version: string };
}

/** EIP-3009 authorization signed by the payer. */
export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * x402 PaymentPayload — the base64 X-PAYMENT header content.
 * Named X402PaymentReceipt for back-compat with the SDK surface.
 */
export interface X402PaymentReceipt {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: X402Authorization;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<DivinciConfig> = {
  baseUrl: "https://api.divinci.app",
  apiVersion: "2025-01-01",
  timeout: 30000,
  maxRetries: 3,
  debug: false,
};

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  // Auth
  AUTH_VALIDATE_KEY: "/api/v1/auth/validate-key",
  // Note: not a /api/v1/auth/* route — this exchanges a long-lived embed
  // refresh token for a short-lived access token via the embed login flow.
  AUTH_REFRESH_TOKEN: "/embed/validate-login",

  // Chat
  CHAT_LIST: "/api/v1/ai-chat",
  CHAT_CREATE: "/api/v1/ai-chat",
  CHAT_GET: (id: string) => `/api/v1/ai-chat/${id}`,
  CHAT_MESSAGE: (id: string) => `/api/v1/ai-chat/${id}/message`,
  CHAT_TRANSCRIPT: (id: string) => `/api/v1/ai-chat/${id}/transcript`,

  // Anonymous chat
  ANONYMOUS_CHAT: "/api/v1/ai-chat/anonymous-chat",

  // Releases
  RELEASE_LIST: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/releases`,
  RELEASE_GET: (id: string) => `/api/v1/whitelabel-releases/${id}`,

  // RAG
  RAG_COLLECTIONS: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/rag-vector`,
  RAG_UPLOAD: (workspaceId: string, ragId: string) => `/api/v1/whitelabel/${workspaceId}/rag-vector/${ragId}/file`,
  RAG_SEARCH: (workspaceId: string, ragId: string) => `/api/v1/whitelabel/${workspaceId}/rag-vector/${ragId}/search`,

  // Workspaces
  WORKSPACE_LIST: "/api/v1/whitelabel",
  WORKSPACE_GET: (id: string) => `/api/v1/whitelabel/${id}`,

  // API Keys
  API_KEY_LIST: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/workspace-api-keys`,
  API_KEY_CREATE: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/workspace-api-keys`,

  // Arena (user-facing)
  ARENA_SELECT_CHAT: (chatId: string, messageId: string) =>
    `/api/v1/ai-chat/${chatId}/message/${messageId}/arena-select`,
  ARENA_SELECT_TRANSCRIPT: (workspaceId: string, transcriptId: string, messageId: string) =>
    `/api/v1/whitelabel/${workspaceId}/transcript/${transcriptId}/message/${messageId}/arena-select`,
  ARENA_REGENERATE_VARIANT: (workspaceId: string, transcriptId: string, messageId: string) =>
    `/api/v1/whitelabel/${workspaceId}/transcript/${transcriptId}/message/${messageId}/arena-regenerate-variant`,

  // Arena (management)
  ARENA_ENABLE: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/enable`,
  ARENA_DISABLE: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/disable`,
  ARENA_RESULTS: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/results`,
  ARENA_TEST: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/test`,
  ARENA_TEST_SELECT: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/test-select`,
  ARENA_COST_ESTIMATE: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/cost-estimate`,

  // Arena presets
  ARENA_PRESETS: (workspaceId: string) => `/api/v1/whitelabel/${workspaceId}/arena/presets`,
  ARENA_PRESET: (workspaceId: string, presetId: string) =>
    `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}`,
  ARENA_PRESET_ACTIVATE: (workspaceId: string, presetId: string) =>
    `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}/activate`,
  ARENA_PRESET_EXPORT: (workspaceId: string, presetId: string) =>
    `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}/export`,
  ARENA_PRESETS_IMPORT: (workspaceId: string) =>
    `/api/v1/whitelabel/${workspaceId}/arena/presets/import`,
  ARENA_PRESET_RESULTS: (workspaceId: string, presetId: string) =>
    `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}/results`,

  // Arena routing estimate (QA integration)
  ARENA_ROUTING_ESTIMATE: (workspaceId: string) =>
    `/api/v1/whitelabel/${workspaceId}/qa/auto-fix/arena-routing-estimate`,

  // MCP
  /** Streamable HTTP — the only supported transport (/sse retired 2026-08-07). */
  MCP_STREAMABLE_HTTP: "/mcp",
  MCP_PRICING: "/pricing",
} as const;
