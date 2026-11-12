/**
 * MCP Client
 *
 * Main entry point for the Divinci MCP SDK
 */

import type {
  McpClientOptions,
  McpAuthOptions,
  McpPaymentOptions,
  McpServerCapabilities,
  McpTool,
  McpResource,
  McpPrompt,
  McpConnectionState,
  McpWallet,
} from "./types.js";
import { StreamableHttpTransport } from "./transport/streamable-http.js";
import type { McpTransport } from "./transport/types.js";
import { Auth0Handler } from "./auth/auth0.js";
import { ToolClient } from "./tools/index.js";

/**
 * MCP client event handlers
 */
export interface McpClientEvents {
  /** Connection state changed */
  onStateChange?: (state: McpConnectionState) => void;
  /** Tool list changed */
  onToolsChanged?: (tools: McpTool[]) => void;
  /** Resource list changed */
  onResourcesChanged?: (resources: McpResource[]) => void;
  /** Error occurred */
  onError?: (error: Error) => void;
}

/**
 * MCP Client class
 *
 * @example
 * ```typescript
 * const mcp = new McpClient({
 *   serverUrl: "https://mcp.divinci.app",
 *   auth: {
 *     auth0Domain: "divinci.us.auth0.com",
 *     auth0ClientId: "your-client-id",
 *   },
 * });
 *
 * // Connect
 * await mcp.connect();
 *
 * // Authenticate
 * const authUrl = await mcp.getAuthUrl();
 * // Redirect user to authUrl...
 *
 * // After redirect, exchange code
 * await mcp.handleAuthCallback(code);
 *
 * // List tools
 * const tools = await mcp.tools.listTools();
 *
 * // Call a tool
 * const result = await mcp.tools.callTool("search", { query: "hello" });
 * ```
 */
export class McpClient {
  private readonly options: Required<McpClientOptions>;
  private readonly transport: McpTransport;
  private readonly auth: Auth0Handler | null;
  private readonly toolClient: ToolClient;
  private serverCapabilities: McpServerCapabilities | null = null;
  private events: McpClientEvents = {};

  constructor(options: McpClientOptions & {
    auth?: McpAuthOptions;
    payment?: McpPaymentOptions;
    /** Override transport (defaults to Streamable HTTP at `{serverUrl}/mcp`). */
    transport?: McpTransport;
  }) {
    this.options = {
      clientName: "divinci-mcp-client",
      clientVersion: "0.1.0",
      timeout: 30000,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      debug: false,
      ...options,
    };

    // Streamable HTTP is the only transport Divinci serves (SSE retired 2026-08-07).
    this.transport =
      options.transport ??
      new StreamableHttpTransport({
        mcpUrl: `${this.options.serverUrl.replace(/\/$/, "")}/mcp`,
        timeout: this.options.timeout,
        debug: this.options.debug,
      });

    // Initialize auth if configured
    this.auth = options.auth ? new Auth0Handler(options.auth) : null;

    // Initialize tool client
    this.toolClient = new ToolClient(this.transport, options.payment);

    // Set up transport event handlers
    this.transport.on({
      onStateChange: (state) => {
        this.events.onStateChange?.(state);
      },
      onMessage: (message) => {
        this.handleNotification(message);
      },
      onError: (error) => {
        this.events.onError?.(error);
      },
    });
  }

  /**
   * Set event handlers
   */
  on(events: McpClientEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * Get tool client
   */
  get tools(): ToolClient {
    return this.toolClient;
  }

  /**
   * Get current connection state
   */
  getState(): McpConnectionState {
    return this.transport.getState();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    const state = this.getState();
    return state === "connected" || state === "authenticated";
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    if (!this.auth) {
      return false;
    }
    return this.auth.isAuthenticated();
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    // Set auth token if available
    if (this.auth) {
      const token = await this.auth.getAccessToken();
      if (token) {
        this.transport.setAuthToken(token);
      }
    }

    await this.transport.connect();
    await this.initialize();
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    this.transport.disconnect();
    this.serverCapabilities = null;
  }

  /**
   * Get authorization URL for Auth0 login
   */
  async getAuthUrl(state?: string): Promise<string> {
    if (!this.auth) {
      throw new Error("Auth not configured");
    }
    return this.auth.getAuthorizationUrl(state);
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  async handleAuthCallback(code: string): Promise<void> {
    if (!this.auth) {
      throw new Error("Auth not configured");
    }

    await this.auth.exchangeCode(code);

    // Update transport with new token
    const token = await this.auth.getAccessToken();
    if (token) {
      this.transport.setAuthToken(token);
    }

    // Re-initialize if connected
    if (this.isConnected()) {
      await this.initialize();
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    if (this.auth) {
      await this.auth.logout();
    }
    this.disconnect();
  }

  /**
   * Get logout URL
   */
  getLogoutUrl(returnTo?: string): string {
    if (!this.auth) {
      throw new Error("Auth not configured");
    }
    return this.auth.getLogoutUrl(returnTo);
  }

  /**
   * Set wallet for x402 payments
   */
  setWallet(wallet: McpWallet): void {
    this.toolClient.setWallet(wallet);
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(): McpServerCapabilities | null {
    return this.serverCapabilities;
  }

  /**
   * List available resources
   */
  async listResources(): Promise<McpResource[]> {
    const result = await this.transport.request<{ resources: McpResource[] }>(
      "resources/list"
    );
    return result.resources;
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> {
    return this.transport.request("resources/read", { uri });
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<McpPrompt[]> {
    const result = await this.transport.request<{ prompts: McpPrompt[] }>(
      "prompts/list"
    );
    return result.prompts;
  }

  /**
   * Get a prompt
   */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<{ messages: Array<{ role: string; content: unknown }> }> {
    return this.transport.request("prompts/get", { name, arguments: args });
  }

  /**
   * Send a ping to check connection
   */
  async ping(): Promise<void> {
    await this.transport.request("ping");
  }

  /**
   * Initialize connection (handshake)
   */
  private async initialize(): Promise<void> {
    // Send initialize request
    const result = await this.transport.request<McpServerCapabilities>("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      clientInfo: {
        name: this.options.clientName,
        version: this.options.clientVersion,
      },
    });

    this.serverCapabilities = result;

    // Send initialized notification
    await this.transport.notify("notifications/initialized");

    this.log("Initialized with server:", result.name, result.version);
  }

  /**
   * Handle server notifications
   */
  private handleNotification(message: unknown): void {
    const notification = message as { method?: string; params?: unknown };

    switch (notification.method) {
      case "notifications/tools/list_changed":
        this.handleToolsChanged();
        break;
      case "notifications/resources/list_changed":
        this.handleResourcesChanged();
        break;
      default:
        this.log("Unhandled notification:", notification.method);
    }
  }

  /**
   * Handle tools list changed notification
   */
  private async handleToolsChanged(): Promise<void> {
    try {
      const tools = await this.toolClient.listTools();
      this.events.onToolsChanged?.(tools);
    } catch (error) {
      this.log("Failed to refresh tools:", error);
    }
  }

  /**
   * Handle resources list changed notification
   */
  private async handleResourcesChanged(): Promise<void> {
    try {
      const resources = await this.listResources();
      this.events.onResourcesChanged?.(resources);
    } catch (error) {
      this.log("Failed to refresh resources:", error);
    }
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log("[MCP Client]", ...args);
    }
  }
}

/**
 * Create an MCP client instance
 */
export function createMcpClient(
  options: McpClientOptions & {
    auth?: McpAuthOptions;
    payment?: McpPaymentOptions;
  }
): McpClient {
  return new McpClient(options);
}
