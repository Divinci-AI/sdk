/**
 * MCP Transport Layer
 */

export { StreamableHttpTransport } from "./streamable-http.js";
export type {
  StreamableHttpTransportOptions,
  StreamableHttpTransportEvents,
} from "./streamable-http.js";

/** @deprecated Use StreamableHttpTransport — Divinci /sse is retired. */
export { SseTransport } from "./sse.js";
/** @deprecated Use StreamableHttpTransportOptions. */
export type { SseTransportOptions, SseTransportEvents } from "./sse.js";

export type { McpTransport, McpTransportEvents } from "./types.js";
