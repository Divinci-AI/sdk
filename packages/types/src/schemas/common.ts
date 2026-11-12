/**
 * Common Zod schemas shared across the SDK
 */

import { z } from "zod";

/**
 * MongoDB ObjectId as string (24 hex characters)
 */
export const ObjectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId format");

/**
 * ISO 8601 date string
 */
export const ISODateStringSchema = z.string().datetime({ offset: true }).or(z.string().datetime());

/**
 * Timestamp in milliseconds
 */
export const TimestampSchema = z.number().int().nonnegative();

/**
 * HTTP request method
 */
export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Pagination options for list operations
 */
export const PaginationOptionsSchema = z.object({
  /** Maximum number of items to return */
  limit: z.number().int().positive().max(100).optional(),
  /** Cursor for pagination */
  cursor: z.string().optional(),
  /** Page number (alternative to cursor) */
  page: z.number().int().positive().optional(),
});

/**
 * Paginated response wrapper
 */
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    /** The data items */
    data: z.array(itemSchema),
    /** Whether there are more items */
    hasMore: z.boolean(),
    /** Cursor for next page */
    nextCursor: z.string().optional(),
    /** Total count (if available) */
    total: z.number().int().nonnegative().optional(),
  });

/**
 * Date range filter
 */
export const DateRangeSchema = z.object({
  /** Start date (ISO 8601) */
  startDate: z.string().optional(),
  /** End date (ISO 8601) */
  endDate: z.string().optional(),
});

/**
 * Sort direction
 */
export const SortDirectionSchema = z.enum(["asc", "desc"]);

/**
 * Sort options
 */
export const SortOptionsSchema = z.object({
  /** Field to sort by */
  field: z.string(),
  /** Sort direction */
  direction: SortDirectionSchema,
});

/**
 * Resource metadata
 */
export const ResourceMetadataSchema = z.object({
  /** Creation timestamp */
  createdAt: ISODateStringSchema,
  /** Last update timestamp */
  updatedAt: ISODateStringSchema,
  /** Creator user ID */
  createdBy: ObjectIdSchema.optional(),
});

/**
 * API response envelope
 */
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  });

/**
 * RAG context attached to a message
 */
export const ChatMessageContextSchema = z.object({
  /** Vector ID */
  vectorId: z.string(),
  /** Content chunk */
  content: z.string(),
  /** Source file metadata */
  metadata: z.object({
    /** Original file name */
    originalName: z.string(),
    /** File object key */
    fileObjectKey: z.string(),
    /** Token count of this chunk */
    tokenCount: z.number().int().nonnegative(),
  }),
  /** Similarity score */
  score: z.number().min(0).max(1).optional(),
});

// Type exports using z.infer
export type ObjectId = z.infer<typeof ObjectIdSchema>;
export type ISODateString = z.infer<typeof ISODateStringSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type PaginationOptions = z.infer<typeof PaginationOptionsSchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
export type SortDirection = z.infer<typeof SortDirectionSchema>;
export type SortOptions = z.infer<typeof SortOptionsSchema>;
export type ResourceMetadata = z.infer<typeof ResourceMetadataSchema>;
export type ChatMessageContext = z.infer<typeof ChatMessageContextSchema>;
