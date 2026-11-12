/**
 * Skills Client
 *
 * Read access (P1) to the Divinci Skills catalog and a workspace's configured
 * skill instances. Skills are Divinci-authored integrations (Google Calendar,
 * etc.) the AI can invoke during chat; their tools execute server-side with the
 * owner's credentials.
 *
 * - `listCatalog()` / `getCatalog(id)` — the available integrations (sanitized;
 *   no execution code, no scopes-as-secrets).
 * - `list()` / `get(skillId)` — the workspace's enabled/configured instances
 *   (sanitized; never credentials/tokens — `connection` is a status only).
 *
 * Managing instances (create/update/connect) and attaching to a release land in
 * P2/P3 — attaching is a RELEASE update
 * (`releases.update(id, { skillConfig: { catalogSkills } })`).
 */

import { ServerHttpClient } from "../http-client.js";

/** One catalog action, sanitized for transport (no execution code). */
export interface SkillActionPublic {
  name: string;
  description: string;
  /** JSON Schema for the action's arguments. */
  parameters: Record<string, unknown>;
  /** True when the action changes external state. */
  mutates: boolean;
  defaultConfirmationMessage: string;
}

/** A catalog integration, sanitized for transport. */
export interface SkillIntegrationPublic {
  id: string;
  label: string;
  description: string;
  authType: "oauth2" | "api-key" | "basic";
  authFlow?: "popup" | "redirect" | "configurable";
  oauthScopes?: string[];
  actions: SkillActionPublic[];
  /** True when registered + runnable today. */
  available: boolean;
}

export type SkillConnectionStatus =
  | "connected"
  | "expired"
  | "disconnected"
  | "not-required";

export interface SkillToolOverride {
  confirmationMessage?: string;
  requireConfirmation?: boolean;
}

/** An owner's configured instance, sanitized (never credentials/tokens). */
export interface WhitelabelSkillView {
  id: string;
  integrationId: string;
  title: string;
  instanceDescription?: string;
  enabled: boolean;
  connection: SkillConnectionStatus;
  toolOverrides?: Record<string, SkillToolOverride>;
  createdAt?: number;
  updatedAt?: number;
  lastUsedAt?: number;
}

export interface CreateSkillInput {
  /** A catalog integration id from listCatalog(), e.g. "google-calendar". */
  integrationId: string;
  title: string;
  instanceDescription?: string;
  toolOverrides?: Record<string, SkillToolOverride>;
}

export interface UpdateSkillInput {
  title?: string;
  instanceDescription?: string;
  toolOverrides?: Record<string, SkillToolOverride>;
  enabled?: boolean;
}

/** Result of starting an OAuth connect: open `authorizeUrl`, then call
 *  finishConnect with the returned `code` + this `state` + the same redirectUri. */
export interface SkillConnectStart {
  authorizeUrl: string;
  state: string;
}

/**
 * Skills client for server-side (API-key) access. Read (P1) + manage (P2) +
 * OAuth connect (P3). Attaching instances to a release is a RELEASE update
 * (`releases.update(id, { skillConfig: { catalogSkills } })`); `listForRelease`
 * reads them back.
 */
export class SkillsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  // ---- Catalog (read) ----
  /** The available skill integrations (the catalog). */
  async listCatalog(): Promise<SkillIntegrationPublic[]> {
    return this.httpClient.get<SkillIntegrationPublic[]>("/api/v1/skills/catalog");
  }

  /** One catalog integration by id. */
  async getCatalog(integrationId: string): Promise<SkillIntegrationPublic> {
    return this.httpClient.get<SkillIntegrationPublic>(
      `/api/v1/skills/catalog/${encodeURIComponent(integrationId)}`,
    );
  }

  // ---- Instances ----
  /** The workspace's configured skill instances. */
  async list(): Promise<WhitelabelSkillView[]> {
    return this.httpClient.get<WhitelabelSkillView[]>("/api/v1/skills");
  }

  /** One configured instance by id. */
  async get(skillId: string): Promise<WhitelabelSkillView> {
    return this.httpClient.get<WhitelabelSkillView>(
      `/api/v1/skills/${encodeURIComponent(skillId)}`,
    );
  }

  /** Instances enabled on a release (reads release.skillConfig.catalogSkills). */
  async listForRelease(releaseId: string): Promise<WhitelabelSkillView[]> {
    return this.httpClient.get<WhitelabelSkillView[]>(
      `/api/v1/skills/for-release/${encodeURIComponent(releaseId)}`,
    );
  }

  /** Create a configured instance of a catalog integration. */
  async create(input: CreateSkillInput): Promise<WhitelabelSkillView> {
    return this.httpClient.post<WhitelabelSkillView>("/api/v1/skills", input);
  }

  /** Update an instance (title/description/overrides/enabled). */
  async update(skillId: string, input: UpdateSkillInput): Promise<WhitelabelSkillView> {
    return this.httpClient.patch<WhitelabelSkillView>(
      `/api/v1/skills/${encodeURIComponent(skillId)}`,
      input,
    );
  }

  /** Delete an instance and its stored credentials. */
  async remove(skillId: string): Promise<{ deleted: boolean }> {
    return this.httpClient.delete<{ deleted: boolean }>(
      `/api/v1/skills/${encodeURIComponent(skillId)}`,
    );
  }

  // ---- OAuth connect (P3) ----
  /** Begin an OAuth connect for an instance. `redirectUri` must be one the
   *  client controls + that's registered with the provider app. */
  async startConnect(skillId: string, redirectUri: string): Promise<SkillConnectStart> {
    return this.httpClient.post<SkillConnectStart>(
      `/api/v1/skills/${encodeURIComponent(skillId)}/connect/start`,
      { redirectUri },
    );
  }

  /** Complete an OAuth connect with the captured code + the start `state`. */
  async finishConnect(
    skillId: string,
    input: { code: string; state: string; redirectUri: string },
  ): Promise<WhitelabelSkillView> {
    return this.httpClient.post<WhitelabelSkillView>(
      `/api/v1/skills/${encodeURIComponent(skillId)}/connect/finish`,
      input,
    );
  }

  /** Disconnect an instance (clears stored credentials). */
  async disconnect(skillId: string): Promise<WhitelabelSkillView> {
    return this.httpClient.post<WhitelabelSkillView>(
      `/api/v1/skills/${encodeURIComponent(skillId)}/disconnect`,
      {},
    );
  }
}
