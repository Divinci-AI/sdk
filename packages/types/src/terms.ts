/**
 * Terms of Service types for the Divinci SDK
 *
 * A release may reference a versioned Terms of Service document. When the
 * document's published version changes, every user must re-accept before
 * interacting with that release — gated server-side on all message-send
 * paths with a 403 `TERMS_NOT_ACCEPTED` whose `details` carry the full
 * gate payload (so any surface can render and accept in one round trip).
 */

/**
 * Gate payload describing the Terms of Service a caller must accept.
 * Returned by `GET /api/v1/terms/release/:releaseId` and carried in the
 * `details` of a 403 `TERMS_NOT_ACCEPTED` error.
 */
export interface TermsOfServiceGate {
  /** Whether the caller must (re-)accept before interacting. */
  required: boolean;
  /** Terms of Service document id — pass to `accept()`. */
  tosId?: string;
  /** Current published version — pass to `accept()`. */
  version?: number;
  /** Display title for the acceptance UI. */
  title?: string;
  /** Markdown body of the published terms. */
  content?: string;
}

/**
 * Body for accepting a Terms of Service version.
 */
export interface AcceptTermsInput {
  /** Document id from the gate payload. */
  tosId: string;
  /** Published version being accepted (stale version → 409). */
  version: number;
  /** Anonymous identity — required when no authenticated user. */
  anonymousSessionId?: string;
  /** Optional cross-check: when supplied, the server verifies the release
   *  actually references tosId. Available on TermsNotAcceptedDetails. */
  releaseId?: string;
}

/**
 * Details attached to a 403 TERMS_NOT_ACCEPTED error.
 */
export interface TermsNotAcceptedDetails {
  tosId: string;
  version: number;
  title?: string;
  content?: string;
  /** Release whose ToS triggered the gate — accept via
   *  `POST /white-label-release/:releaseId/terms-of-service/accept`. */
  releaseId?: string;
}
