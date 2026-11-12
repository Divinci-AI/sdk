/**
 * Arena types for multi-model side-by-side comparison
 *
 * Arena mode sends user queries to multiple model variants in parallel,
 * rendering responses as side-by-side cards with "Choose" buttons.
 * User selections drive win-rate statistics and learned routing.
 */

import type { ChatMessageContext } from "./chat.js";

// ============================================
// Core Arena Types
// ============================================

/**
 * Arena mode visibility
 * - "public": end-users see arena comparison UI
 * - "internal": operator-only evaluation mode
 */
export type ArenaMode = "public" | "internal";

/**
 * Arena variant: a single model configuration in a comparison
 */
export interface ArenaVariant {
  /** Display label, e.g. "GPT-4o" */
  name: string;
  /** Release that configures the model/assistant */
  releaseId: string;
  /** Which RAG vector to query (per-variant RAG arena) */
  ragVectorId?: string;
  /** Which RAG vector group to query (multi-vector RAG arena) */
  ragVectorGroupId?: string;
  /** Override the release's default AI model */
  assistantId?: string;
  /** Per-variant content RAG workflow override */
  outputWorkflow?: "default" | "hybrid" | "extensible";
  /** Per-variant product search workflow override */
  productWorkflow?: "simple" | "advanced";
  /** Optional variant-specific overrides */
  config?: Record<string, unknown>;
}

/**
 * Arena semantic cache configuration.
 * Caches arena results keyed by question similarity to skip LLM calls for repeat questions.
 */
export interface ArenaCacheConfig {
  /** Whether caching is enabled */
  enabled: boolean;
  /** Minimum cosine similarity to consider a cache hit (default: 0.92) */
  similarityThreshold?: number;
  /** Cache TTL in seconds (default: 86400 = 24h) */
  ttlSeconds?: number;
}

/**
 * Arena configuration on a workspace
 */
export interface ArenaConfig {
  /** Whether arena mode is active */
  enabled: boolean;
  /** Visibility mode */
  mode: ArenaMode;
  /** Linked Experiment document ID */
  experimentId?: string;
  /** Linked ArenaPreset that produced this config */
  presetId?: string;
  /** 2-8 model variants to compare */
  variants: ArenaVariant[];
  /** If false, labels are "Response A", "Response B", etc. */
  showModelNames: boolean;
  /** Optional: auto-stop after N selections */
  autoDisableAfterSelections?: number | null;
  /** Optional semantic cache for arena results */
  cache?: ArenaCacheConfig;
  /** Enable per-variant inline quality scores */
  inlineScoring?: boolean;
}

// ============================================
// Arena Response Variant Types
// ============================================

/**
 * Per-step timing metrics for the processing pipeline.
 * All values are in milliseconds.
 */
export interface PipelineTimingMetrics {
  /** End-to-end wall time (ms) */
  total?: number;
  /** PII removal (ms) */
  deidentification?: number;
  /** RAG context retrieval (ms) */
  rag?: number;
  /** Safety moderation checks (ms) */
  moderation?: number;
  /** Learned routing check (ms) */
  routing?: number;
  /** LLM generation (ms) */
  llm?: number;
}

/**
 * Inline quality scores computed for an arena response variant.
 * Uses lightweight computation-based scorers (<5ms total) to avoid latency impact.
 */
export interface ArenaInlineScores {
  /** 0-1, higher = more on-topic */
  relevance?: number;
  /** 0-1, lower = better (fewer unsupported claims) */
  hallucination?: number;
  /** 0-1, only with expectedAnswer (AutoFix) */
  correctness?: number;
  /** 0-1, only with expectedAnswer (AutoFix) */
  completeness?: number;
  /** Weighted average */
  overall?: number;
  /** RAG chunks used */
  contextChunkCount: number;
  /** Avg tokens per chunk */
  avgContextTokens: number;
  /** Scoring time in ms */
  scoringTime?: number;
}

/**
 * Arena response variant: a single model's response in a side-by-side comparison.
 * Stored on the assistant message alongside other variants.
 */
export interface ArenaResponseVariant {
  /** Variant index (0, 1, 2, ...) */
  variantIndex: number;
  /** Display name or "Response A", etc. */
  variantName: string;
  /** Which release generated this response */
  releaseId: string;
  /** The model's response text */
  content: string;
  /** Which RAG vector was queried for this variant */
  ragVectorId?: string;
  /** Display name of the RAG vector */
  ragVectorName?: string;
  /** Which RAG vector group was queried */
  ragVectorGroupId?: string;
  /** Display name of the RAG vector group */
  ragVectorGroupName?: string;
  /** The model ID that generated this response */
  assistantId?: string;
  /** RAG context used for this variant */
  context?: ChatMessageContext[];
  /** Per-variant quality scores */
  inlineScores?: ArenaInlineScores;
  /** Source URLs */
  sources?: string[];
  /** Per-step timing metrics */
  timing?: PipelineTimingMetrics;
  /** Arbitrary metadata (e.g. model-specific info) */
  metadata?: Record<string, unknown>;
}

/**
 * Arena streaming status
 */
export type ArenaStreamingStatus = "streaming" | "complete" | "error";

// ============================================
// Arena Selection Types (User-facing)
// ============================================

/**
 * Request body for selecting an arena variant
 */
export interface ArenaSelectBody {
  /** 0-based index of the selected variant */
  selectedIndex: number;
}

/**
 * Response from arena selection
 */
export interface ArenaSelectResponse {
  status: string;
  /** Index of the selected variant */
  selectedIndex: number;
  /** Display name of the selected variant */
  variantName: string;
}

/**
 * Request body for regenerating a single arena variant
 */
export interface ArenaRegenerateVariantBody {
  /** Which variant to regenerate (0-based index) */
  variantIndex: number;
  /** AI model ID to use for regeneration */
  assistantId: string;
}

/**
 * Response from arena variant regeneration
 */
export interface ArenaRegenerateVariantResponse {
  status: string;
  /** Updated variant with new content */
  variant: ArenaResponseVariant;
}

// ============================================
// Arena Management Types (Operator-facing)
// ============================================

/**
 * Request body for enabling arena mode
 */
export interface ArenaEnableBody {
  /** 2-8 model variants to compare */
  variants: ArenaVariant[];
  /** If false, labels are "Response A", "Response B", etc. (default: false) */
  showModelNames?: boolean;
  /** Auto-disable after N selections (null = no limit) */
  autoDisableAfterSelections?: number | null;
  /** Arena visibility mode (default: "public") */
  mode?: ArenaMode;
}

/**
 * Response from enabling arena mode
 */
export interface ArenaEnableResponse {
  status: string;
  /** ID of the created Experiment for tracking */
  experimentId: string;
  /** ID of the auto-created Preset */
  presetId: string;
  /** The active arena configuration */
  arenaConfig: ArenaConfig;
}

/**
 * Arena results: win rates per variant
 */
export interface ArenaResultsResponse {
  /** Linked experiment ID */
  experimentId?: string;
  /** Whether arena is currently enabled */
  enabled?: boolean;
  /** Total number of user selections */
  totalSelections: number;
  /** Per-variant results */
  variants: ArenaVariantResult[];
}

/**
 * Per-variant result in arena results
 */
export interface ArenaVariantResult {
  /** Variant display name */
  name: string;
  /** Release ID */
  releaseId: string;
  /** Total selections for this variant */
  selections: number;
  /** Win rate as percentage string, e.g. "45.2" */
  winRate: string;
}

/**
 * Request body for arena test (operator evaluation)
 */
export interface ArenaTestBody {
  /** The test query */
  question: string;
}

/**
 * Response from arena test
 */
export interface ArenaTestResponse {
  /** Responses from all variants */
  variants: ArenaTestVariantResult[];
}

/**
 * Individual variant result from arena test
 */
export interface ArenaTestVariantResult {
  /** Variant index */
  variantIndex: number;
  /** Display name */
  variantName: string;
  /** Generated response content */
  content: string;
  /** RAG vector used */
  ragVectorId?: string;
  /** Error if generation failed */
  error?: string;
}

/**
 * Request body for arena test selection
 */
export interface ArenaTestSelectBody {
  /** 0-based variant index */
  selectedIndex: number;
  /** Optional question for metadata */
  question?: string;
}

// ============================================
// Arena Cost Estimate Types
// ============================================

/**
 * Request body for arena cost estimate
 */
export interface ArenaCostEstimateBody {
  /** Variants to estimate costs for */
  variants: ArenaVariant[];
  /** Scale cost estimate by message count (default: 1) */
  messageCount?: number;
}

/**
 * Per-variant cost breakdown
 */
export interface ArenaCostEstimateVariant {
  /** Variant name */
  name: string;
  /** AI model ID */
  assistantId: string;
  /** AI model display name */
  assistantName: string;
  /** Input cost per message */
  inputCostPerMessage: number;
  /** Formatted input cost, e.g. "$0.002" */
  inputCostPerMessageFormatted: string;
  /** Output escrow per message */
  outputEscrowPerMessage: number;
  /** Formatted output escrow */
  outputEscrowPerMessageFormatted: string;
  /** Total estimated cost per message */
  totalEstimatedPerMessage: number;
  /** Formatted total per message */
  totalEstimatedPerMessageFormatted: string;
  /** Cost status description */
  costStatus: string;
  /** Whether this variant is free */
  isFree: boolean;
}

/**
 * Response from arena cost estimate
 */
export interface ArenaCostEstimateResponse {
  /** Number of variants */
  variantCount: number;
  /** Number of free variants */
  freeVariantCount: number;
  /** Message count used for estimation */
  messageCount: number;
  /** Per-variant cost breakdowns */
  variants: ArenaCostEstimateVariant[];
  /** Cost per round (all variants for one question) */
  perRound: {
    estimatedCost: number;
    estimatedCostFormatted: string;
  };
  /** Total estimated cost */
  total: {
    estimatedCost: number;
    estimatedCostFormatted: string;
  };
  /** User wallet balance info */
  wallet: {
    balance: number;
    balanceFormatted: string;
    hasSufficientFunds: boolean;
  };
}

// ============================================
// Arena Preset Types
// ============================================

/**
 * Arena preset status
 */
export type ArenaPresetStatus = "draft" | "active" | "paused" | "completed";

/**
 * Arena preset: a saved configuration for arena mode
 */
export interface ArenaPreset {
  /** Preset ID */
  _id: string;
  /** Workspace ID */
  whitelabelId: string;
  /** Preset name */
  name: string;
  /** Description */
  description?: string;
  /** Model variants */
  variants: ArenaVariant[];
  /** Whether to show model names */
  showModelNames: boolean;
  /** Arena visibility mode */
  mode: ArenaMode;
  /** Auto-disable after N selections */
  autoDisableAfterSelections?: number | null;
  /** Semantic cache config */
  cache?: ArenaCacheConfig;
  /** Enable per-variant inline quality scores */
  inlineScoring?: boolean;
  /** Tags for organization */
  tags: string[];
  /** Preset status */
  status?: ArenaPresetStatus;
  /** Number of times this preset has been used */
  usageCount: number;
  /** Creator user ID */
  createdBy: string;
  /** Whether this preset is archived (soft-deleted) */
  archived: boolean;
}

/**
 * Request body for creating an arena preset
 */
export interface CreateArenaPresetBody {
  /** Preset name */
  name: string;
  /** Description */
  description?: string;
  /** Model variants */
  variants: ArenaVariant[];
  /** Whether to show model names */
  showModelNames?: boolean;
  /** Arena visibility mode */
  mode?: ArenaMode;
  /** Auto-disable after N selections */
  autoDisableAfterSelections?: number | null;
  /** Semantic cache config */
  cache?: ArenaCacheConfig;
  /** Tags */
  tags?: string[];
}

/**
 * Request body for updating an arena preset
 */
export interface UpdateArenaPresetBody {
  /** Preset name */
  name?: string;
  /** Description */
  description?: string;
  /** Tags */
  tags?: string[];
  /** Whether to show model names */
  showModelNames?: boolean;
  /** Arena visibility mode */
  mode?: ArenaMode;
  /** Auto-disable after N selections */
  autoDisableAfterSelections?: number | null;
  /** Status (not "active" — use activate endpoint) */
  status?: Exclude<ArenaPresetStatus, "active">;
  /** Model variants (only changeable if preset is not active) */
  variants?: ArenaVariant[];
}

/**
 * Arena preset export format (portable JSON)
 */
export interface ArenaPresetExportFormat {
  metadata: {
    type: "arena-preset";
    version: "1.0";
    exportedAt: string;
    source: "divinci-ai";
  };
  preset: Pick<
    ArenaPreset,
    | "name"
    | "description"
    | "variants"
    | "showModelNames"
    | "mode"
    | "autoDisableAfterSelections"
    | "cache"
    | "tags"
  >;
}

/**
 * Response from activating a preset
 */
export interface ArenaPresetActivateResponse {
  status: string;
  experimentId: string;
  presetId: string;
}

/**
 * Arena preset results: aggregated across experiments
 */
export interface ArenaPresetResultsResponse {
  /** Preset ID */
  presetId: string;
  /** Preset name */
  presetName: string;
  /** Current status */
  status: string;
  /** Total selections across all experiments */
  totalSelections: number;
  /** Per-variant results */
  variants: ArenaVariantResult[];
  /** Per-experiment breakdowns */
  experiments: ArenaPresetExperimentResult[];
}

/**
 * Per-experiment result within a preset
 */
export interface ArenaPresetExperimentResult {
  /** Experiment ID */
  experimentId: string;
  /** Experiment name */
  name: string;
  /** Creation timestamp */
  createdAt: string;
  /** Total selections in this experiment */
  totalSelections: number;
  /** Variant selection counts (e.g. "variant_0" -> 15) */
  variantCounts: Record<string, number>;
}

// ============================================
// Arena Routing Estimate Types (QA integration)
// ============================================

/**
 * Request body for arena routing cost estimate in auto-fix
 */
export interface ArenaRoutingEstimateBody {
  /** QA test suite ID */
  suiteId: string;
  /** Arena experiment ID */
  experimentId: string;
}

/**
 * Response from arena routing cost estimate
 */
export interface ArenaRoutingEstimateResponse {
  /** Number of tests in suite */
  testCount: number;
  /** Variants with ragVectorId */
  ragVariantCount: number;
  /** Score generators in suite */
  scoreGeneratorCount: number;
  /** Extra response calls (testCount x ragVariantCount) */
  extraResponseCalls: number;
  /** Extra scoring calls (testCount x ragVariantCount x scoreGeneratorCount) */
  extraScoringCalls: number;
  /** Total extra LLM calls */
  totalExtraLlmCalls: number;
  /** Human-readable summary */
  warning: string;
}
