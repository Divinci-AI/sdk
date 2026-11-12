/**
 * WebSocketManager
 *
 * Manages WebSocket connections with secure ticket-based authentication.
 * Tickets are short-lived (30s), single-use tokens that prevent JWT leakage in logs.
 *
 * Authentication flow:
 * 1. SDK calls POST /websocket/ticket with JWT in Authorization header
 * 2. Server returns a short-lived, single-use ticket
 * 3. SDK connects to WebSocket with ?ticket=<ticket>
 * 4. Server validates and consumes ticket, authenticating the connection
 *
 * @example
 * ```typescript
 * const sdk = new DivinciClient({ userToken: "...", releaseId: "..." });
 *
 * // Connect to chat updates
 * const chatWs = await sdk.websocket.connectToChat("chat-123");
 * chatWs.onMessage.subscribe((event) => {
 *   console.log("Update:", event.data);
 * });
 *
 * // Connect to workspace transcript updates
 * const transcriptWs = await sdk.websocket.connectToTranscript("ws-123", "t-456");
 * ```
 */

import type { TokenStorage } from "../http-client.js";
import {
  ManagedWebSocket,
  type WebSocketOptions,
  type WebSocketState,
} from "./managed-websocket.js";
import { AuthenticationError, DivinciError } from "../errors.js";

/**
 * WebSocket ticket response from server
 */
interface WebSocketTicketResponse {
  ticket: string;
  expiresIn: number;
  expiresAt: string;
}

/**
 * WebSocket manager configuration
 */
export interface WebSocketManagerConfig {
  /** Base URL for WebSocket connections (e.g., "wss://live.divinci.app") */
  wsBaseUrl: string;
  /** Base URL for HTTP API (for ticket endpoint, e.g., "https://live.divinci.app") */
  liveBaseUrl: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Typed WebSocket for chat updates
 */
export class ChatWebSocket {
  constructor(private readonly ws: ManagedWebSocket) {}

  /** Message event (raw) */
  get onMessage() {
    return this.ws.onMessage;
  }

  /** State change event */
  get onStateChange() {
    return this.ws.onStateChange;
  }

  /** Reconnecting event */
  get onReconnecting() {
    return this.ws.onReconnecting;
  }

  /** Error event */
  get onError() {
    return this.ws.onError;
  }

  /** Current state */
  get state(): WebSocketState {
    return this.ws.state;
  }

  /** Check if connected */
  get isOpen(): boolean {
    return this.ws.isOpen;
  }

  /** Close the connection */
  close(): void {
    this.ws.close();
  }

  /** Clean up resources */
  destroy(): void {
    this.ws.destroy();
  }
}

/**
 * Typed WebSocket for transcript updates
 */
export class TranscriptWebSocket {
  constructor(private readonly ws: ManagedWebSocket) {}

  /** Message event (raw) */
  get onMessage() {
    return this.ws.onMessage;
  }

  /** State change event */
  get onStateChange() {
    return this.ws.onStateChange;
  }

  /** Reconnecting event */
  get onReconnecting() {
    return this.ws.onReconnecting;
  }

  /** Error event */
  get onError() {
    return this.ws.onError;
  }

  /** Current state */
  get state(): WebSocketState {
    return this.ws.state;
  }

  /** Check if connected */
  get isOpen(): boolean {
    return this.ws.isOpen;
  }

  /** Close the connection */
  close(): void {
    this.ws.close();
  }

  /** Clean up resources */
  destroy(): void {
    this.ws.destroy();
  }
}

/**
 * WebSocketManager class
 *
 * Handles WebSocket connections with secure ticket-based authentication.
 * Tickets are short-lived (30s), single-use tokens obtained from the server
 * before connecting to WebSocket endpoints.
 */
export class WebSocketManager {
  private readonly config: WebSocketManagerConfig;
  private readonly tokenStorage: TokenStorage;
  private readonly connections: Map<string, ManagedWebSocket> = new Map();

  constructor(
    config: WebSocketManagerConfig,
    tokenStorage: TokenStorage
  ) {
    this.config = config;
    this.tokenStorage = tokenStorage;
  }

  /**
   * Get authentication token from storage
   */
  private async getToken(): Promise<string> {
    const token = await this.tokenStorage.getToken();
    if (!token) {
      throw new AuthenticationError("No auth token available for WebSocket connection");
    }
    return token;
  }

  /**
   * Get a short-lived ticket for WebSocket authentication
   *
   * Calls POST /websocket/ticket to exchange the JWT for a single-use ticket.
   * This prevents the JWT from appearing in WebSocket URLs and server logs.
   *
   * @param purpose - Optional purpose hint (chat, transcript, notifications)
   * @param resourceId - Optional resource ID for audit logging
   */
  async getTicket(purpose?: "chat" | "transcript" | "notifications", resourceId?: string): Promise<WebSocketTicketResponse> {
    const token = await this.getToken();

    const response = await fetch(`${this.config.liveBaseUrl}/websocket/ticket`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        purpose,
        resourceId,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthenticationError("Failed to get WebSocket ticket: unauthorized");
      }
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = {};
      }
      throw DivinciError.fromResponse({
        code: (errorData as Record<string, unknown>).code as string || "TICKET_ERROR",
        message: (errorData as Record<string, unknown>).message as string || "Failed to get WebSocket ticket",
        status: response.status,
      });
    }

    const ticketText = await response.text();
    let data: WebSocketTicketResponse;
    try {
      data = JSON.parse(ticketText) as WebSocketTicketResponse;
    } catch {
      throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${ticketText.substring(0, 200)}`);
    }

    if (this.config.debug) {
      console.log(`[WebSocketManager] Got ticket, expires in ${data.expiresIn}s`);
    }

    return data;
  }

  /**
   * Build WebSocket URL with ticket query parameter
   *
   * @param path - WebSocket endpoint path
   * @param purpose - Optional purpose for ticket audit
   * @param resourceId - Optional resource ID for ticket audit
   */
  private async buildUrl(
    path: string,
    purpose?: "chat" | "transcript" | "notifications",
    resourceId?: string
  ): Promise<string> {
    // Get a short-lived ticket for this connection
    const { ticket } = await this.getTicket(purpose, resourceId);

    // Ensure path starts with /
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    // Build URL with ticket as query parameter
    const url = new URL(`${this.config.wsBaseUrl}${normalizedPath}`);
    url.searchParams.set("ticket", ticket);

    return url.toString();
  }

  /**
   * Connect to a WebSocket endpoint
   *
   * A short-lived ticket is automatically obtained and added as a query parameter
   * for secure authentication.
   *
   * @param path - WebSocket endpoint path
   * @param options - WebSocket connection options
   * @param purpose - Optional purpose hint for ticket audit
   * @param resourceId - Optional resource ID for ticket audit
   *
   * @example
   * ```typescript
   * const ws = await manager.connect("/ai-chat/chat-123/transcript");
   * ws.onMessage.subscribe((event) => console.log(event.data));
   * ```
   */
  async connect(
    path: string,
    options?: WebSocketOptions,
    purpose?: "chat" | "transcript" | "notifications",
    resourceId?: string
  ): Promise<ManagedWebSocket> {
    // Build URL with ticket
    const url = await this.buildUrl(path, purpose, resourceId);

    if (this.config.debug) {
      console.log(`[WebSocketManager] Connecting to: ${path}`);
    }

    const ws = new ManagedWebSocket(url, {
      debug: this.config.debug,
      ...options,
    });

    // Track connection
    this.connections.set(path, ws);

    // Clean up when closed
    ws.onStateChange.subscribe((state) => {
      if (state === "closed") {
        this.connections.delete(path);
      }
    });

    return ws;
  }

  /**
   * Connect to chat transcript updates
   *
   * @example
   * ```typescript
   * const chatWs = await manager.connectToChat("chat-123");
   * chatWs.onMessage.subscribe((event) => {
   *   const update = JSON.parse(event.data);
   *   console.log("New message:", update);
   * });
   * ```
   */
  async connectToChat(
    chatId: string,
    options?: WebSocketOptions
  ): Promise<ChatWebSocket> {
    const ws = await this.connect(
      `/ai-chat/${chatId}/transcript`,
      options,
      "chat",
      chatId
    );
    return new ChatWebSocket(ws);
  }

  /**
   * Connect to workspace transcript updates
   *
   * @example
   * ```typescript
   * const transcriptWs = await manager.connectToTranscript("ws-123", "t-456");
   * transcriptWs.onMessage.subscribe((event) => {
   *   const update = JSON.parse(event.data);
   *   console.log("Transcript update:", update);
   * });
   * ```
   */
  async connectToTranscript(
    workspaceId: string,
    transcriptId: string,
    options?: WebSocketOptions
  ): Promise<TranscriptWebSocket> {
    const ws = await this.connect(
      `/white-label/${workspaceId}/transcript/${transcriptId}`,
      options,
      "transcript",
      transcriptId
    );
    return new TranscriptWebSocket(ws);
  }

  /**
   * Close all active connections
   */
  closeAll(): void {
    for (const ws of this.connections.values()) {
      ws.close();
    }
    this.connections.clear();
  }

  /**
   * Get count of active connections
   */
  get connectionCount(): number {
    return this.connections.size;
  }
}
