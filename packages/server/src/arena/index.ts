/**
 * Arena Client
 *
 * Server-side Arena operations for multi-model comparison management.
 * Includes enabling/disabling arena, viewing results, managing presets,
 * cost estimation, and operator testing.
 *
 * @example
 * ```typescript
 * const divinci = new DivinciServer({ apiKey: "..." });
 *
 * // Enable arena
 * const { experimentId } = await divinci.arena.enable("ws-123", {
 *   variants: [
 *     { name: "GPT-4o", releaseId: "rel-1" },
 *     { name: "Claude 3.5", releaseId: "rel-2" },
 *   ],
 *   showModelNames: true,
 * });
 *
 * // Get results
 * const results = await divinci.arena.getResults("ws-123");
 *
 * // Manage presets
 * const presets = await divinci.arena.presets.list("ws-123");
 * ```
 */

import type {
  ArenaEnableBody,
  ArenaEnableResponse,
  ArenaResultsResponse,
  ArenaTestBody,
  ArenaTestResponse,
  ArenaTestSelectBody,
  ArenaCostEstimateBody,
  ArenaCostEstimateResponse,
  ArenaPreset,
  ArenaPresetExportFormat,
  ArenaPresetActivateResponse,
  ArenaPresetResultsResponse,
  CreateArenaPresetBody,
  UpdateArenaPresetBody,
  ArenaSelectResponse,
  ArenaRegenerateVariantResponse,
  ArenaRoutingEstimateBody,
  ArenaRoutingEstimateResponse,
} from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

// ============================================
// Arena Presets Client
// ============================================

/**
 * Arena Presets client for managing saved arena configurations
 */
export class ArenaPresetsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List all non-archived presets for a workspace
   */
  async list(workspaceId: string): Promise<ArenaPreset[]> {
    const response = await this.httpClient.get<{ presets: ArenaPreset[] }>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets`
    );
    return response.presets;
  }

  /**
   * Create a new arena preset
   */
  async create(
    workspaceId: string,
    body: CreateArenaPresetBody
  ): Promise<ArenaPreset> {
    const response = await this.httpClient.post<{ preset: ArenaPreset }>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets`,
      body
    );
    return response.preset;
  }

  /**
   * Update an arena preset
   */
  async update(
    workspaceId: string,
    presetId: string,
    body: UpdateArenaPresetBody
  ): Promise<ArenaPreset> {
    const response = await this.httpClient.put<{ preset: ArenaPreset }>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}`,
      body
    );
    return response.preset;
  }

  /**
   * Delete (archive) an arena preset
   */
  async delete(workspaceId: string, presetId: string): Promise<void> {
    await this.httpClient.delete(
      `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}`
    );
  }

  /**
   * Activate a preset (applies it as the active arena configuration)
   */
  async activate(
    workspaceId: string,
    presetId: string
  ): Promise<ArenaPresetActivateResponse> {
    return this.httpClient.post<ArenaPresetActivateResponse>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}/activate`,
      {}
    );
  }

  /**
   * Export a preset as portable JSON
   */
  async export(
    workspaceId: string,
    presetId: string
  ): Promise<ArenaPresetExportFormat> {
    return this.httpClient.get<ArenaPresetExportFormat>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}/export`
    );
  }

  /**
   * Import a preset from portable JSON
   */
  async import(
    workspaceId: string,
    body: ArenaPresetExportFormat
  ): Promise<ArenaPreset> {
    const response = await this.httpClient.post<{ preset: ArenaPreset }>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets/import`,
      body
    );
    return response.preset;
  }

  /**
   * Get aggregated results for a preset across all its experiments
   */
  async getResults(
    workspaceId: string,
    presetId: string
  ): Promise<ArenaPresetResultsResponse> {
    return this.httpClient.get<ArenaPresetResultsResponse>(
      `/api/v1/whitelabel/${workspaceId}/arena/presets/${presetId}/results`
    );
  }
}

// ============================================
// Arena Client
// ============================================

/**
 * Arena client for server-side arena management operations
 */
export class ArenaClient {
  private readonly httpClient: ServerHttpClient;
  private presetsClient: ArenaPresetsClient | null = null;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Presets management
   */
  get presets(): ArenaPresetsClient {
    if (!this.presetsClient) {
      this.presetsClient = new ArenaPresetsClient(this.httpClient);
    }
    return this.presetsClient;
  }

  // ==========================================
  // Enable / Disable / Results
  // ==========================================

  /**
   * Enable arena mode for a workspace
   *
   * @example
   * ```typescript
   * const { experimentId, arenaConfig } = await divinci.arena.enable("ws-123", {
   *   variants: [
   *     { name: "GPT-4o", releaseId: "rel-1" },
   *     { name: "Claude 3.5", releaseId: "rel-2" },
   *   ],
   *   showModelNames: true,
   * });
   * ```
   */
  async enable(
    workspaceId: string,
    body: ArenaEnableBody
  ): Promise<ArenaEnableResponse> {
    return this.httpClient.post<ArenaEnableResponse>(
      `/api/v1/whitelabel/${workspaceId}/arena/enable`,
      body
    );
  }

  /**
   * Disable arena mode for a workspace
   */
  async disable(workspaceId: string): Promise<{ status: string }> {
    return this.httpClient.post<{ status: string }>(
      `/api/v1/whitelabel/${workspaceId}/arena/disable`,
      {}
    );
  }

  /**
   * Get arena results (win rates per variant)
   *
   * @example
   * ```typescript
   * const results = await divinci.arena.getResults("ws-123");
   * for (const v of results.variants) {
   *   console.log(`${v.name}: ${v.winRate}% win rate`);
   * }
   * ```
   */
  async getResults(workspaceId: string): Promise<ArenaResultsResponse> {
    return this.httpClient.get<ArenaResultsResponse>(
      `/api/v1/whitelabel/${workspaceId}/arena/results`
    );
  }

  // ==========================================
  // Variant Selection & Regeneration
  // ==========================================

  /**
   * Select a winning arena variant in a chat message
   */
  async selectChatVariant(
    chatId: string,
    messageId: string,
    selectedIndex: number
  ): Promise<ArenaSelectResponse> {
    return this.httpClient.post<ArenaSelectResponse>(
      `/api/v1/ai-chat/${chatId}/message/${messageId}/arena-select`,
      { selectedIndex }
    );
  }

  /**
   * Select a winning arena variant in a workspace transcript message
   */
  async selectTranscriptVariant(
    workspaceId: string,
    transcriptId: string,
    messageId: string,
    selectedIndex: number
  ): Promise<ArenaSelectResponse> {
    return this.httpClient.post<ArenaSelectResponse>(
      `/api/v1/whitelabel/${workspaceId}/transcript/${transcriptId}/message/${messageId}/arena-select`,
      { selectedIndex }
    );
  }

  /**
   * Regenerate a single arena variant with a different AI model
   */
  async regenerateVariant(
    workspaceId: string,
    transcriptId: string,
    messageId: string,
    variantIndex: number,
    assistantId: string
  ): Promise<ArenaRegenerateVariantResponse> {
    return this.httpClient.post<ArenaRegenerateVariantResponse>(
      `/api/v1/whitelabel/${workspaceId}/transcript/${transcriptId}/message/${messageId}/arena-regenerate-variant`,
      { variantIndex, assistantId }
    );
  }

  // ==========================================
  // Testing & Cost Estimation
  // ==========================================

  /**
   * Run a test question through all arena variants (operator evaluation)
   *
   * @example
   * ```typescript
   * const test = await divinci.arena.test("ws-123", {
   *   question: "What is our refund policy?"
   * });
   * for (const v of test.variants) {
   *   console.log(`${v.variantName}: ${v.content.substring(0, 100)}...`);
   * }
   * ```
   */
  async test(
    workspaceId: string,
    body: ArenaTestBody
  ): Promise<ArenaTestResponse> {
    return this.httpClient.post<ArenaTestResponse>(
      `/api/v1/whitelabel/${workspaceId}/arena/test`,
      body
    );
  }

  /**
   * Record an operator's selection from the test panel
   */
  async testSelect(
    workspaceId: string,
    body: ArenaTestSelectBody
  ): Promise<{ status: string }> {
    return this.httpClient.post<{ status: string }>(
      `/api/v1/whitelabel/${workspaceId}/arena/test-select`,
      body
    );
  }

  /**
   * Get cost estimate for arena variants
   *
   * @example
   * ```typescript
   * const estimate = await divinci.arena.costEstimate("ws-123", {
   *   variants: [...],
   *   messageCount: 100,
   * });
   * console.log(`Total: ${estimate.total.estimatedCostFormatted}`);
   * ```
   */
  async costEstimate(
    workspaceId: string,
    body: ArenaCostEstimateBody
  ): Promise<ArenaCostEstimateResponse> {
    return this.httpClient.post<ArenaCostEstimateResponse>(
      `/api/v1/whitelabel/${workspaceId}/arena/cost-estimate`,
      body
    );
  }

  /**
   * Get arena routing cost estimate for QA auto-fix runs
   */
  async routingEstimate(
    workspaceId: string,
    body: ArenaRoutingEstimateBody
  ): Promise<ArenaRoutingEstimateResponse> {
    return this.httpClient.post<ArenaRoutingEstimateResponse>(
      `/api/v1/whitelabel/${workspaceId}/qa/auto-fix/arena-routing-estimate`,
      body
    );
  }
}
