/**
 * Error types for the Divinci SDK
 */

/**
 * Base SDK error
 */
export interface DivinciErrorData {
  /** Error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** HTTP status code */
  status?: number;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Request ID for debugging */
  requestId?: string;
}

/**
 * Error codes used by the SDK
 */
export const ErrorCodes = {
  // Authentication errors
  UNAUTHORIZED: "unauthorized",
  INVALID_API_KEY: "invalid_api_key",
  TOKEN_EXPIRED: "token_expired",
  INSUFFICIENT_PERMISSIONS: "insufficient_permissions",

  // Request errors
  BAD_REQUEST: "bad_request",
  VALIDATION_ERROR: "validation_error",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate_limited",

  // Payment errors (x402)
  PAYMENT_REQUIRED: "payment_required",
  PAYMENT_FAILED: "payment_failed",
  INSUFFICIENT_FUNDS: "insufficient_funds",

  // Terms of Service gate (403 until the current published version is accepted)
  TERMS_NOT_ACCEPTED: "terms_not_accepted",

  // Server errors
  INTERNAL_ERROR: "internal_error",
  SERVICE_UNAVAILABLE: "service_unavailable",
  TIMEOUT: "timeout",

  // Network errors
  NETWORK_ERROR: "network_error",
  CONNECTION_FAILED: "connection_failed",

  // SDK errors
  CONFIGURATION_ERROR: "configuration_error",
  INVALID_ARGUMENT: "invalid_argument",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Single field validation error
 */
export interface FieldValidationError {
  /** Field that failed validation */
  field: string;
  /** Validation error message */
  message: string;
  /** Validation error code */
  code?: string;
  /** Invalid value (if safe to expose) */
  value?: unknown;
}

/**
 * Validation error details (contains multiple field errors)
 */
export interface ValidationErrorDetails {
  /** Array of field-level validation errors */
  fieldErrors: FieldValidationError[];
}

/**
 * Rate limit error details
 */
export interface RateLimitErrorDetails {
  /** Requests allowed per window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** When the limit resets (Unix timestamp) */
  resetAt: number;
  /** Retry after seconds */
  retryAfter: number;
}

/**
 * x402 Payment required error details
 */
export interface PaymentRequiredDetails {
  /** x402 protocol version */
  x402Version: string;
  /** Required payment amount in USD */
  amountUsd: number;
  /** Required payment amount in micro-units */
  amountMicro: number;
  /** Payment network (base, base-sepolia) */
  network: string;
  /** Payment asset (USDC) */
  asset: string;
  /** Recipient wallet address */
  recipient: string;
  /** Resource requiring payment */
  resource: string;
  /** Facilitator URL */
  facilitatorUrl: string;
}
