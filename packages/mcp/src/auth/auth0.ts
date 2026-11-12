/**
 * Auth0 Authentication for MCP
 *
 * Implements OAuth 2.0 PKCE flow for MCP server authentication
 */

import type { McpAuthOptions } from "../types.js";

/**
 * Auth0 token response
 */
export interface Auth0TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/**
 * Auth0 user info
 */
export interface Auth0UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nickname?: string;
  picture?: string;
}

/**
 * Token storage interface
 */
export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  setAccessToken(token: string, expiresAt: number): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory token storage
 */
class MemoryTokenStorage implements TokenStorage {
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number = 0;
  private refreshToken: string | null = null;

  async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    return null;
  }

  async setAccessToken(token: string, expiresAt: number): Promise<void> {
    this.accessToken = token;
    this.accessTokenExpiresAt = expiresAt;
  }

  async getRefreshToken(): Promise<string | null> {
    return this.refreshToken;
  }

  async setRefreshToken(token: string): Promise<void> {
    this.refreshToken = token;
  }

  async clear(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.refreshToken = null;
  }
}

/**
 * Auth0 authentication handler
 */
export class Auth0Handler {
  private readonly options: Required<McpAuthOptions>;
  private readonly tokenStorage: TokenStorage;
  private codeVerifier: string | null = null;

  constructor(options: McpAuthOptions, tokenStorage?: TokenStorage) {
    this.options = {
      auth0Audience: `https://${options.auth0Domain}/api/v2/`,
      redirectUri: typeof window !== "undefined" ? window.location.origin : "",
      scopes: ["openid", "profile", "email", "offline_access"],
      ...options,
    };
    this.tokenStorage = tokenStorage ?? new MemoryTokenStorage();
  }

  /**
   * Generate authorization URL for PKCE flow
   */
  async getAuthorizationUrl(state?: string): Promise<string> {
    // Generate PKCE code verifier and challenge
    this.codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(this.codeVerifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.options.auth0ClientId,
      redirect_uri: this.options.redirectUri,
      scope: this.options.scopes.join(" "),
      audience: this.options.auth0Audience,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    if (state) {
      params.set("state", state);
    }

    return `https://${this.options.auth0Domain}/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<Auth0TokenResponse> {
    if (!this.codeVerifier) {
      throw new Error("No code verifier - call getAuthorizationUrl first");
    }

    const response = await fetch(`https://${this.options.auth0Domain}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.options.auth0ClientId,
        code_verifier: this.codeVerifier,
        code,
        redirect_uri: this.options.redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${errorText.substring(0, 200)}`);
      }
      throw new Error(error.error_description || "Token exchange failed");
    }

    const tokensText = await response.text();
    let tokens: Auth0TokenResponse;
    try {
      tokens = JSON.parse(tokensText) as Auth0TokenResponse;
    } catch {
      throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${tokensText.substring(0, 200)}`);
    }

    // Store tokens
    await this.tokenStorage.setAccessToken(
      tokens.access_token,
      Date.now() + tokens.expires_in * 1000
    );

    if (tokens.refresh_token) {
      await this.tokenStorage.setRefreshToken(tokens.refresh_token);
    }

    // Clear code verifier
    this.codeVerifier = null;

    return tokens;
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<Auth0TokenResponse | null> {
    const refreshToken = await this.tokenStorage.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    try {
      const response = await fetch(`https://${this.options.auth0Domain}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: this.options.auth0ClientId,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        await this.tokenStorage.clear();
        return null;
      }

      const tokensText = await response.text();
      let tokens: Auth0TokenResponse;
      try {
        tokens = JSON.parse(tokensText) as Auth0TokenResponse;
      } catch {
        throw new Error(`Failed to parse response as JSON (status: ${response.status}): ${tokensText.substring(0, 200)}`);
      }

      await this.tokenStorage.setAccessToken(
        tokens.access_token,
        Date.now() + tokens.expires_in * 1000
      );

      if (tokens.refresh_token) {
        await this.tokenStorage.setRefreshToken(tokens.refresh_token);
      }

      return tokens;
    } catch {
      await this.tokenStorage.clear();
      return null;
    }
  }

  /**
   * Get current access token (refreshing if needed)
   */
  async getAccessToken(): Promise<string | null> {
    let token = await this.tokenStorage.getAccessToken();

    if (!token) {
      const refreshed = await this.refreshAccessToken();
      token = refreshed?.access_token ?? null;
    }

    return token;
  }

  /**
   * Get user info from Auth0
   */
  async getUserInfo(): Promise<Auth0UserInfo | null> {
    const token = await this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`https://${this.options.auth0Domain}/userinfo`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const userInfoText = await response.text();
      try {
        return JSON.parse(userInfoText) as Auth0UserInfo;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return token !== null;
  }

  /**
   * Logout (clear tokens)
   */
  async logout(): Promise<void> {
    await this.tokenStorage.clear();
  }

  /**
   * Get logout URL
   */
  getLogoutUrl(returnTo?: string): string {
    const params = new URLSearchParams({
      client_id: this.options.auth0ClientId,
    });

    if (returnTo) {
      params.set("returnTo", returnTo);
    }

    return `https://${this.options.auth0Domain}/v2/logout?${params.toString()}`;
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  /**
   * Generate PKCE code challenge from verifier
   */
  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return this.base64UrlEncode(new Uint8Array(digest));
  }

  /**
   * Base64 URL encode
   */
  private base64UrlEncode(buffer: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}
