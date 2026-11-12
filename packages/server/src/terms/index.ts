/**
 * Terms of Service Client
 *
 * Server-side ADMIN lifecycle for a workspace's versioned Terms of Service
 * documents (e.g. an AI medical disclaimer users must accept before chatting):
 * create a draft, edit it, publish it (bumps the version → everyone must
 * re-accept), and restore a prior version.
 *
 * Attaching a ToS to a release is a RELEASE update — pass
 * `termsOfService: { id: tosId }` through `releases.update(...)` (drafts).
 * The gate only fires once the document is PUBLISHED (publishedVersion > 0)
 * AND a release references it. The consumer side (gate + accept) lives in the
 * client SDK (`client.terms`).
 */

import { ServerHttpClient } from "../http-client.js";

export interface TermsOfServiceDoc {
  _id: string;
  /** condenseTarget form, e.g. "mongodb/WhiteLabel/<id>" */
  target: string;
  title: string;
  /** Editable draft body (markdown). Saving it never bumps the version. */
  draftContent: string;
  /** Last published body (markdown); absent until first publish. */
  publishedContent?: string;
  /** 0 = never published (inert — the gate never fires). */
  publishedVersion: number;
  versionHistory?: Array<{ version: number, content: string, publishedAt?: string | number }>;
}

export interface CreateTermsInput {
  title: string;
  /** Initial draft body (markdown). Defaults to "". */
  draftContent?: string;
}

export interface UpdateTermsInput {
  title?: string;
  draftContent?: string;
}

/**
 * Terms of Service client for server-side (API-key) administration.
 */
export class TermsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** List the workspace's Terms of Service documents. */
  async list(): Promise<TermsOfServiceDoc[]> {
    return this.httpClient.get<TermsOfServiceDoc[]>("/api/v1/terms/admin");
  }

  /** Create a new (unpublished) Terms of Service document. */
  async create(input: CreateTermsInput): Promise<TermsOfServiceDoc> {
    return this.httpClient.post<TermsOfServiceDoc>("/api/v1/terms/admin", input);
  }

  /** Fetch one document (draft + published content + history). */
  async get(tosId: string): Promise<TermsOfServiceDoc> {
    return this.httpClient.get<TermsOfServiceDoc>(
      `/api/v1/terms/admin/${encodeURIComponent(tosId)}`,
    );
  }

  /** Update the draft title/content. Never bumps the published version. */
  async update(tosId: string, input: UpdateTermsInput): Promise<TermsOfServiceDoc> {
    return this.httpClient.patch<TermsOfServiceDoc>(
      `/api/v1/terms/admin/${encodeURIComponent(tosId)}`,
      input,
    );
  }

  /**
   * Publish the current draft. Bumps `publishedVersion`, which invalidates all
   * prior acceptances — every user must accept the new version before
   * chatting on releases that reference this document. Treat as a
   * deliberate, user-visible action.
   */
  async publish(tosId: string): Promise<TermsOfServiceDoc> {
    return this.httpClient.post<TermsOfServiceDoc>(
      `/api/v1/terms/admin/${encodeURIComponent(tosId)}/publish`,
      {},
    );
  }

  /** Restore a previously published version's content into the draft. */
  async restore(tosId: string, version: number): Promise<TermsOfServiceDoc> {
    return this.httpClient.post<TermsOfServiceDoc>(
      `/api/v1/terms/admin/${encodeURIComponent(tosId)}/restore`,
      { version },
    );
  }
}
