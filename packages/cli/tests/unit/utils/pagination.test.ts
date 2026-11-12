import { describe, it, expect } from "vitest";
import {
  buildPaginationParams,
  type PaginationOptions,
} from "../../../src/utils/pagination.js";

describe("pagination", () => {
  describe("buildPaginationParams", () => {
    it("returns empty object when no options are set", () => {
      const result = buildPaginationParams({});

      expect(result).toEqual({});
    });

    it("includes limit when specified", () => {
      const result = buildPaginationParams({ limit: 10 });

      expect(result).toEqual({ limit: 10 });
    });

    it("includes offset when specified", () => {
      const result = buildPaginationParams({ offset: 20 });

      expect(result).toEqual({ offset: 20 });
    });

    it("includes page when specified", () => {
      const result = buildPaginationParams({ page: 3 });

      expect(result).toEqual({ page: 3 });
    });

    it("includes all options when all are specified", () => {
      const result = buildPaginationParams({ limit: 25, offset: 50, page: 3 });

      expect(result).toEqual({ limit: 25, offset: 50, page: 3 });
    });

    it("excludes undefined values", () => {
      const result = buildPaginationParams({ limit: 10, offset: undefined, page: undefined });

      expect(result).toEqual({ limit: 10 });
      expect(Object.keys(result)).toEqual(["limit"]);
    });

    it("includes limit of 0", () => {
      const result = buildPaginationParams({ limit: 0 });

      expect(result).toEqual({ limit: 0 });
    });

    it("includes offset of 0", () => {
      const result = buildPaginationParams({ offset: 0 });

      expect(result).toEqual({ offset: 0 });
    });

    it("includes page of 0", () => {
      const result = buildPaginationParams({ page: 0 });

      expect(result).toEqual({ page: 0 });
    });
  });
});
