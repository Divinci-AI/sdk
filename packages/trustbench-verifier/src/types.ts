import type { ScoreProvenance, TrustRunManifest } from "./schema.js";

export type { ScoreProvenance, TrustRunManifest };

export interface WellKnownKey {
	keyId: string;
	algorithm: "ed25519";
	publicKey: string;
	validFrom: string;
	validUntil: string | null;
	deprecated: boolean;
}

export interface WellKnownRegistry {
	version: string;
	platform: string;
	keys: WellKnownKey[];
}

export type KeyResolver = (keyId: string) => Promise<Uint8Array | null>;

export interface VerifyOptions {
	/**
	 * Raw outputs file content. When provided, the verifier hashes it and
	 * compares against `manifest.results.outputsHash`. Skipped if undefined
	 * (in which case `outputsHashMatches` is `null` in the result).
	 */
	outputs?: ArrayBuffer | Uint8Array | string;

	/**
	 * Raw benchmark task spec content. When provided, the verifier hashes
	 * it and compares against `manifest.benchmark.contentHash`. Skipped if
	 * undefined (in which case `benchmarkContentHashMatches` is `null`).
	 */
	benchmarkContent?: ArrayBuffer | Uint8Array | string;

	/**
	 * Custom resolver for the platform public key by keyId. If not
	 * provided, the verifier fetches from `wellKnownUrl`.
	 */
	keyResolver?: KeyResolver;

	/**
	 * URL to fetch the well-known key registry from. Default:
	 * https://app.divinci.app/.well-known/trustbench-keys.json
	 */
	wellKnownUrl?: string;

	/**
	 * Custom fetch implementation. Useful for testing or for environments
	 * where the global fetch is restricted.
	 */
	fetchImpl?: typeof fetch;

	/**
	 * If true, treat any warning as a verification failure. Default false.
	 */
	strict?: boolean;
}

/**
 * Coverage of a republished run, read from its signed outputs
 * (`scoredqa-publish/v1.1`). Present only when `options.outputs` was supplied
 * AND its hash matched the manifest.
 */
export interface OutputsCoverage {
	/** Samples in the benchmark: what a complete run would publish. */
	expectedSamples: number;
	scoredSamples: number;
	missingSamples: number;
	/** Samples taken from an earlier pass than the rest of the run. */
	filledSamples: number;
	/** Samples that carried a retrieval record. */
	retrievalRecorded: number;
	/** Samples answered while a retrieval backend had failed. */
	retrievalWithFailure: number;
	/** "run" (one pinned pass) or "latest-per-test". */
	selectionMode: string | null;
	allowDegradedRetrieval: boolean;
}

export interface VerifyResult {
	/**
	 * Overall pass/fail. True only if all the gating checks below succeeded.
	 */
	verified: boolean;

	/**
	 * The manifest body's signature was produced by a known platform key.
	 */
	signatureValid: boolean;

	/**
	 * The provided outputs hash matches manifest.results.outputsHash.
	 * `null` if outputs were not provided.
	 */
	outputsHashMatches: boolean | null;

	/**
	 * The provided benchmark content hash matches
	 * manifest.benchmark.contentHash. `null` if benchmark content was
	 * not provided.
	 */
	benchmarkContentHashMatches: boolean | null;

	/**
	 * The platform key used to sign the manifest, identified by keyId.
	 * Empty when signature could not be parsed at all.
	 */
	signedBy: { keyId: string; signer: string } | null;

	/**
	 * Manifest version that was verified.
	 */
	manifestVersion: string;

	/**
	 * Where the attested score came from, as signed into the manifest body.
	 *
	 * `null` means the manifest predates the provenance field and therefore
	 * says NOTHING about whether its number was measured — a valid signature
	 * proves only that Divinci signed the document. Treat `null` as unknown
	 * provenance, never as "measured". A warning is raised in that case, and
	 * `strict: true` turns it into a verification failure.
	 *
	 * `sourceKind: "stub"` means the score is fabricated and the model was
	 * never called. The signature is still valid — that is exactly the point:
	 * a signature attests authorship, and this field attests measurement.
	 */
	scoreProvenance: ScoreProvenance | null;

	/**
	 * Non-fatal observations (e.g., key was marked deprecated, schema
	 * had unrecognized fields).
	 */
	/**
	 * Coverage read from the signed outputs, when supplied and matching. Its
	 * gaps (failed retrieval, filled or missing samples) are also reported as
	 * warnings, so `strict: true` refuses them.
	 */
	outputsCoverage: OutputsCoverage | null;
	warnings: string[];

	/**
	 * Reasons verification failed. Empty when `verified` is true.
	 */
	errors: string[];
}

/**
 * Default URL for the platform key registry. Points at api.divinci.app
 * because that's where staging + production actually serve the
 * `.well-known/trustbench-keys.json` endpoint today (verified live
 * 2026-05-04). The "app.divinci.app" hostname referenced in the manifest
 * `$schema` URL is forward-looking and does not currently resolve in DNS,
 * so the verifier defaults to the actual serving host instead — otherwise
 * every out-of-the-box `verify()` call would fail with "fetch failed".
 *
 * Override via `verify(manifest, { wellKnownUrl: "..." })` for staging:
 *   "https://api.stage.divinci.app/.well-known/trustbench-keys.json"
 */
export const DEFAULT_WELL_KNOWN_URL =
	"https://api.divinci.app/.well-known/trustbench-keys.json";
