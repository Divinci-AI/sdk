/**
 * Shared transport surface used by McpClient / ToolClient.
 * Implemented by StreamableHttpTransport (default) and SseTransport (legacy).
 */

import type {
  McpConnectionState,
  McpNotification,
  McpResponse,
} from "../types.js";

export interface McpTransportEvents {
  onStateChange?: (state: McpConnectionState) => void;
  onMessage?: (message: McpResponse | McpNotification) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export interface McpTransport {
  on(events: McpTransportEvents): void;
  setAuthToken(token: string): void;
  getState(): McpConnectionState;
  getSessionId(): string | null;
  connect(): Promise<void>;
  disconnect(): void;
  request<T>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): Promise<void>;
}
