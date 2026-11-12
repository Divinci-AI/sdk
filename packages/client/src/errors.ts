/**
 * Client SDK Error Classes
 */

import type {
  DivinciErrorData,
  ValidationErrorDetails,
  RateLimitErrorDetails,
  PaymentRequiredDetails,
  TermsNotAcceptedDetails,
} from "@divinci-ai/types";

/**
 * Base error class for all Divinci SDK errors
 */
export class DivinciError extends Error {
  /** Error code */
  readonly code: string;
  /** HTTP status code */
  readonly status?: number;
  /** Additional error details */
  readonly details?: Record<string, unknown>;
  /** Request ID for debugging */
  readonly requestId?: string;

  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message);
    this.name = "DivinciError";
    this.code = data?.code ?? "UNKNOWN_ERROR";
    this.status = data?.status;
    this.details = data?.details;
    this.requestId = data?.requestId;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DivinciError);
    }
  }

  /**
   * Create error from API response
   */
  static fromResponse(response: DivinciErrorData): DivinciError {
    const { code, message } = response;

    // Map to specific error types
    switch (code) {
      case "UNAUTHORIZED":
      case "AUTH_EXPIRED":
      case "AUTH_INVALID":
        return new AuthenticationError(message, response);
      case "VALIDATION_ERROR":
        return new ValidationError(message, response);
      case "RATE_LIMIT_EXCEEDED":
        return new RateLimitError(message, response);
      case "QUOTA_EXCEEDED":
        return new QuotaExceededError(message, response);
      case "PAYMENT_REQUIRED":
        return new PaymentRequiredError(message, response);
      case "NOT_FOUND":
        return new NotFoundError(message, response);
      case "TERMS_NOT_ACCEPTED":
        return new TermsNotAcceptedError(message, response);
      case "NETWORK_ERROR":
        return new NetworkError(message, response);
      default:
        return new DivinciError(message, response);
    }
  }

  /**
   * Convert to plain object for logging/serialization
   */
  toJSON(): DivinciErrorData {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      requestId: this.requestId,
    };
  }
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends DivinciError {
  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 401 });
    this.name = "AuthenticationError";
  }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends DivinciError {
  /** Field-level validation errors */
  readonly fieldErrors?: ValidationErrorDetails["fieldErrors"];

  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 400 });
    this.name = "ValidationError";
    const details = data?.details as ValidationErrorDetails | undefined;
    this.fieldErrors = details?.fieldErrors;
  }
}

/**
 * Rate limit errors (429)
 */
export class RateLimitError extends DivinciError {
  /** Seconds until rate limit resets */
  readonly retryAfter?: number;
  /** Request limit */
  readonly limit?: number;
  /** Remaining requests */
  readonly remaining?: number;

  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 429 });
    this.name = "RateLimitError";
    const details = data?.details as RateLimitErrorDetails | undefined;
    this.retryAfter = details?.retryAfter;
    this.limit = details?.limit;
    this.remaining = details?.remaining;
  }
}

/**
 * Quota exceeded errors (429)
 */
export class QuotaExceededError extends DivinciError {
  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 429, code: "QUOTA_EXCEEDED" });
    this.name = "QuotaExceededError";
  }
}

/**
 * Payment required errors (402) - x402 protocol
 */
export class PaymentRequiredError extends DivinciError {
  /** Payment details from x402 */
  readonly paymentDetails?: PaymentRequiredDetails;

  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 402, code: "PAYMENT_REQUIRED" });
    this.name = "PaymentRequiredError";
    this.paymentDetails = data?.details as PaymentRequiredDetails | undefined;
  }

  /**
   * Get the payment URL for user to complete payment
   */
  getPaymentUrl(): string | undefined {
    return this.paymentDetails?.facilitatorUrl;
  }

  /**
   * Get required payment amount in USD
   */
  getAmountUsd(): number | undefined {
    return this.paymentDetails?.amountUsd;
  }
}

/**
 * Resource not found errors (404)
 */
export class NotFoundError extends DivinciError {
  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 404, code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

/**
 * Terms of Service gate errors (403 TERMS_NOT_ACCEPTED)
 *
 * The caller must accept the release's current published Terms of Service
 * version before interacting. `details` carries the full gate payload
 * (tosId, version, title, markdown content) so the surface can render and
 * accept in one round trip via `client.terms.accept(...)`.
 */
export class TermsNotAcceptedError extends DivinciError {
  /** Terms of Service document id to accept. */
  readonly tosId?: string;
  /** Published version that must be accepted. */
  readonly version?: number;
  /** Display title for the acceptance UI. */
  readonly title?: string;
  /** Markdown body of the published terms. */
  readonly termsContent?: string;

  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, status: 403, code: "TERMS_NOT_ACCEPTED" });
    this.name = "TermsNotAcceptedError";
    const details = data?.details as TermsNotAcceptedDetails | undefined;
    this.tosId = details?.tosId;
    this.version = details?.version;
    this.title = details?.title;
    this.termsContent = details?.content;
  }
}

/**
 * Network/connection errors
 */
export class NetworkError extends DivinciError {
  /** Whether the error is potentially retryable */
  readonly retryable: boolean;

  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, code: "NETWORK_ERROR" });
    this.name = "NetworkError";
    this.retryable = true;
  }
}

/**
 * Stream errors during SSE
 */
export class StreamError extends DivinciError {
  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, code: "STREAM_ERROR" });
    this.name = "StreamError";
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends DivinciError {
  constructor(message: string, data?: Partial<DivinciErrorData>) {
    super(message, { ...data, code: "TIMEOUT" });
    this.name = "TimeoutError";
  }
}
