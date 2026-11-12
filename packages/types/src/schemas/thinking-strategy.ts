/**
 * Thinking Strategy Zod schemas
 *
 * Schemas for configuring inference-time thinking strategies
 * that enhance LLM reasoning capabilities for complex tasks.
 *
 * Based on research:
 * - Recursive Language Models (RLM) - arXiv:2512.24601
 * - Chain-of-Thought prompting
 * - Tree of Thoughts
 * - Self-Consistency
 */

import { z } from "zod";

// ============================================
// THINKING STRATEGY TYPES
// ============================================

/**
 * Available thinking strategy types
 */
export const ThinkingStrategyTypeSchema = z.enum([
  "direct",           // Standard completion (no strategy)
  "recursive-lm",     // RLM with REPL environment
  "chain-of-thought", // CoT prompting (future)
  "tree-of-thoughts", // ToT with backtracking (future)
  "self-consistency", // Multiple paths + voting (future)
]);

/**
 * LLM providers for thinking strategy sub-calls
 */
export const ThinkingProviderSchema = z.enum([
  "workers-ai",
  "openai",
  "anthropic",
  "gemini",
]);

/**
 * Sandbox types for code execution
 */
export const ThinkingSandboxTypeSchema = z.enum([
  "v8-isolate",          // V8 isolate (fast, in-process)
  "cloudflare-container", // Cloudflare Container (isolated, more resources)
]);

// ============================================
// RLM CONFIGURATION
// ============================================

/**
 * Configuration for Recursive Language Model strategy
 */
export const RLMConfigSchema = z.object({
  /** LLM provider for sub-calls */
  provider: ThinkingProviderSchema.default("workers-ai"),

  /** Model identifier (uses provider default if omitted) */
  model: z.string().optional(),

  /** Maximum depth of recursive calls (1-10) */
  maxRecursionDepth: z.number().int().min(1).max(10).default(5),

  /** Maximum total sub-LLM calls per request (1-100) */
  maxSubCalls: z.number().int().min(1).max(100).default(20),

  /** Timeout per code execution turn in milliseconds */
  turnTimeoutMs: z.number().int().min(5000).max(120000).default(30000),

  /** Token count threshold to trigger RLM (0 = always use RLM) */
  contextThreshold: z.number().int().min(0).max(1000000).default(100000),

  /** Code execution sandbox type */
  sandboxType: ThinkingSandboxTypeSchema.default("v8-isolate"),
});

// ============================================
// CHAIN-OF-THOUGHT CONFIGURATION (Future)
// ============================================

/**
 * Configuration for Chain-of-Thought prompting
 */
export const CoTConfigSchema = z.object({
  /** Whether to include "think step by step" instruction */
  explicitInstruction: z.boolean().default(true),

  /** Maximum thinking tokens before answer */
  maxThinkingTokens: z.number().int().min(100).max(8000).default(2000),
});

// ============================================
// SELF-CONSISTENCY CONFIGURATION (Future)
// ============================================

/**
 * Configuration for Self-Consistency strategy
 */
export const SelfConsistencyConfigSchema = z.object({
  /** Number of reasoning paths to generate */
  numPaths: z.number().int().min(2).max(10).default(5),

  /** Method for selecting final answer */
  votingMethod: z.enum(["majority", "weighted"]).default("majority"),

  /** Temperature for diverse path generation */
  pathTemperature: z.number().min(0.5).max(1.5).default(0.9),
});

// ============================================
// TREE OF THOUGHTS CONFIGURATION (Future)
// ============================================

/**
 * Configuration for Tree of Thoughts strategy
 */
export const TreeOfThoughtsConfigSchema = z.object({
  /** Number of branches at each decision point */
  branchingFactor: z.number().int().min(2).max(5).default(3),

  /** Maximum tree depth */
  maxDepth: z.number().int().min(1).max(5).default(3),

  /** How to evaluate thoughts */
  evaluator: z.enum(["self", "separate-model"]).default("self"),

  /** Whether to enable backtracking on dead ends */
  enableBacktracking: z.boolean().default(true),
});

// ============================================
// MAIN THINKING STRATEGY CONFIG
// ============================================

/**
 * Complete thinking strategy configuration
 */
export const ThinkingStrategyConfigSchema = z.object({
  /** Strategy type to use */
  type: ThinkingStrategyTypeSchema.default("direct"),

  /** Whether the strategy is enabled */
  enabled: z.boolean().default(false),

  /** RLM-specific configuration */
  rlm: RLMConfigSchema.optional(),

  /** Chain-of-Thought configuration (future) */
  chainOfThought: CoTConfigSchema.optional(),

  /** Self-Consistency configuration (future) */
  selfConsistency: SelfConsistencyConfigSchema.optional(),

  /** Tree of Thoughts configuration (future) */
  treeOfThoughts: TreeOfThoughtsConfigSchema.optional(),
});

// ============================================
// EXECUTION RESULT TYPES
// ============================================

/**
 * Usage statistics from thinking strategy execution
 */
export const ThinkingStrategyUsageSchema = z.object({
  /** Number of sub-LLM calls made */
  subCalls: z.number().int().nonnegative(),

  /** Total input tokens consumed */
  totalInputTokens: z.number().int().nonnegative(),

  /** Total output tokens generated */
  totalOutputTokens: z.number().int().nonnegative(),

  /** Total execution time in milliseconds */
  executionTimeMs: z.number().int().nonnegative(),

  /** Number of iterations/turns */
  iterations: z.number().int().nonnegative().optional(),

  /** Maximum recursion depth reached */
  maxDepthReached: z.number().int().nonnegative().optional(),
});

/**
 * Result from thinking strategy execution
 */
export const ThinkingStrategyResultSchema = z.object({
  /** Final answer/output */
  answer: z.string(),

  /** Number of iterations/turns taken */
  iterations: z.number().int().nonnegative(),

  /** Usage statistics */
  usage: ThinkingStrategyUsageSchema,

  /** Intermediate findings (for debugging/transparency) */
  findings: z.array(z.string()).optional(),

  /** Code that was executed (for debugging) */
  codeExecuted: z.array(z.string()).optional(),

  /** Whether the result was truncated due to limits */
  truncated: z.boolean().optional(),

  /** Error message if strategy failed gracefully */
  error: z.string().optional(),
});

// ============================================
// DEFAULT MODEL MAPPINGS
// ============================================

/**
 * Default models for each provider
 */
export const DEFAULT_THINKING_MODELS = {
  "workers-ai": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "openai": "gpt-4o",
  "anthropic": "claude-sonnet-4-20250514",
  "gemini": "gemini-2.0-flash",
} as const;

// ============================================
// TYPE EXPORTS
// ============================================

export type ThinkingStrategyType = z.infer<typeof ThinkingStrategyTypeSchema>;
export type ThinkingProvider = z.infer<typeof ThinkingProviderSchema>;
export type ThinkingSandboxType = z.infer<typeof ThinkingSandboxTypeSchema>;
export type RLMConfig = z.infer<typeof RLMConfigSchema>;
export type CoTConfig = z.infer<typeof CoTConfigSchema>;
export type SelfConsistencyConfig = z.infer<typeof SelfConsistencyConfigSchema>;
export type TreeOfThoughtsConfig = z.infer<typeof TreeOfThoughtsConfigSchema>;
export type ThinkingStrategyConfig = z.infer<typeof ThinkingStrategyConfigSchema>;
export type ThinkingStrategyUsage = z.infer<typeof ThinkingStrategyUsageSchema>;
export type ThinkingStrategyResult = z.infer<typeof ThinkingStrategyResultSchema>;
