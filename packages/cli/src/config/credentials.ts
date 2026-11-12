import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface ProfileData {
  apiKey?: string;
  apiUrl: string;
  authType?: "api-key" | "oauth";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  workspaceId?: string;
  membershipTier?: string;
  userId?: string;
  email?: string;
  lastValidated?: string;
}

export interface CredentialsFile {
  version: number;
  defaultProfile: string;
  profiles: Record<string, ProfileData>;
  /**
   * Consent for automatic error reporting. `undefined` = never asked,
   * `false` = declined, `true` = opted in. Absent means OFF: nothing is sent
   * until someone actively says yes.
   *
   * Stored LOCALLY and not per-profile, unlike `divinci privacy` (which is a
   * server-side account preference). Two reasons it cannot live on the server:
   * the reports worth sending are the ones where authentication is broken, so
   * reading the preference would fail exactly when it matters; and asking the
   * server for permission to report that the server is unreachable is circular.
   */
  errorReporting?: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "divinci");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function emptyCredentials(): CredentialsFile {
  return { version: 1, defaultProfile: "default", profiles: {} };
}

export function loadCredentials(): CredentialsFile {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return emptyCredentials();
    }
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(raw) as CredentialsFile;
  } catch {
    return emptyCredentials();
  }
}

export function saveCredentials(creds: CredentialsFile): void {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function getProfile(profileName?: string): ProfileData | undefined {
  const creds = loadCredentials();
  const name = profileName ?? creds.defaultProfile;
  return creds.profiles[name];
}

export function setProfile(profileName: string, data: ProfileData): void {
  const creds = loadCredentials();
  creds.profiles[profileName] = data;
  saveCredentials(creds);
}

export function deleteProfile(profileName: string): void {
  const creds = loadCredentials();
  delete creds.profiles[profileName];
  saveCredentials(creds);
}

export function setDefaultProfile(profileName: string): void {
  const creds = loadCredentials();
  creds.defaultProfile = profileName;
  saveCredentials(creds);
}

export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}
