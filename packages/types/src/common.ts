/**
 * Common types shared across the SDK
 */

/**
 * Pagination options for list operations
 */
export interface PaginationOptions {
  /** Maximum number of items to return */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
  /** Page number (alternative to cursor) */
  page?: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  /** The data items */
  data: T[];
  /** Whether there are more items */
  hasMore: boolean;
  /** Cursor for next page */
  nextCursor?: string;
  /** Total count (if available) */
  total?: number;
}

/**
 * Date range filter
 */
export interface DateRange {
  /** Start date (ISO 8601) */
  startDate?: string;
  /** End date (ISO 8601) */
  endDate?: string;
}

/**
 * Sort options
 */
export interface SortOptions {
  /** Field to sort by */
  field: string;
  /** Sort direction */
  direction: "asc" | "desc";
}

/**
 * Generic ID type (MongoDB ObjectId as string)
 */
export type ObjectId = string;

/**
 * Timestamp in milliseconds
 */
export type Timestamp = number;

/**
 * ISO 8601 date string
 */
export type ISODateString = string;

/**
 * HTTP request method
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * API response envelope
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Metadata attached to resources
 */
export interface ResourceMetadata {
  /** Creation timestamp */
  createdAt: ISODateString;
  /** Last update timestamp */
  updatedAt: ISODateString;
  /** Creator user ID */
  createdBy?: ObjectId;
}
