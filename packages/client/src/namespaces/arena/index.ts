/**
 * Arena Namespace
 *
 * Provides access to Arena operations for multi-model side-by-side comparison.
 * Includes variant selection, results, presets, cost estimation, and test endpoints.
 *
 * @example
 * ```typescript
 * const sdk = new DivinciClient({ userToken: "...", releaseId: "..." });
 *
 * // Select winning variant in a chat message
 * await sdk.arena.selectChatVariant({
 *   chatId: "chat-123",
 *   messageId: "msg-456",
 *   selectedIndex: 0,
 * });
 *
 * // Get arena results for a workspace
 * const results = await sdk.arena.getResults({ workspaceId: "ws-123" });
 *
 * // Manage presets
 * const presets = await sdk.arena.presets.list({ workspaceId: "ws-123" });
 * ```
 */

import { BaseNamespace, type NamespaceContext } from "../base.js";
import type { HttpClient } from "../../http-client.js";
import type {
  ArenaSelectResponse,
  ArenaRegenerateVariantResponse,
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
  ArenaRoutingEstimateBody,
  ArenaRoutingEstimateResponse,
} from "@divinci-ai/types";

// ============================================
// Arena Presets Namespace
// ============================================

/**
 * Arena Presets Namespace
 *
 * Manages arena presets (saved configurations)
 */
export class ArenaPresetsNamespace extends BaseNamespace {
  constructor(httpClient: HttpClient, context: NamespaceContext = {}) {
    super(httpClient, context);
  }

  /**
   * List all non-archived presets for a workspace
   *
   * @example
   * ```typescript
   * const presets = await sdk.arena.presets.list({ workspaceId: "ws-123" });
   * ```
   */
  async list(params: { workspaceId?: string } = {}): Promise<ArenaPreset[]> {
    const workspaceId = this.getWorkspaceId(params);
    const response = await this.httpClient.get<{ presets: ArenaPreset[] }>(
      `/white-label/${workspaceId}/arena/presets`
    );
    return response.presets;
  }

  /**
   * Create a new arena preset
   *
   * @example
   * ```typescript
   * const preset = await sdk.arena.presets.create(
   *   { workspaceId: "ws-123" },
   *   { name: "GPT vs Claude", variants: [...] }
   * );
   * ```
   */
  async create(
    params: { workspaceId?: string },
    body: CreateArenaPresetBody
  ): Promise<ArenaPreset> {
    const workspaceId = this.getWorkspaceId(params);
    const response = await this.httpClient.post<{ preset: ArenaPreset }>(
      `/white-label/${workspaceId}/arena/presets`,
      body
    );
    return response.preset;
  }

  /**
   * Update an arena preset
   *
   * @example
   * ```typescript
   * const updated = await sdk.arena.presets.update(
   *   { workspaceId: "ws-123", presetId: "p-456" },
   *   { name: "Updated Name", tags: ["production"] }
   * );
   * ```
   */
  async update(
    params: { workspaceId?: string; presetId: string },
    body: UpdateArenaPresetBody
  ): Promise<ArenaPreset> {
    const workspaceId = this.getWorkspaceId(params);
    const response = await this.httpClient.put<{ preset: ArenaPreset }>(
      `/white-label/${workspaceId}/arena/presets/${params.presetId}`,
      body
    );
    return response.preset;
  }

  /**
   * Delete (archive) an arena preset
   *
   * @example
   * ```typescript
   * await sdk.arena.presets.delete({
   *   workspaceId: "ws-123",
   *   presetId: "p-456"
   * });
   * ```
   */
  async delete(params: {
    workspaceId?: string;
    presetId: string;
  }): Promise<void> {
    const workspaceId = this.getWorkspaceId(params);
    await this.httpClient.delete(
      `/white-label/${workspaceId}/arena/presets/${params.presetId}`
    );
  }

  /**
   * Activate a preset (applies it as the active arena configuration)
   *
   * @example
   * ```typescript
   * const { experimentId } = await sdk.arena.presets.activate({
   *   workspaceId: "ws-123",
   *   presetId: "p-456"
   * });
   * ```
   */
  async activate(params: {
    workspaceId?: string;
    presetId: string;
  }): Promise<ArenaPresetActivateResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaPresetActivateResponse>(
      `/white-label/${workspaceId}/arena/presets/${params.presetId}/activate`,
      {}
    );
  }

  /**
   * Export a preset as portable JSON
   *
   * @example
   * ```typescript
   * const exportData = await sdk.arena.presets.export({
   *   workspaceId: "ws-123",
   *   presetId: "p-456"
   * });
   * ```
   */
  async export(params: {
    workspaceId?: string;
    presetId: string;
  }): Promise<ArenaPresetExportFormat> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ArenaPresetExportFormat>(
      `/white-label/${workspaceId}/arena/presets/${params.presetId}/export`
    );
  }

  /**
   * Import a preset from portable JSON
   *
   * @example
   * ```typescript
   * const preset = await sdk.arena.presets.import(
   *   { workspaceId: "ws-123" },
   *   exportData
   * );
   * ```
   */
  async import(
    params: { workspaceId?: string },
    body: ArenaPresetExportFormat
  ): Promise<ArenaPreset> {
    const workspaceId = this.getWorkspaceId(params);
    const response = await this.httpClient.post<{ preset: ArenaPreset }>(
      `/white-label/${workspaceId}/arena/presets/import`,
      body
    );
    return response.preset;
  }

  /**
   * Get aggregated results for a preset
   *
   * @example
   * ```typescript
   * const results = await sdk.arena.presets.getResults({
   *   workspaceId: "ws-123",
   *   presetId: "p-456"
   * });
   * console.log(results.variants); // Win rates per variant
   * ```
   */
  async getResults(params: {
    workspaceId?: string;
    presetId: string;
  }): Promise<ArenaPresetResultsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ArenaPresetResultsResponse>(
      `/white-label/${workspaceId}/arena/presets/${params.presetId}/results`
    );
  }
}

// ============================================
// Arena Namespace
// ============================================

/**
 * Arena Namespace
 *
 * Top-level namespace for Arena operations including variant selection,
 * results tracking, presets, cost estimation, and test endpoints.
 */
export class ArenaNamespace extends BaseNamespace {
  private _presets: ArenaPresetsNamespace | null = null;

  constructor(httpClient: HttpClient, context: NamespaceContext = {}) {
    super(httpClient, context);
  }

  /**
   * Presets sub-namespace for managing saved arena configurations
   *
   * @example
   * ```typescript
   * const presets = await sdk.arena.presets.list({ workspaceId });
   * await sdk.arena.presets.activate({ workspaceId, presetId });
   * ```
   */
  get presets(): ArenaPresetsNamespace {
    if (!this._presets) {
      this._presets = new ArenaPresetsNamespace(this.httpClient, this.context);
    }
    return this._presets;
  }

  // ==========================================
  // User-facing: Variant Selection
  // ==========================================

  /**
   * Select a winning arena variant in a chat message
   *
   * @example
   * ```typescript
   * const result = await sdk.arena.selectChatVariant({
   *   chatId: "chat-123",
   *   messageId: "msg-456",
   *   selectedIndex: 0,
   * });
   * console.log(result.variantName); // "GPT-4o"
   * ```
   */
  async selectChatVariant(params: {
    chatId: string;
    messageId: string;
    selectedIndex: number;
  }): Promise<ArenaSelectResponse> {
    return this.httpClient.post<ArenaSelectResponse>(
      `/ai-chat/${params.chatId}/message/${params.messageId}/arena-select`,
      { selectedIndex: params.selectedIndex }
    );
  }

  /**
   * Select a winning arena variant in a workspace transcript message
   *
   * @example
   * ```typescript
   * const result = await sdk.arena.selectTranscriptVariant({
   *   workspaceId: "ws-123",
   *   transcriptId: "t-456",
   *   messageId: "msg-789",
   *   selectedIndex: 1,
   * });
   * ```
   */
  async selectTranscriptVariant(params: {
    workspaceId?: string;
    transcriptId: string;
    messageId: string;
    selectedIndex: number;
  }): Promise<ArenaSelectResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaSelectResponse>(
      `/white-label/${workspaceId}/transcript/${params.transcriptId}/message/${params.messageId}/arena-select`,
      { selectedIndex: params.selectedIndex }
    );
  }

  /**
   * Regenerate a single arena variant with a different AI model
   *
   * @example
   * ```typescript
   * const result = await sdk.arena.regenerateVariant({
   *   workspaceId: "ws-123",
   *   transcriptId: "t-456",
   *   messageId: "msg-789",
   *   variantIndex: 0,
   *   assistantId: "claude-3-5-sonnet",
   * });
   * console.log(result.variant.content); // New response
   * ```
   */
  async regenerateVariant(params: {
    workspaceId?: string;
    transcriptId: string;
    messageId: string;
    variantIndex: number;
    assistantId: string;
  }): Promise<ArenaRegenerateVariantResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaRegenerateVariantResponse>(
      `/white-label/${workspaceId}/transcript/${params.transcriptId}/message/${params.messageId}/arena-regenerate-variant`,
      {
        variantIndex: params.variantIndex,
        assistantId: params.assistantId,
      }
    );
  }

  // ==========================================
  // Management: Enable / Disable / Results
  // ==========================================

  /**
   * Enable arena mode for a workspace
   *
   * @example
   * ```typescript
   * const { experimentId, arenaConfig } = await sdk.arena.enable(
   *   { workspaceId: "ws-123" },
   *   {
   *     variants: [
   *       { name: "GPT-4o", releaseId: "rel-1" },
   *       { name: "Claude 3.5", releaseId: "rel-2" },
   *     ],
   *     showModelNames: true,
   *   }
   * );
   * ```
   */
  async enable(
    params: { workspaceId?: string },
    body: ArenaEnableBody
  ): Promise<ArenaEnableResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaEnableResponse>(
      `/white-label/${workspaceId}/arena/enable`,
      body
    );
  }

  /**
   * Disable arena mode for a workspace
   *
   * @example
   * ```typescript
   * await sdk.arena.disable({ workspaceId: "ws-123" });
   * ```
   */
  async disable(params: { workspaceId?: string }): Promise<{ status: string }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<{ status: string }>(
      `/white-label/${workspaceId}/arena/disable`,
      {}
    );
  }

  /**
   * Get arena results (win rates per variant)
   *
   * @example
   * ```typescript
   * const results = await sdk.arena.getResults({ workspaceId: "ws-123" });
   * for (const v of results.variants) {
   *   console.log(`${v.name}: ${v.winRate}% (${v.selections} selections)`);
   * }
   * ```
   */
  async getResults(params: { workspaceId?: string }): Promise<ArenaResultsResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.get<ArenaResultsResponse>(
      `/white-label/${workspaceId}/arena/results`
    );
  }

  // ==========================================
  // Management: Test & Cost
  // ==========================================

  /**
   * Run a test question through all arena variants (operator evaluation)
   *
   * @example
   * ```typescript
   * const test = await sdk.arena.test(
   *   { workspaceId: "ws-123" },
   *   { question: "What is our refund policy?" }
   * );
   * for (const v of test.variants) {
   *   console.log(`${v.variantName}: ${v.content.substring(0, 100)}...`);
   * }
   * ```
   */
  async test(
    params: { workspaceId?: string },
    body: ArenaTestBody
  ): Promise<ArenaTestResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaTestResponse>(
      `/white-label/${workspaceId}/arena/test`,
      body
    );
  }

  /**
   * Record an operator's selection from the test panel
   *
   * @example
   * ```typescript
   * await sdk.arena.testSelect(
   *   { workspaceId: "ws-123" },
   *   { selectedIndex: 0, question: "What is our refund policy?" }
   * );
   * ```
   */
  async testSelect(
    params: { workspaceId?: string },
    body: ArenaTestSelectBody
  ): Promise<{ status: string }> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<{ status: string }>(
      `/white-label/${workspaceId}/arena/test-select`,
      body
    );
  }

  /**
   * Get cost estimate for arena variants
   *
   * @example
   * ```typescript
   * const estimate = await sdk.arena.costEstimate(
   *   { workspaceId: "ws-123" },
   *   { variants: [...], messageCount: 100 }
   * );
   * console.log(`Per round: ${estimate.perRound.estimatedCostFormatted}`);
   * console.log(`Total: ${estimate.total.estimatedCostFormatted}`);
   * ```
   */
  async costEstimate(
    params: { workspaceId?: string },
    body: ArenaCostEstimateBody
  ): Promise<ArenaCostEstimateResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaCostEstimateResponse>(
      `/white-label/${workspaceId}/arena/cost-estimate`,
      body
    );
  }

  /**
   * Get arena routing cost estimate for QA auto-fix runs
   *
   * @example
   * ```typescript
   * const estimate = await sdk.arena.routingEstimate(
   *   { workspaceId: "ws-123" },
   *   { suiteId: "suite-456", experimentId: "exp-789" }
   * );
   * console.log(`Extra LLM calls: ${estimate.totalExtraLlmCalls}`);
   * ```
   */
  async routingEstimate(
    params: { workspaceId?: string },
    body: ArenaRoutingEstimateBody
  ): Promise<ArenaRoutingEstimateResponse> {
    const workspaceId = this.getWorkspaceId(params);
    return this.httpClient.post<ArenaRoutingEstimateResponse>(
      `/white-label/${workspaceId}/qa/auto-fix/arena-routing-estimate`,
      body
    );
  }

  /**
   * Create a new Arena namespace with workspace context
   */
  withWorkspace(workspaceId: string): ArenaNamespace {
    return new ArenaNamespace(
      this.httpClient,
      this.withContext({ workspaceId })
    );
  }
}
