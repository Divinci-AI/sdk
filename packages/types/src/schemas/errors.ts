/**
 * Error Zod schemas
 */

import { z } from "zod";

/**
 * Error codes enum as a Zod schema
 */
export const ErrorCodeSchema = z.enum([
  // Authentication errors
  "unauthorized",
  "invalid_api_key",
  "token_expired",
  "insufficient_permissions",

  // Request errors
  "bad_request",
  "validation_error",
  "not_found",
  "conflict",
  "rate_limited",

  // Payment errors (x402)
  "payment_required",
  "payment_failed",
  "insufficient_funds",

  // Server errors
  "internal_error",
  "service_unavailable",
  "timeout",

  // Network errors
  "network_error",
  "connection_failed",

  // SDK errors
  "configuration_error",
  "invalid_argument",
]);

/**
 * Base SDK error data
 */
export const DivinciErrorDataSchema = z.object({
  /** Error code */
  code: ErrorCodeSchema,
  /** Human-readable message */
  message: z.string(),
  /** HTTP status code */
  status: z.number().int().min(100).max(599).optional(),
  /** Additional error details */
  details: z.record(z.string(), z.unknown()).optional(),
  /** Request ID for debugging */
  requestId: z.string().optional(),
});

/**
 * Single field validation error
 */
export const FieldValidationErrorSchema = z.object({
  /** Field that failed validation */
  field: z.string(),
  /** Validation error message */
  message: z.string(),
  /** Validation error code */
  code: z.string().optional(),
  /** Invalid value (if safe to expose) */
  value: z.unknown().optional(),
});

/**
 * Validation error details (contains multiple field errors)
 */
export const ValidationErrorDetailsSchema = z.object({
  /** Array of field-level validation errors */
  fieldErrors: z.array(FieldValidationErrorSchema),
});

/**
 * Rate limit error details
 */
export const RateLimitErrorDetailsSchema = z.object({
  /** Requests allowed per window */
  limit: z.number().int().positive(),
  /** Remaining requests in current window */
  remaining: z.number().int().nonnegative(),
  /** When the limit resets (Unix timestamp) */
  resetAt: z.number().int().positive(),
  /** Retry after seconds */
  retryAfter: z.number().int().nonnegative(),
});

/**
 * x402 Payment required error details
 */
export const PaymentRequiredDetailsSchema = z.object({
  /** x402 protocol version */
  x402Version: z.string(),
  /** Required payment amount in USD */
  amountUsd: z.number().nonnegative(),
  /** Required payment amount in micro-units */
  amountMicro: z.number().int().nonnegative(),
  /** Payment network (base, base-sepolia) */
  network: z.string(),
  /** Payment asset (USDC) */
  asset: z.string(),
  /** Recipient wallet address */
  recipient: z.string(),
  /** Resource requiring payment */
  resource: z.string(),
  /** Facilitator URL */
  facilitatorUrl: z.string().url(),
});

// Type exports using z.infer
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type DivinciErrorData = z.infer<typeof DivinciErrorDataSchema>;
export type FieldValidationError = z.infer<typeof FieldValidationErrorSchema>;
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetailsSchema>;
export type RateLimitErrorDetails = z.infer<typeof RateLimitErrorDetailsSchema>;
export type PaymentRequiredDetails = z.infer<typeof PaymentRequiredDetailsSchema>;
