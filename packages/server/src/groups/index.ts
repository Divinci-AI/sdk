/**
 * Group Client
 *
 * Server-side user group management operations
 */

import { ServerHttpClient } from "../http-client.js";

export interface Group {
  id: string;
  name: string;
  slug: string;
  ownerUser: string;
  users: Array<{ userId: string; email: string }>;
  invitations: string[];
}

export interface CreateGroupOptions {
  name: string;
  slug: string;
}

export interface UpdateGroupOptions {
  name: string;
}

export class GroupClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  async list(): Promise<{ groups: Group[] }> {
    return this.httpClient.get<{ groups: Group[] }>("/api/v1/groups");
  }

  async get(groupId: string): Promise<{ group: Group }> {
    return this.httpClient.get<{ group: Group }>(`/api/v1/groups/${groupId}`);
  }

  async create(options: CreateGroupOptions): Promise<{ group: Group }> {
    return this.httpClient.post<{ group: Group }>("/api/v1/groups", options);
  }

  async update(groupId: string, options: UpdateGroupOptions): Promise<{ group: Group }> {
    return this.httpClient.patch<{ group: Group }>(`/api/v1/groups/${groupId}`, options);
  }

  async delete(groupId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/groups/${groupId}`);
  }

  async invite(groupId: string, email: string): Promise<void> {
    await this.httpClient.post(`/api/v1/groups/${groupId}/invite`, { email });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/groups/${groupId}/members`, { userId });
  }

  async removeInvite(groupId: string, email: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/groups/${groupId}/invite`, { email });
  }
}
