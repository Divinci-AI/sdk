/**
 * Arena Zod schemas for runtime validation
 */

import { z } from "zod";
import { ChatMessageContextSchema } from "./chat.js";

// ============================================
// Core Arena Schemas
// ============================================

/**
 * Arena mode
 */
export const ArenaModeSchema = z.enum(["public", "internal"]);

/**
 * Arena variant configuration
 */
export const ArenaVariantSchema = z.object({
  /** Display label */
  name: z.string().min(1),
  /** Release ID */
  releaseId: z.string().min(1),
  /** RAG vector ID */
  ragVectorId: z.string().optional(),
  /** RAG vector group ID */
  ragVectorGroupId: z.string().optional(),
  /** AI model override */
  assistantId: z.string().optional(),
  /** Per-variant content RAG workflow override */
  outputWorkflow: z.enum(["default", "hybrid", "extensible", "pageindex-pruned"]).optional(),
  /** Per-variant product search workflow override */
  productWorkflow: z.enum(["simple", "advanced"]).optional(),
  /** Variant-specific overrides */
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Arena cache configuration
 */
export const ArenaCacheConfigSchema = z.object({
  /** Whether caching is enabled */
  enabled: z.boolean(),
  /** Minimum cosine similarity for cache hit */
  similarityThreshold: z.number().min(0).max(1).optional(),
  /** Cache TTL in seconds */
  ttlSeconds: z.number().int().positive().optional(),
});

/**
 * Arena configuration
 */
export const ArenaConfigSchema = z.object({
  /** Whether arena mode is active */
  enabled: z.boolean(),
  /** Visibility mode */
  mode: ArenaModeSchema,
  /** Linked Experiment document ID */
  experimentId: z.string().optional(),
  /** Linked ArenaPreset ID */
  presetId: z.string().optional(),
  /** 2-8 model variants */
  variants: z.array(ArenaVariantSchema).min(2).max(8),
  /** Whether to show model names */
  showModelNames: z.boolean(),
  /** Auto-disable after N selections */
  autoDisableAfterSelections: z.number().int().positive().nullable().optional(),
  /** Semantic cache config */
  cache: ArenaCacheConfigSchema.optional(),
  /** Enable inline quality scores */
  inlineScoring: z.boolean().optional(),
});

// ============================================
// Arena Response Variant Schemas
// ============================================

/**
 * Pipeline timing metrics
 */
export const PipelineTimingMetricsSchema = z.object({
  /** End-to-end wall time (ms) */
  total: z.number().nonnegative().optional(),
  /** PII removal (ms) */
  deidentification: z.number().nonnegative().optional(),
  /** RAG context retrieval (ms) */
  rag: z.number().nonnegative().optional(),
  /** Safety moderation (ms) */
  moderation: z.number().nonnegative().optional(),
  /** Learned routing (ms) */
  routing: z.number().nonnegative().optional(),
  /** LLM generation (ms) */
  llm: z.number().nonnegative().optional(),
});

/**
 * Arena inline quality scores
 */
export const ArenaInlineScoresSchema = z.object({
  /** Relevance score (0-1) */
  relevance: z.number().min(0).max(1).optional(),
  /** Hallucination score (0-1, lower = better) */
  hallucination: z.number().min(0).max(1).optional(),
  /** Correctness score (0-1) */
  correctness: z.number().min(0).max(1).optional(),
  /** Completeness score (0-1) */
  completeness: z.number().min(0).max(1).optional(),
  /** Weighted average */
  overall: z.number().min(0).max(1).optional(),
  /** RAG chunks used */
  contextChunkCount: z.number().int().nonnegative(),
  /** Avg tokens per chunk */
  avgContextTokens: z.number().nonnegative(),
  /** Scoring time in ms */
  scoringTime: z.number().nonnegative().optional(),
});

/**
 * Arena response variant
 */
export const ArenaResponseVariantSchema = z.object({
  /** Variant index */
  variantIndex: z.number().int().nonnegative(),
  /** Display name */
  variantName: z.string(),
  /** Release ID */
  releaseId: z.string(),
  /** Response content */
  content: z.string(),
  /** RAG vector ID */
  ragVectorId: z.string().optional(),
  /** RAG vector display name */
  ragVectorName: z.string().optional(),
  /** RAG vector group ID */
  ragVectorGroupId: z.string().optional(),
  /** RAG vector group display name */
  ragVectorGroupName: z.string().optional(),
  /** AI model ID */
  assistantId: z.string().optional(),
  /** RAG context */
  context: z.array(ChatMessageContextSchema).optional(),
  /** Inline quality scores */
  inlineScores: ArenaInlineScoresSchema.optional(),
  /** Source URLs */
  sources: z.array(z.string()).optional(),
  /** Timing metrics */
  timing: PipelineTimingMetricsSchema.optional(),
  /** Arbitrary metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Arena streaming status
 */
export const ArenaStreamingStatusSchema = z.enum(["streaming", "complete", "error"]);

// ============================================
// Arena Selection Schemas
// ============================================

/**
 * Arena select request body
 */
export const ArenaSelectBodySchema = z.object({
  /** 0-based index of selected variant */
  selectedIndex: z.number().int().nonnegative(),
});

/**
 * Arena select response
 */
export const ArenaSelectResponseSchema = z.object({
  status: z.string(),
  selectedIndex: z.number().int().nonnegative(),
  variantName: z.string(),
});

/**
 * Arena regenerate variant request body
 */
export const ArenaRegenerateVariantBodySchema = z.object({
  /** Variant index to regenerate */
  variantIndex: z.number().int().nonnegative(),
  /** AI model ID to use */
  assistantId: z.string().min(1),
});

// ============================================
// Arena Preset Schemas
// ============================================

/**
 * Arena preset status
 */
export const ArenaPresetStatusSchema = z.enum(["draft", "active", "paused", "completed"]);

/**
 * Arena preset
 */
export const ArenaPresetSchema = z.object({
  _id: z.string(),
  whitelabelId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  variants: z.array(ArenaVariantSchema).min(2).max(8),
  showModelNames: z.boolean(),
  mode: ArenaModeSchema,
  autoDisableAfterSelections: z.number().int().positive().nullable().optional(),
  cache: ArenaCacheConfigSchema.optional(),
  inlineScoring: z.boolean().optional(),
  tags: z.array(z.string()),
  status: ArenaPresetStatusSchema.optional(),
  usageCount: z.number().int().nonnegative(),
  createdBy: z.string(),
  archived: z.boolean(),
});

/**
 * Arena variant result (in results response)
 */
export const ArenaVariantResultSchema = z.object({
  name: z.string(),
  releaseId: z.string(),
  selections: z.number().int().nonnegative(),
  winRate: z.string(),
});

/**
 * Arena results response
 */
export const ArenaResultsResponseSchema = z.object({
  experimentId: z.string().optional(),
  enabled: z.boolean().optional(),
  totalSelections: z.number().int().nonnegative(),
  variants: z.array(ArenaVariantResultSchema),
});

// Type exports using z.infer
export type ArenaMode = z.infer<typeof ArenaModeSchema>;
export type ArenaVariant = z.infer<typeof ArenaVariantSchema>;
export type ArenaCacheConfig = z.infer<typeof ArenaCacheConfigSchema>;
export type ArenaConfig = z.infer<typeof ArenaConfigSchema>;
export type PipelineTimingMetrics = z.infer<typeof PipelineTimingMetricsSchema>;
export type ArenaInlineScores = z.infer<typeof ArenaInlineScoresSchema>;
export type ArenaResponseVariant = z.infer<typeof ArenaResponseVariantSchema>;
export type ArenaStreamingStatus = z.infer<typeof ArenaStreamingStatusSchema>;
export type ArenaSelectBody = z.infer<typeof ArenaSelectBodySchema>;
export type ArenaSelectResponse = z.infer<typeof ArenaSelectResponseSchema>;
export type ArenaRegenerateVariantBody = z.infer<typeof ArenaRegenerateVariantBodySchema>;
export type ArenaPresetStatus = z.infer<typeof ArenaPresetStatusSchema>;
export type ArenaPreset = z.infer<typeof ArenaPresetSchema>;
export type ArenaVariantResult = z.infer<typeof ArenaVariantResultSchema>;
export type ArenaResultsResponse = z.infer<typeof ArenaResultsResponseSchema>;
