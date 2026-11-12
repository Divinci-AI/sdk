/**
 * @divinci-ai/types - Validation Utilities
 *
 * Runtime validation utilities using Zod schemas.
 * Provides type-safe validation with detailed error reporting.
 */

import { z, ZodError, ZodSchema } from "zod";

/**
 * Validation result - success case
 */
export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

/**
 * Validation result - failure case
 */
export interface ValidationFailure {
  success: false;
  errors: ValidationIssue[];
  /** Raw Zod error for advanced use cases */
  zodError: ZodError;
}

/**
 * A single validation issue
 */
export interface ValidationIssue {
  /** Path to the invalid field (e.g., ["user", "email"]) */
  path: (string | number)[];
  /** Human-readable error message */
  message: string;
  /** Zod error code */
  code: string;
  /** Expected type/value */
  expected?: string;
  /** Received value type */
  received?: string;
}

/**
 * Validation result type
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validate data against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns ValidationResult with typed data on success or errors on failure
 *
 * @example
 * ```typescript
 * import { validate } from "@divinci-ai/types/validation";
 * import { ChatMessageSchema } from "@divinci-ai/types/schemas";
 *
 * const result = validate(ChatMessageSchema, apiResponse);
 * if (result.success) {
 *   console.log(result.data.content); // typed as ChatMessage
 * } else {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
    zodError: result.error,
  };
}

/**
 * Validate data and throw on failure
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Optional context for error messages
 * @returns Validated and typed data
 * @throws DivinciValidationError if validation fails
 *
 * @example
 * ```typescript
 * import { validateOrThrow } from "@divinci-ai/types/validation";
 * import { ChatMessageSchema } from "@divinci-ai/types/schemas";
 *
 * try {
 *   const message = validateOrThrow(ChatMessageSchema, apiResponse, "API response");
 *   console.log(message.content);
 * } catch (error) {
 *   if (error instanceof DivinciValidationError) {
 *     console.error("Validation failed:", error.issues);
 *   }
 * }
 * ```
 */
export function validateOrThrow<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = validate(schema, data);

  if (!result.success) {
    throw new DivinciValidationError(result.errors, context, result.zodError);
  }

  return result.data;
}

/**
 * Validate async (for schemas with async refinements)
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Promise resolving to ValidationResult
 */
export async function validateAsync<T>(
  schema: ZodSchema<T>,
  data: unknown
): Promise<ValidationResult<T>> {
  const result = await schema.safeParseAsync(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
    zodError: result.error,
  };
}

/**
 * Validate multiple items against a schema
 *
 * @param schema - Zod schema to validate against
 * @param items - Array of items to validate
 * @returns Object with valid items and validation errors
 *
 * @example
 * ```typescript
 * const { valid, invalid } = validateMany(ChatMessageSchema, messages);
 * console.log(`${valid.length} valid, ${invalid.length} invalid`);
 * ```
 */
export function validateMany<T>(
  schema: ZodSchema<T>,
  items: unknown[]
): {
  valid: T[];
  invalid: Array<{ index: number; item: unknown; errors: ValidationIssue[] }>;
} {
  const valid: T[] = [];
  const invalid: Array<{ index: number; item: unknown; errors: ValidationIssue[] }> = [];

  items.forEach((item, index) => {
    const result = validate(schema, item);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ index, item, errors: result.errors });
    }
  });

  return { valid, invalid };
}

/**
 * Create a validator function for a specific schema
 *
 * @param schema - Zod schema
 * @returns Validator function
 *
 * @example
 * ```typescript
 * const validateMessage = createValidator(ChatMessageSchema);
 * const result = validateMessage(data);
 * ```
 */
export function createValidator<T>(schema: ZodSchema<T>) {
  return (data: unknown): ValidationResult<T> => validate(schema, data);
}

/**
 * Create an assertion function for a specific schema
 *
 * @param schema - Zod schema
 * @param context - Optional default context for error messages
 * @returns Assertion function that throws on invalid data
 *
 * @example
 * ```typescript
 * const assertMessage = createAssertion(ChatMessageSchema, "ChatMessage");
 * const message = assertMessage(data); // throws if invalid
 * ```
 */
export function createAssertion<T>(schema: ZodSchema<T>, context?: string) {
  return (data: unknown): T => validateOrThrow(schema, data, context);
}

/**
 * Format Zod errors into ValidationIssue array
 */
function formatZodErrors(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
    expected: "expected" in issue ? String(issue.expected) : undefined,
    received: "received" in issue ? String(issue.received) : undefined,
  }));
}

/**
 * Custom validation error class
 */
export class DivinciValidationError extends Error {
  /** Structured validation issues */
  public readonly issues: ValidationIssue[];
  /** Context where validation failed */
  public readonly context?: string;
  /** Original Zod error */
  public readonly zodError: ZodError;

  constructor(issues: ValidationIssue[], context?: string, zodError?: ZodError) {
    const contextPrefix = context ? `[${context}] ` : "";
    const message = `${contextPrefix}Validation failed: ${issues.map((i) => i.message).join(", ")}`;

    super(message);
    this.name = "DivinciValidationError";
    this.issues = issues;
    this.context = context;
    this.zodError = zodError ?? new ZodError([]);

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DivinciValidationError);
    }
  }

  /**
   * Get errors formatted for API response
   */
  toJSON(): {
    code: string;
    message: string;
    details: { fieldErrors: ValidationIssue[] };
  } {
    return {
      code: "validation_error",
      message: this.message,
      details: {
        fieldErrors: this.issues,
      },
    };
  }
}

/**
 * Check if an error is a DivinciValidationError
 */
export function isValidationError(error: unknown): error is DivinciValidationError {
  return error instanceof DivinciValidationError;
}

/**
 * Partial validation - validate only provided fields
 * Useful for PATCH requests where only some fields are provided
 *
 * @param schema - Full Zod schema
 * @param data - Partial data to validate
 * @returns ValidationResult with partial data
 */
export function validatePartial<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  data: unknown
): ValidationResult<Partial<z.infer<z.ZodObject<T>>>> {
  return validate(schema.partial(), data);
}

/**
 * Strip unknown fields during validation
 * Returns data with only known fields
 *
 * @param schema - Zod schema
 * @param data - Data to validate and strip
 * @returns ValidationResult with stripped data
 */
export function validateStrict<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  // If it's an object schema, use strict mode
  if (schema instanceof z.ZodObject) {
    // schema.strict() preserves the same shape but rejects unknown keys
    // We need to cast because TypeScript can't infer the strict schema has same output type
    return validate(schema.strict() as unknown as ZodSchema<T>, data);
  }
  return validate(schema, data);
}
