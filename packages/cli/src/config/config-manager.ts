import * as fs from "node:fs";
import * as path from "node:path";
import { getProfile, setProfile } from "./credentials.js";

export interface ResolvedConfig {
  apiKey?: string;
  apiUrl: string;
  authType: "api-key" | "oauth";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  workspaceId?: string;
  profile: string;
  source: string;
}

interface ProjectConfig {
  apiKey?: string;
  apiUrl?: string;
  workspaceId?: string;
  profile?: string;
}

interface CliFlags {
  apiKey?: string;
  apiUrl?: string;
  workspace?: string;
  profile?: string;
}

function loadProjectConfig(): ProjectConfig | undefined {
  const configPath = path.join(process.cwd(), ".divinci", "config.json");
  try {
    if (!fs.existsSync(configPath)) return undefined;
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return undefined;
  }
}

/**
 * Resolve configuration with priority:
 * 1. CLI flags (--api-key, --workspace, --profile)
 * 2. Environment variables (DIVINCI_API_KEY, DIVINCI_WORKSPACE_ID, DIVINCI_API_URL)
 * 3. Project-level .divinci/config.json
 * 4. User-level ~/.config/divinci/credentials.json
 */
export function resolveConfig(flags: CliFlags): ResolvedConfig | undefined {
  // Determine profile name
  const profileName = flags.profile ?? process.env.DIVINCI_PROFILE ?? "default";

  // 1. CLI flags
  if (flags.apiKey) {
    return {
      apiKey: flags.apiKey,
      apiUrl: flags.apiUrl ?? process.env.DIVINCI_API_URL ?? "https://api.divinci.app",
      authType: "api-key",
      workspaceId: flags.workspace ?? process.env.DIVINCI_WORKSPACE_ID,
      profile: profileName,
      source: "cli-flag",
    };
  }

  // 2. Environment variables
  const envApiKey = process.env.DIVINCI_API_KEY;
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      apiUrl: flags.apiUrl ?? process.env.DIVINCI_API_URL ?? "https://api.divinci.app",
      authType: "api-key",
      workspaceId: flags.workspace ?? process.env.DIVINCI_WORKSPACE_ID,
      profile: profileName,
      source: "env",
    };
  }

  // 3. Project config
  const projectConfig = loadProjectConfig();
  if (projectConfig?.apiKey) {
    return {
      apiKey: projectConfig.apiKey,
      apiUrl: flags.apiUrl ?? projectConfig.apiUrl ?? "https://api.divinci.app",
      authType: "api-key",
      workspaceId: flags.workspace ?? projectConfig.workspaceId,
      profile: profileName,
      source: "project",
    };
  }

  // 4. User credentials
  const profile = getProfile(profileName);
  if (profile) {
    // OAuth profile
    if (profile.authType === "oauth" && profile.accessToken) {
      return {
        apiUrl: flags.apiUrl ?? profile.apiUrl ?? "https://api.divinci.app",
        authType: "oauth",
        accessToken: profile.accessToken,
        refreshToken: profile.refreshToken,
        expiresAt: profile.expiresAt,
        workspaceId: flags.workspace ?? profile.workspaceId,
        profile: profileName,
        source: "credentials",
      };
    }
    // API key profile
    if (profile.apiKey) {
      return {
        apiKey: profile.apiKey,
        apiUrl: flags.apiUrl ?? profile.apiUrl ?? "https://api.divinci.app",
        authType: "api-key",
        workspaceId: flags.workspace ?? profile.workspaceId,
        profile: profileName,
        source: "credentials",
      };
    }
  }

  return undefined;
}

export function requireConfig(flags: CliFlags): ResolvedConfig {
  const config = resolveConfig(flags);
  if (!config) {
    throw new Error(
      "Not authenticated. Run `divinci auth login` or set DIVINCI_API_KEY environment variable."
    );
  }
  return config;
}

export function requireWorkspaceId(config: ResolvedConfig): string {
  if (!config.workspaceId) {
    throw new Error(
      "No workspace selected. Run `divinci workspace use <id>` or pass --workspace <id>."
    );
  }
  return config.workspaceId;
}

/**
 * Ensure the current OAuth token is valid. If expired, attempt refresh.
 * Returns the (potentially updated) config.
 */
export async function ensureValidToken(config: ResolvedConfig): Promise<ResolvedConfig> {
  if (config.authType !== "oauth" || !config.expiresAt) {
    return config;
  }

  const expiresAt = new Date(config.expiresAt).getTime();
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  // Token still valid with >5 min remaining
  if (expiresAt - now > fiveMinutes) {
    return config;
  }

  // Need to refresh
  if (!config.refreshToken) {
    throw new Error("Session expired. Run `divinci auth login` to re-authenticate.");
  }

  // Dynamic import to avoid circular dependency
  const { refreshTokens, getAuth0Config } = await import("../auth/oauth.js");
  const auth0Config = getAuth0Config(config.apiUrl);

  try {
    const tokens = await refreshTokens({
      auth0Config,
      refreshToken: config.refreshToken,
    });

    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Merge with existing profile to preserve email, userId, etc.
    const existingProfile = getProfile(config.profile);
    setProfile(config.profile, {
      ...existingProfile,
      apiUrl: config.apiUrl,
      authType: "oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? config.refreshToken,
      expiresAt: newExpiresAt,
      workspaceId: config.workspaceId,
    });

    return {
      ...config,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? config.refreshToken,
      expiresAt: newExpiresAt,
    };
  } catch {
    throw new Error("Session expired. Run `divinci auth login` to re-authenticate.");
  }
}

/**
 * Get the route base path depending on auth type.
 * OAuth users use internal whitelabel routes; API key users use v1 consumer routes.
 */
export function getRouteBase(config: ResolvedConfig): string {
  if (config.authType === "oauth") {
    if (!config.workspaceId) {
      throw new Error(
        "OAuth login requires a workspace. Run `divinci workspace use <id>` or pass --workspace <id>."
      );
    }
    return `/white-label/${config.workspaceId}`;
  }
  return "/api/v1";
}

/**
 * Derive the web client URL from the API URL.
 * Replaces `api.` prefix in the hostname with `chat.`.
 * Returns null if the pattern doesn't match and no webUrl override is set.
 * Respects an optional `webUrl` field in the config for custom/self-hosted deployments.
 */
export function getWebUrl(config: ResolvedConfig & { webUrl?: string }): string | null {
  if (config.webUrl) return config.webUrl.replace(/\/+$/, "");
  try {
    const u = new URL(config.apiUrl);
    if (!u.hostname.startsWith("api.")) return null;
    u.hostname = u.hostname.replace(/^api\./, "chat.");
    return u.origin;
  } catch {
    return null;
  }
}
