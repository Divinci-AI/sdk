/**
 * MCP Servers Client (Phase 1 — management)
 *
 * Manage a workspace's external MCP servers (url/transport/auth) that the
 * assistant will be able to use as tool sources. Phase 1 is CRUD only; Phase 2
 * wires a runtime MCP client into the chat tool-loop.
 *
 * The bearer token is write-only: pass it on create/update; it's stored
 * encrypted and never returned (the view exposes only `authType` + `hasAuth`).
 */

import { ServerHttpClient } from "../http-client.js";

export type McpTransport = "http" | "sse" | "websocket";
export type McpAuthType = "none" | "bearer";

export interface McpServerView {
  id: string;
  name: string;
  transport: McpTransport;
  url: string;
  authType: McpAuthType;
  /** True when a bearer token is stored (never returned). */
  hasAuth: boolean;
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateMcpServerInput {
  name: string;
  transport: McpTransport;
  url: string;
  authType?: McpAuthType;
  /** Bearer token (write-only; stored encrypted). */
  authToken?: string;
  enabled?: boolean;
}

export interface UpdateMcpServerInput {
  name?: string;
  transport?: McpTransport;
  url?: string;
  authType?: McpAuthType;
  authToken?: string;
  enabled?: boolean;
}

export class McpServersClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** The workspace's configured external MCP servers. */
  async list(): Promise<McpServerView[]> {
    return this.httpClient.get<McpServerView[]>("/api/v1/mcp-servers");
  }

  /** One configured server by id. */
  async get(mcpServerId: string): Promise<McpServerView> {
    return this.httpClient.get<McpServerView>(
      `/api/v1/mcp-servers/${encodeURIComponent(mcpServerId)}`,
    );
  }

  /** Add an external MCP server. */
  async create(input: CreateMcpServerInput): Promise<McpServerView> {
    return this.httpClient.post<McpServerView>("/api/v1/mcp-servers", input);
  }

  /** Update a configured server (name/transport/url/auth/enabled). */
  async update(mcpServerId: string, input: UpdateMcpServerInput): Promise<McpServerView> {
    return this.httpClient.patch<McpServerView>(
      `/api/v1/mcp-servers/${encodeURIComponent(mcpServerId)}`,
      input,
    );
  }

  /** Remove a configured server. */
  async remove(mcpServerId: string): Promise<{ deleted: boolean }> {
    return this.httpClient.delete<{ deleted: boolean }>(
      `/api/v1/mcp-servers/${encodeURIComponent(mcpServerId)}`,
    );
  }
}
