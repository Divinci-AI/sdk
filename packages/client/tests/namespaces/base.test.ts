/**
 * BaseNamespace tests
 *
 * Tests for the base namespace class that provides common functionality
 * for all SDK resource namespaces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseNamespace, type NamespaceContext } from "../../src/namespaces/base.js";
import type { HttpClient } from "../../src/http-client.js";

// Create a concrete implementation for testing
class TestNamespace extends BaseNamespace {
  // Expose protected methods for testing
  testGetWorkspaceId(params?: { workspaceId?: string }): string {
    return this.getWorkspaceId(params);
  }

  testGetReleaseId(params?: { releaseId?: string }): string {
    return this.getReleaseId(params);
  }

  testWithContext(updates: Partial<NamespaceContext>): NamespaceContext {
    return this.withContext(updates);
  }

  // Expose protected properties for testing
  getHttpClient(): HttpClient {
    return this.httpClient;
  }

  getContext(): NamespaceContext {
    return this.context;
  }
}

// Mock HttpClient
function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    postFormData: vi.fn(),
    getToken: vi.fn(),
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearTokens: vi.fn(),
  } as unknown as HttpClient;
}

describe("BaseNamespace", () => {
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
  });

  describe("constructor", () => {
    it("should store httpClient and empty context", () => {
      const namespace = new TestNamespace(mockHttpClient);

      expect(namespace.getHttpClient()).toBe(mockHttpClient);
      expect(namespace.getContext()).toEqual({});
    });

    it("should store httpClient and provided context", () => {
      const context: NamespaceContext = {
        workspaceId: "ws-123",
        releaseId: "rel-456",
      };
      const namespace = new TestNamespace(mockHttpClient, context);

      expect(namespace.getHttpClient()).toBe(mockHttpClient);
      expect(namespace.getContext()).toEqual(context);
    });

    it("should accept partial context", () => {
      const context: NamespaceContext = {
        workspaceId: "ws-123",
      };
      const namespace = new TestNamespace(mockHttpClient, context);

      expect(namespace.getContext()).toEqual({ workspaceId: "ws-123" });
    });
  });

  describe("getWorkspaceId", () => {
    it("should return workspaceId from params when provided", () => {
      const context: NamespaceContext = { workspaceId: "context-ws" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testGetWorkspaceId({ workspaceId: "params-ws" });

      expect(result).toBe("params-ws");
    });

    it("should return workspaceId from context when not in params", () => {
      const context: NamespaceContext = { workspaceId: "context-ws" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testGetWorkspaceId();

      expect(result).toBe("context-ws");
    });

    it("should return workspaceId from context when params.workspaceId is undefined", () => {
      const context: NamespaceContext = { workspaceId: "context-ws" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testGetWorkspaceId({ workspaceId: undefined });

      expect(result).toBe("context-ws");
    });

    it("should throw error when workspaceId is not available", () => {
      const namespace = new TestNamespace(mockHttpClient);

      expect(() => namespace.testGetWorkspaceId()).toThrow(
        "workspaceId is required. Either pass it in params or set it via sdk.withWorkspace(id)"
      );
    });

    it("should throw error when params is undefined and context is empty", () => {
      const namespace = new TestNamespace(mockHttpClient, {});

      expect(() => namespace.testGetWorkspaceId(undefined)).toThrow(
        "workspaceId is required"
      );
    });
  });

  describe("getReleaseId", () => {
    it("should return releaseId from params when provided", () => {
      const context: NamespaceContext = { releaseId: "context-rel" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testGetReleaseId({ releaseId: "params-rel" });

      expect(result).toBe("params-rel");
    });

    it("should return releaseId from context when not in params", () => {
      const context: NamespaceContext = { releaseId: "context-rel" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testGetReleaseId();

      expect(result).toBe("context-rel");
    });

    it("should return releaseId from context when params.releaseId is undefined", () => {
      const context: NamespaceContext = { releaseId: "context-rel" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testGetReleaseId({ releaseId: undefined });

      expect(result).toBe("context-rel");
    });

    it("should throw error when releaseId is not available", () => {
      const namespace = new TestNamespace(mockHttpClient);

      expect(() => namespace.testGetReleaseId()).toThrow(
        "releaseId is required. Either pass it in params or set it via sdk.withRelease(id)"
      );
    });

    it("should throw error when params is undefined and context is empty", () => {
      const namespace = new TestNamespace(mockHttpClient, {});

      expect(() => namespace.testGetReleaseId(undefined)).toThrow(
        "releaseId is required"
      );
    });
  });

  describe("withContext", () => {
    it("should merge new context with existing context", () => {
      const context: NamespaceContext = { workspaceId: "ws-123" };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testWithContext({ releaseId: "rel-456" });

      expect(result).toEqual({
        workspaceId: "ws-123",
        releaseId: "rel-456",
      });
    });

    it("should override existing values with updates", () => {
      const context: NamespaceContext = {
        workspaceId: "ws-old",
        releaseId: "rel-old",
      };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testWithContext({ workspaceId: "ws-new" });

      expect(result).toEqual({
        workspaceId: "ws-new",
        releaseId: "rel-old",
      });
    });

    it("should not mutate original context", () => {
      const context: NamespaceContext = { workspaceId: "ws-123" };
      const namespace = new TestNamespace(mockHttpClient, context);

      namespace.testWithContext({ releaseId: "rel-456" });

      expect(namespace.getContext()).toEqual({ workspaceId: "ws-123" });
    });

    it("should handle empty updates", () => {
      const context: NamespaceContext = {
        workspaceId: "ws-123",
        releaseId: "rel-456",
      };
      const namespace = new TestNamespace(mockHttpClient, context);

      const result = namespace.testWithContext({});

      expect(result).toEqual({
        workspaceId: "ws-123",
        releaseId: "rel-456",
      });
    });

    it("should handle empty initial context", () => {
      const namespace = new TestNamespace(mockHttpClient, {});

      const result = namespace.testWithContext({
        workspaceId: "ws-new",
        releaseId: "rel-new",
      });

      expect(result).toEqual({
        workspaceId: "ws-new",
        releaseId: "rel-new",
      });
    });
  });

  describe("context inheritance pattern", () => {
    it("should allow chained context creation", () => {
      const namespace = new TestNamespace(mockHttpClient);

      // First update
      const context1 = namespace.testWithContext({ workspaceId: "ws-123" });
      expect(context1).toEqual({ workspaceId: "ws-123" });

      // Create new namespace with updated context
      const namespace2 = new TestNamespace(mockHttpClient, context1);
      const context2 = namespace2.testWithContext({ releaseId: "rel-456" });

      expect(context2).toEqual({
        workspaceId: "ws-123",
        releaseId: "rel-456",
      });
    });
  });
});
