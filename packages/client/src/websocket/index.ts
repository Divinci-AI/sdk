/**
 * WebSocket module
 *
 * Provides WebSocket connectivity with automatic reconnection
 * and cookie-based authentication.
 */

export {
  ManagedWebSocket,
  EventEmitter,
  type WebSocketState,
  type WebSocketOptions,
} from "./managed-websocket.js";

export {
  WebSocketManager,
  ChatWebSocket,
  TranscriptWebSocket,
  type WebSocketManagerConfig,
} from "./manager.js";
