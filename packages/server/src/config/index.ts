/**
 * Config Client
 *
 * Server-side workspace configuration operations
 */

import { ServerHttpClient } from "../http-client.js";

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace ID */
  workspaceId: string;
  /** Workspace title */
  title?: string;
  /** Workspace description */
  description?: string;
  /** Additional configuration */
  [key: string]: unknown;
}

/**
 * Config client for server-side operations
 */
export class ConfigClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Get workspace configuration
   */
  async get(workspaceId: string): Promise<WorkspaceConfig> {
    return this.httpClient.get<WorkspaceConfig>(`/api/v1/config`, {
      workspaceId,
    });
  }

  /**
   * Update workspace title
   */
  async updateTitle(workspaceId: string, title: string): Promise<WorkspaceConfig> {
    return this.httpClient.patch<WorkspaceConfig>(`/api/v1/config/title`, {
      workspaceId,
      title,
    });
  }

  /**
   * Update workspace description
   */
  async updateDescription(workspaceId: string, description: string): Promise<WorkspaceConfig> {
    return this.httpClient.patch<WorkspaceConfig>(`/api/v1/config/description`, {
      workspaceId,
      description,
    });
  }
}
