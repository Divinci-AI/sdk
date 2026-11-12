/**
 * Auth0Handler tests
 *
 * Tests for Auth0 PKCE authentication flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Auth0Handler, type TokenStorage } from "../src/auth/auth0.js";

// Mock fetch
function createMockFetch(response: {
  status?: number;
  ok?: boolean;
  body?: unknown;
}) {
  const bodyData = response.body ?? {};
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? (response.status === 200 || response.status === undefined),
    status: response.status ?? 200,
    json: vi.fn().mockResolvedValue(bodyData),
    text: vi.fn().mockResolvedValue(JSON.stringify(bodyData)),
  });
}

describe("Auth0Handler", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should set default options", () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      expect(handler).toBeDefined();
    });

    it("should use custom token storage", () => {
      const customStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        customStorage
      );

      expect(handler).toBeDefined();
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should generate URL with PKCE code challenge", async () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
        redirectUri: "https://app.test.com/callback",
      });

      const url = await handler.getAuthorizationUrl();

      expect(url).toContain("https://test.auth0.com/authorize");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=client-123");
      expect(url).toContain("code_challenge=");
      expect(url).toContain("code_challenge_method=S256");
    });

    it("should include all required params", async () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
        redirectUri: "https://app.test.com/callback",
        scopes: ["openid", "profile", "email"],
        auth0Audience: "https://api.test.com",
      });

      const url = await handler.getAuthorizationUrl();

      expect(url).toContain("redirect_uri=https%3A%2F%2Fapp.test.com%2Fcallback");
      expect(url).toContain("scope=openid+profile+email");
      expect(url).toContain("audience=https%3A%2F%2Fapi.test.com");
    });

    it("should include state if provided", async () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      const url = await handler.getAuthorizationUrl("my-state-value");

      expect(url).toContain("state=my-state-value");
    });

    it("should generate different code challenge each time", async () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      const url1 = await handler.getAuthorizationUrl();
      const url2 = await handler.getAuthorizationUrl();

      const getCodeChallenge = (url: string) => {
        const match = url.match(/code_challenge=([^&]+)/);
        return match ? match[1] : null;
      };

      expect(getCodeChallenge(url1)).not.toBe(getCodeChallenge(url2));
    });
  });

  describe("exchangeCode", () => {
    it("should throw if no code verifier", async () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      // Don't call getAuthorizationUrl first
      await expect(handler.exchangeCode("auth-code")).rejects.toThrow(
        "No code verifier"
      );
    });

    it("should send correct request to Auth0", async () => {
      const mockFetch = createMockFetch({
        body: {
          access_token: "access-token-123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-token-456",
        },
      });
      globalThis.fetch = mockFetch;

      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
        redirectUri: "https://app.test.com/callback",
      });

      // Generate code verifier
      await handler.getAuthorizationUrl();

      // Exchange code
      await handler.exchangeCode("auth-code-789");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.auth0.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining('"grant_type":"authorization_code"'),
        })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.client_id).toBe("client-123");
      expect(callBody.code).toBe("auth-code-789");
      expect(callBody.redirect_uri).toBe("https://app.test.com/callback");
      expect(callBody.code_verifier).toBeDefined();
    });

    it("should store tokens on success", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      globalThis.fetch = createMockFetch({
        body: {
          access_token: "new-access-token",
          token_type: "Bearer",
          expires_in: 7200,
          refresh_token: "new-refresh-token",
        },
      });

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      await handler.getAuthorizationUrl();
      await handler.exchangeCode("code");

      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        "new-access-token",
        expect.any(Number)
      );
      expect(mockStorage.setRefreshToken).toHaveBeenCalledWith("new-refresh-token");
    });

    it("should clear code verifier after exchange", async () => {
      globalThis.fetch = createMockFetch({
        body: {
          access_token: "token",
          token_type: "Bearer",
          expires_in: 3600,
        },
      });

      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      await handler.getAuthorizationUrl();
      await handler.exchangeCode("code");

      // Second exchange should fail
      await expect(handler.exchangeCode("another-code")).rejects.toThrow(
        "No code verifier"
      );
    });

    it("should throw on Auth0 error", async () => {
      globalThis.fetch = createMockFetch({
        status: 400,
        ok: false,
        body: {
          error: "invalid_grant",
          error_description: "Invalid authorization code",
        },
      });

      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      await handler.getAuthorizationUrl();

      await expect(handler.exchangeCode("bad-code")).rejects.toThrow(
        "Invalid authorization code"
      );
    });
  });

  describe("refreshAccessToken", () => {
    it("should return null if no refresh token", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const result = await handler.refreshAccessToken();

      expect(result).toBeNull();
    });

    it("should clear tokens on failure", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("old-refresh-token"),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      globalThis.fetch = createMockFetch({
        status: 401,
        ok: false,
        body: { error: "invalid_grant" },
      });

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const result = await handler.refreshAccessToken();

      expect(result).toBeNull();
      expect(mockStorage.clear).toHaveBeenCalled();
    });

    it("should update tokens on success", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      globalThis.fetch = createMockFetch({
        body: {
          access_token: "refreshed-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "new-refresh-token",
        },
      });

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const result = await handler.refreshAccessToken();

      expect(result).not.toBeNull();
      expect(result?.access_token).toBe("refreshed-access-token");
      expect(mockStorage.setAccessToken).toHaveBeenCalledWith(
        "refreshed-access-token",
        expect.any(Number)
      );
      expect(mockStorage.setRefreshToken).toHaveBeenCalledWith("new-refresh-token");
    });

    it("should handle network errors gracefully", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const result = await handler.refreshAccessToken();

      expect(result).toBeNull();
      expect(mockStorage.clear).toHaveBeenCalled();
    });
  });

  describe("getAccessToken", () => {
    it("should return token from storage if valid", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue("valid-token"),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const token = await handler.getAccessToken();

      expect(token).toBe("valid-token");
    });

    it("should refresh token if storage returns null", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      globalThis.fetch = createMockFetch({
        body: {
          access_token: "new-token-from-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        },
      });

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const token = await handler.getAccessToken();

      expect(token).toBe("new-token-from-refresh");
    });

    it("should return null if refresh fails", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const token = await handler.getAccessToken();

      expect(token).toBeNull();
    });
  });

  describe("getUserInfo", () => {
    it("should fetch user info from Auth0", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue("valid-token"),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      globalThis.fetch = createMockFetch({
        body: {
          sub: "auth0|123",
          email: "user@test.com",
          name: "Test User",
        },
      });

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const userInfo = await handler.getUserInfo();

      expect(userInfo?.sub).toBe("auth0|123");
      expect(userInfo?.email).toBe("user@test.com");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://test.auth0.com/userinfo",
        expect.objectContaining({
          headers: { Authorization: "Bearer valid-token" },
        })
      );
    });

    it("should return null if no token", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const userInfo = await handler.getUserInfo();

      expect(userInfo).toBeNull();
    });
  });

  describe("isAuthenticated", () => {
    it("should return true if token exists", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue("token"),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const isAuth = await handler.isAuthenticated();

      expect(isAuth).toBe(true);
    });

    it("should return false if no token", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue(null),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue(null),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      const isAuth = await handler.isAuthenticated();

      expect(isAuth).toBe(false);
    });
  });

  describe("logout", () => {
    it("should clear tokens", async () => {
      const mockStorage: TokenStorage = {
        getAccessToken: vi.fn().mockResolvedValue("token"),
        setAccessToken: vi.fn(),
        getRefreshToken: vi.fn().mockResolvedValue("refresh"),
        setRefreshToken: vi.fn(),
        clear: vi.fn(),
      };

      const handler = new Auth0Handler(
        {
          auth0Domain: "test.auth0.com",
          auth0ClientId: "client-123",
        },
        mockStorage
      );

      await handler.logout();

      expect(mockStorage.clear).toHaveBeenCalled();
    });
  });

  describe("getLogoutUrl", () => {
    it("should return logout URL", () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      const url = handler.getLogoutUrl();

      expect(url).toContain("https://test.auth0.com/v2/logout");
      expect(url).toContain("client_id=client-123");
    });

    it("should include returnTo if provided", () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      const url = handler.getLogoutUrl("https://app.test.com");

      expect(url).toContain("returnTo=https%3A%2F%2Fapp.test.com");
    });
  });

  describe("base64UrlEncode", () => {
    it("should replace + with -", async () => {
      const handler = new Auth0Handler({
        auth0Domain: "test.auth0.com",
        auth0ClientId: "client-123",
      });

      const url = await handler.getAuthorizationUrl();
      const codeChallenge = url.match(/code_challenge=([^&]+)/)?.[1] || "";

      // URL-safe base64 should not contain +
      expect(codeChallenge).not.toContain("+");
      expect(codeChallenge).not.toContain("/");
      expect(codeChallenge).not.toContain("=");
    });
  });
});
