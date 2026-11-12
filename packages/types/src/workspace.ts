/**
 * Workspace types
 */

import type { ObjectId, ResourceMetadata } from "./common.js";

/**
 * Workspace (whitelabel)
 */
export interface Workspace {
  /** Workspace ID (normalized from `_id` by the SDK) */
  id: ObjectId;
  /**
   * Workspace name.
   * @deprecated Wire sends `title`, not `name`. Use `title`.
   * The server SDK normalizes `title` → `name` for backwards compatibility.
   */
  name?: string;
  /** Workspace title (wire field name) */
  title?: string;
  /** Workspace slug (URL-safe identifier) */
  slug?: string;
  /** Description */
  description?: string;
  /**
   * Owner user ID (declared alias).
   * @deprecated Wire sends `ownerUser` (string). Use `ownerUser`.
   */
  ownerId?: ObjectId;
  /** Owner Auth0 user ID as returned by wire */
  ownerUser?: string;
  /** Workspace settings (present on server-SDK routes) */
  settings?: WorkspaceSettings;
  /** Workspace limits (present on server-SDK routes) */
  limits?: WorkspaceLimits;
  /** Resource metadata (present on server-SDK routes) */
  metadata?: ResourceMetadata;
  /** Release IDs belonging to this workspace (from ux summary routes) */
  releaseIds?: string[];
  /** Number of releases (summary count from ux routes) */
  releaseCount?: number;
  /** Number of chat threads (summary count from ux routes) */
  chatCount?: number;
  /** Number of users (summary count from ux routes) */
  userCount?: number;
  /**
   * True when the workspace is HIPAA-scoped (a Business Associate Agreement
   * was accepted for it). Absent means never configured, which reads the same
   * as false everywhere.
   */
  hipaaScoped?: boolean;
}

/**
 * The assent a HIPAA-scoped workspace records at creation. Same payload the
 * Compliance page sends.
 */
export interface HipaaCreationAssent {
  /** Hash of the agreement text the signer was shown (`BaaAgreement.versionHash`). */
  versionHash: string;
  /** Signer's title; both signer fields are required and recorded as evidence. */
  signerTitle: string;
  /** Legal name of the organization the signer binds. */
  organizationLegalName: string;
}

/**
 * Result of accepting the agreement as part of creation.
 */
export interface HipaaCreationResult {
  accepted: true;
  version: string;
  versionHash: string;
  acceptedAt: number;
  /**
   * True while no model provider is BAA-covered: the workspace is scoped but
   * chat refuses until one is.
   */
  chatBlockedUntilVendorBaa: boolean;
}

/**
 * The Business Associate Agreement as a creation form needs it, before any
 * workspace exists.
 */
export interface BaaAgreement {
  /** False while the text has not been approved by counsel; creation with `hipaa` is refused. */
  available: boolean;
  version: string;
  /** Echo this back as `hipaa.versionHash` to prove which text was shown. */
  versionHash: string;
  title: string;
  content: string;
  /**
   * True while no model provider is BAA-covered, so a workspace scoped now
   * cannot chat yet. Derived by the server; absent from an older server, which
   * could only ever have meant true.
   */
  chatBlockedUntilVendorBaa?: boolean;
}

/**
 * Workspace settings
 */
export interface WorkspaceSettings {
  /** Default model for new releases */
  defaultModel?: string;
  /** Default temperature */
  defaultTemperature?: number;
  /** Enable analytics */
  analyticsEnabled?: boolean;
  /** Enable webhooks */
  webhooksEnabled?: boolean;
  /** Notification email */
  notificationEmail?: string;
}

/**
 * Workspace limits and quotas
 */
export interface WorkspaceLimits {
  /** Max releases */
  maxReleases: number;
  /** Max RAG collections */
  maxRagCollections: number;
  /** Max RAG storage (bytes) */
  maxRagStorageBytes: number;
  /** Max monthly API calls */
  maxMonthlyApiCalls: number;
  /** Max concurrent chats */
  maxConcurrentChats: number;
}

/**
 * Workspace member
 */
export interface WorkspaceMember {
  /** User ID */
  userId: ObjectId;
  /** Member role */
  role: WorkspaceMemberRole;
  /** Permissions */
  permissions: string[];
  /** Joined at */
  joinedAt: string;
}

/**
 * Workspace member role
 */
export type WorkspaceMemberRole = "owner" | "admin" | "editor" | "viewer";

/**
 * Options for creating a workspace
 */
export interface CreateWorkspaceOptions {
  /** Workspace name */
  name: string;
  /** URL-safe slug */
  slug?: string;
  /** Description */
  description?: string;
  /** Initial settings */
  settings?: Partial<WorkspaceSettings>;
  /**
   * The website this workspace is the boundary for.
   *
   * Turns create into FIND-OR-CREATE: a workspace already keyed to this host
   * is returned instead of a second one being made beside it. Accepts a bare
   * host or a full URL; the server normalizes and rejects anything that is not
   * a public hostname. The response's `created` flag says which happened.
   */
  onboardingHost?: string;
  /**
   * Create the workspace HIPAA-scoped.
   *
   * Starting scoped is far easier than converting a workspace that has already
   * been in operation, so the choice is offered at creation. It is not a flag:
   * it carries the Business Associate Agreement acceptance (read the text and
   * hash with `workspaces.getBaaAgreement()`), and the workspace is scoped only
   * because that agreement was recorded. While the agreement is unavailable the
   * server refuses (503) and creates nothing. Cannot be combined with
   * `onboardingHost`.
   */
  hipaa?: HipaaCreationAssent;
}

/**
 * Options for updating a workspace
 */
export interface UpdateWorkspaceOptions {
  /** Workspace name */
  name?: string;
  /** Description */
  description?: string;
  /** Settings */
  settings?: Partial<WorkspaceSettings>;
}

/**
 * Options for listing workspaces
 */
export interface ListWorkspacesOptions {
  /** Filter by role */
  role?: WorkspaceMemberRole;
  /** Limit results */
  limit?: number;
  /** Pagination cursor */
  cursor?: string;
}
