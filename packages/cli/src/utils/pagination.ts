export interface PaginationOptions {
  limit?: number;
  offset?: number;
  page?: number;
}

export function buildPaginationParams(
  options: PaginationOptions
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (options.limit !== undefined) params.limit = options.limit;
  if (options.offset !== undefined) params.offset = options.offset;
  if (options.page !== undefined) params.page = options.page;
  return params;
}
