/**
 * Permission Client
 *
 * Server-side permission management operations
 */

import { ServerHttpClient } from "../http-client.js";

export interface PermissionDoc {
  target: string;
  ownerUser: string;
  userPermissions: Record<string, { userId: string; email: string; permissions: string[] }>;
  group: Record<string, { groupSlug: string; permissions: string[] }>;
  loggedInPermissions: { permissions: string[] };
  anonymousPermissions: { permissions: string[] };
  userInvitations: Record<string, { email: string; permissions: string[] }>;
}

export class PermissionClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  async get(): Promise<{ permissions: PermissionDoc; validPermissions: string[] }> {
    return this.httpClient.get("/api/v1/permissions");
  }

  async getMine(): Promise<{ permissions: string[] }> {
    return this.httpClient.get("/api/v1/permissions/mine");
  }

  async grantToUser(email: string, permissions: string[]): Promise<void> {
    await this.httpClient.post("/api/v1/permissions/users", { email, permissions });
  }

  async revokeFromUser(options: { userId?: string; email?: string }): Promise<void> {
    await this.httpClient.delete("/api/v1/permissions/users", options);
  }

  async grantToGroup(groupSlug: string, permissions: string[]): Promise<void> {
    await this.httpClient.post("/api/v1/permissions/groups", { groupSlug, permissions });
  }

  async revokeFromGroup(groupSlug: string): Promise<void> {
    await this.httpClient.delete("/api/v1/permissions/groups", { groupSlug });
  }

  async setLoggedIn(permissions: string[]): Promise<void> {
    await this.httpClient.post("/api/v1/permissions/logged-in", { permissions });
  }

  async setAnonymous(permissions: string[]): Promise<void> {
    await this.httpClient.post("/api/v1/permissions/anonymous", { permissions });
  }
}
