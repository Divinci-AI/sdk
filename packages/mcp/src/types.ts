/**
 * MCP (Model Context Protocol) Types
 *
 * Based on the MCP specification from Anthropic
 */

/**
 * MCP JSON-RPC request
 */
export interface McpRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: T;
}

/**
 * MCP JSON-RPC response
 */
export interface McpResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: McpError;
}

/**
 * MCP JSON-RPC error
 */
export interface McpError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * MCP notification (no response expected)
 */
export interface McpNotification<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
}

/**
 * MCP server capabilities
 */
export interface McpServerCapabilities {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Protocol version supported */
  protocolVersion: string;
  /** Available capabilities */
  capabilities: {
    /** Tool capabilities */
    tools?: {
      /** Whether tool list can change */
      listChanged?: boolean;
    };
    /** Resource capabilities */
    resources?: {
      /** Whether resource list can change */
      listChanged?: boolean;
      /** Whether subscriptions are supported */
      subscribe?: boolean;
    };
    /** Prompt capabilities */
    prompts?: {
      /** Whether prompt list can change */
      listChanged?: boolean;
    };
    /** Logging capabilities */
    logging?: Record<string, never>;
  };
}

/**
 * MCP tool definition
 */
export interface McpTool {
  /** Tool name */
  name: string;
  /** Tool description */
  description?: string;
  /** JSON Schema for input parameters */
  inputSchema: McpToolInputSchema;
  /** Pricing information (x402) */
  pricing?: McpToolPricing;
}

/**
 * MCP tool input schema (JSON Schema)
 */
export interface McpToolInputSchema {
  type: "object";
  properties?: Record<string, McpToolProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * MCP tool property schema
 */
export interface McpToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: McpToolProperty;
  properties?: Record<string, McpToolProperty>;
}

/**
 * MCP tool pricing (x402)
 */
export interface McpToolPricing {
  /** Price in USD */
  priceUsd: number;
  /** Price in micro-units */
  priceMicro: number;
  /** Payment network */
  network: string;
  /** Payment asset */
  asset: string;
  /** Recipient address */
  recipient: string;
}

/**
 * MCP tool call request
 */
export interface McpToolCallParams {
  /** Tool name */
  name: string;
  /** Tool arguments */
  arguments?: Record<string, unknown>;
}

/**
 * MCP tool call result
 */
export interface McpToolCallResult {
  /** Result content */
  content: McpContent[];
  /** Whether the tool call is an error */
  isError?: boolean;
}

/**
 * MCP content types
 */
export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

/**
 * MCP text content
 */
export interface McpTextContent {
  type: "text";
  text: string;
}

/**
 * MCP image content
 */
export interface McpImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * MCP resource content
 */
export interface McpResourceContent {
  type: "resource";
  resource: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

/**
 * MCP resource definition
 */
export interface McpResource {
  /** Resource URI */
  uri: string;
  /** Resource name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type */
  mimeType?: string;
}

/**
 * MCP prompt definition
 */
export interface McpPrompt {
  /** Prompt name */
  name: string;
  /** Prompt description */
  description?: string;
  /** Prompt arguments */
  arguments?: McpPromptArgument[];
}

/**
 * MCP prompt argument
 */
export interface McpPromptArgument {
  /** Argument name */
  name: string;
  /** Argument description */
  description?: string;
  /** Whether argument is required */
  required?: boolean;
}

/**
 * MCP prompt message
 */
export interface McpPromptMessage {
  role: "user" | "assistant";
  content: McpContent;
}

/**
 * MCP connection state
 */
export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "authenticating"
  | "authenticated"
  | "error";

/**
 * MCP client options
 */
export interface McpClientOptions {
  /** MCP server URL */
  serverUrl: string;
  /** Client name */
  clientName?: string;
  /** Client version */
  clientVersion?: string;
  /** Connection timeout (ms) */
  timeout?: number;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * MCP authentication options
 */
export interface McpAuthOptions {
  /** Auth0 domain */
  auth0Domain: string;
  /** Auth0 client ID */
  auth0ClientId: string;
  /** Auth0 audience */
  auth0Audience?: string;
  /** Redirect URI for OAuth */
  redirectUri?: string;
  /** Scopes to request */
  scopes?: string[];
}

/**
 * MCP x402 payment options
 */
export interface McpPaymentOptions {
  /** Enable automatic payments */
  autoPayment?: boolean;
  /** Maximum payment per request (USD) */
  maxPaymentUsd?: number;
  /** Payment network */
  network?: "base" | "base-sepolia";
  /** Wallet for payments */
  wallet?: McpWallet;
}

/**
 * MCP wallet interface for x402 payments
 */
export interface McpWallet {
  /** Get wallet address */
  getAddress(): Promise<string>;
  /** Sign and send payment */
  pay(details: McpPaymentDetails): Promise<McpPaymentReceipt>;
}

/**
 * MCP payment details
 */
export interface McpPaymentDetails {
  /** Amount in USD */
  amountUsd: number;
  /** Amount in micro-units */
  amountMicro: number;
  /** Recipient address */
  recipient: string;
  /** Network */
  network: string;
  /** Tool name */
  toolName: string;
  /** Facilitator URL */
  facilitatorUrl: string;
}

/**
 * MCP payment receipt
 */
export interface McpPaymentReceipt {
  /** Transaction hash */
  transactionHash: string;
  /** Network */
  network: string;
  /** Recipient */
  recipient: string;
  /** Amount paid (USD) */
  amountUsd: number;
  /** Timestamp */
  timestamp: number;
  /** Facilitator signature */
  signature: string;
}
