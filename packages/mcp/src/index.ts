/**
 * @divinci-ai/mcp
 *
 * Divinci AI MCP (Model Context Protocol) SDK
 */

// Main client
export { McpClient, createMcpClient } from "./client.js";
export type { McpClientEvents } from "./client.js";

// Types
export * from "./types.js";

// Transport — Streamable HTTP is the default; SSE is deprecated for Divinci.
export {
  StreamableHttpTransport,
  SseTransport,
} from "./transport/index.js";
export type {
  StreamableHttpTransportOptions,
  StreamableHttpTransportEvents,
  SseTransportOptions,
  SseTransportEvents,
  McpTransport,
  McpTransportEvents,
} from "./transport/index.js";

// Auth
export { Auth0Handler } from "./auth/index.js";
export type { Auth0TokenResponse, Auth0UserInfo, TokenStorage } from "./auth/index.js";

// Tools
export { ToolClient, ToolBuilder, PaymentRequiredError } from "./tools/index.js";
export type { ToolInvokeOptions } from "./tools/index.js";
