/**
 * Terms of Service namespace.
 *
 * A release may reference a versioned Terms of Service document. When the
 * document is (re-)published, every user must accept the new version before
 * interacting with that release — message sends return a 403
 * `TERMS_NOT_ACCEPTED` ({@link TermsNotAcceptedError}) whose details carry
 * the full gate payload.
 *
 * @example
 * ```typescript
 * try {
 *   await client.chat.send("Hello!");
 * } catch (e) {
 *   if (e instanceof TermsNotAcceptedError && e.tosId && e.version) {
 *     showTermsUi(e.title, e.termsContent);          // render markdown
 *     await client.terms.accept({ tosId: e.tosId, version: e.version });
 *     await client.chat.send("Hello!");              // retry
 *   }
 * }
 * ```
 */
import { BaseNamespace } from "../base.js";
import type { TermsOfServiceGate, AcceptTermsInput } from "@divinci-ai/types";

export interface AcceptTermsResult {
  required: boolean;
  tosId?: string;
  version?: number;
  title?: string;
}

export class TermsNamespace extends BaseNamespace {
  /**
   * Get the Terms of Service gate for a release and the calling identity.
   * `{ required: false }` when no published ToS exists or the caller has
   * already accepted the current version.
   */
  async getForRelease(params?: { releaseId?: string }): Promise<TermsOfServiceGate> {
    const releaseId = this.getReleaseId(params);
    return this.httpClient.get<TermsOfServiceGate>(
      `/api/v1/terms/release/${encodeURIComponent(releaseId)}`
    );
  }

  /**
   * Accept the CURRENT published Terms of Service version. `tosId` and
   * `version` come from the gate payload (or a TermsNotAcceptedError).
   * Responds 409 when the version went stale (a newer version published) —
   * refetch via {@link getForRelease} and re-prompt.
   */
  async accept(input: AcceptTermsInput): Promise<AcceptTermsResult> {
    return this.httpClient.post<AcceptTermsResult>("/api/v1/terms/accept", input);
  }
}
