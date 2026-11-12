/**
 * Workspace Client
 *
 * Server-side workspace management operations
 */

import type {
  Workspace,
  CreateWorkspaceOptions,
  UpdateWorkspaceOptions,
  ListWorkspacesOptions,
  PaginatedResponse,
  BaaAgreement,
  HipaaCreationResult,
} from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

/**
 * Workspace client for server-side operations
 */
export class WorkspaceClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List workspaces accessible to the API key
   */
  async list(options: ListWorkspacesOptions = {}): Promise<PaginatedResponse<Workspace>> {
    // Wire shape is `{ workspaces: [...] }` (api/v1/routes/workspaces.ts), not
    // the declared PaginatedResponse — normalize here so the SDK contract holds.
    const res = await this.httpClient.get<
      Partial<PaginatedResponse<Workspace>> & { workspaces?: Workspace[] }
    >("/api/v1/workspaces", {
      role: options.role,
      limit: options.limit,
      cursor: options.cursor,
    });
    const items = Array.isArray(res?.data) ? res.data : (res?.workspaces ?? []);
    return {
      data: items.map(normalizeWorkspace),
      hasMore: res?.hasMore ?? false,
      nextCursor: res?.nextCursor,
      total: res?.total ?? items.length,
    };
  }

  /**
   * Get a workspace by ID
   */
  async get(workspaceId: string): Promise<Workspace> {
    const res = await this.httpClient.get<WorkspaceWire>(`/api/v1/workspaces/${workspaceId}`);
    return normalizeWorkspace(res);
  }

  /**
   * Create a new workspace — or, with `onboardingHost`, find-or-create the one
   * that already belongs to that website.
   *
   * `created` says which happened. It is carried through from the wire because
   * a caller that asked for find-or-create needs to distinguish "I made this"
   * from "this already existed" — and the HTTP 201-vs-200 that carries the same
   * news is invisible by the time the value reaches a script.
   */
  async create(
    options: CreateWorkspaceOptions,
  ): Promise<Workspace & { created?: boolean; hipaa?: HipaaCreationResult }> {
    const { name, ...rest } = options;
    const res = await this.httpClient.post<
      WorkspaceWire & { created?: boolean; hipaa?: HipaaCreationResult }
    >(
      "/api/v1/workspaces",
      { title: name, ...rest },
    );
    const workspace = normalizeWorkspace(res) as Workspace & {
      created?: boolean;
      hipaa?: HipaaCreationResult;
    };
    if (res && typeof res === "object" && typeof res.created === "boolean") {
      workspace.created = res.created;
    }
    // Carried back like `created`: it holds `chatBlockedUntilVendorBaa`, which a
    // caller must be able to show — a scoped workspace that silently refuses
    // chat reads as a bug.
    if (res && typeof res === "object" && res.hipaa && typeof res.hipaa === "object") {
      workspace.hipaa = res.hipaa;
    }
    return workspace;
  }

  /**
   * The Business Associate Agreement, for a create request that sets `hipaa`.
   *
   * `available` is false until counsel approves the text; creating with `hipaa`
   * is refused until then, so check it first rather than collecting signer
   * details that cannot be used.
   */
  async getBaaAgreement(): Promise<BaaAgreement> {
    return this.httpClient.get<BaaAgreement>("/api/v1/workspaces/baa-agreement");
  }

  /**
   * Update a workspace
   */
  async update(workspaceId: string, options: UpdateWorkspaceOptions): Promise<Workspace> {
    const { name, ...rest } = options;
    const body = name !== undefined ? { title: name, ...rest } : rest;
    const res = await this.httpClient.patch<WorkspaceWire>(
      `/api/v1/workspaces/${workspaceId}`,
      body,
    );
    return normalizeWorkspace(res);
  }

  /**
   * Delete a workspace
   */
  async delete(workspaceId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/workspaces/${workspaceId}`);
  }

  /**
   * Get workspace usage statistics
   */
  async getUsage(
    workspaceId: string,
    period: "day" | "week" | "month" = "month"
  ): Promise<WorkspaceUsage> {
    return this.httpClient.get<WorkspaceUsage>(
      `/api/v1/workspaces/${workspaceId}/usage`,
      { period }
    );
  }

  /**
   * Invite a user to this workspace with the given permissions (e.g.
   * WHITELABEL_ENUM values like "editConfig", "delete"). Uses the same
   * OAuth-session-based route the web app's Settings > Permissions page
   * calls (`POST /white-label/:id/permission/invite-user`) — distinct from
   * `client.permissions`, which talks to the API-key-only `/api/v1/permissions`
   * surface meant for third-party integrations, not a logged-in human
   * managing their own workspace.
   */
  async inviteUser(
    workspaceId: string,
    options: { email: string; permissions: string[] },
  ): Promise<void> {
    await this.httpClient.post(
      `/white-label/${workspaceId}/permission/invite-user`,
      { email: options.email, permissions: options.permissions },
    );
  }
}

/**
 * Workspace usage statistics
 */
export interface WorkspaceUsage {
  /** Workspace ID */
  workspaceId: string;
  /** Period */
  period: "day" | "week" | "month";
  /** Total API calls */
  totalApiCalls: number;
  /** Total tokens used */
  totalTokens: number;
  /** Unique users */
  uniqueUsers: number;
  /** Active chats */
  activeChats: number;
  /** Storage used (bytes) */
  storageUsedBytes: number;
}

/**
 * Raw wire shape for single-workspace responses: api/v1 wraps in
 * `{ workspace: {...} }` and sends Mongo `_id` + `title`.
 */
type WorkspaceWire = Workspace | { workspace?: Workspace & { _id?: string } };

/**
 * Normalize a wire workspace to the declared `Workspace` contract:
 * unwrap `{ workspace }`, alias `_id` → `id`, alias `title` → `name`
 * (both promised by the type docs in @divinci-ai/types).
 */
function normalizeWorkspace(raw: WorkspaceWire): Workspace {
  const unwrapped =
    raw && typeof raw === "object" && "workspace" in raw && raw.workspace
      ? raw.workspace
      : (raw as Workspace & { _id?: string });
  const w = unwrapped as Workspace & { _id?: string };
  if (w && typeof w === "object") {
    if (w.id === undefined && w._id !== undefined) w.id = String(w._id);
    if (w.name === undefined && w.title !== undefined) w.name = w.title;
  }
  return w;
}
