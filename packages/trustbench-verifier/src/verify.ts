import * as ed from "@noble/ed25519";

import {
	canonicalJSON,
	manifestBodyForSigning,
	utf8Bytes,
} from "./canonical.js";
import { decodeBase64, fetchWellKnown, isKeyDeprecated, makeKeyResolver } from "./keys.js";
import { TrustRunManifestV1, isKnownProviderId } from "./schema.js";
import type {
	OutputsCoverage,
	TrustRunManifest,
	VerifyOptions,
	VerifyResult,
	WellKnownRegistry,
} from "./types.js";
import { DEFAULT_WELL_KNOWN_URL } from "./types.js";

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
	// Pin to a fresh ArrayBuffer to satisfy stricter BufferSource typing
	const buf = new ArrayBuffer(data.byteLength);
	new Uint8Array(buf).set(data);
	const digest = await crypto.subtle.digest("SHA-256", buf);
	return new Uint8Array(digest);
}

function sha256HexFromBytes(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, "0");
	}
	return out;
}

function toUint8(input: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (typeof input === "string") return utf8Bytes(input);
	if (input instanceof Uint8Array) return input;
	return new Uint8Array(input);
}

/**
 * Verify a TrustBench run manifest.
 *
 * Pass-criteria for a successful verification (`result.verified === true`):
 *   1. The manifest matches schema version 1.0.0.
 *   2. The body's canonical-JSON hash matches a signature whose public
 *      key resolves via the well-known registry (or the supplied
 *      keyResolver).
 *   3. If `options.outputs` is provided, its SHA-256 matches
 *      `manifest.results.outputsHash`.
 *   4. If `options.benchmarkContent` is provided, its SHA-256 matches
 *      `manifest.benchmark.contentHash`.
 *   5. (When `options.strict`) no warnings present.
 *
 * The function never throws on a failed verification — it returns a
 * VerifyResult with `verified: false` and reasons in `errors`. It DOES
 * throw on operational failures (network errors fetching the well-known,
 * missing crypto.subtle in the runtime, etc.).
 */
export async function verify(
	manifest: unknown,
	options: VerifyOptions = {}
): Promise<VerifyResult> {
	const warnings: string[] = [];
	const errors: string[] = [];

	const parsed = TrustRunManifestV1.safeParse(manifest);
	if (!parsed.success) {
		const issues = parsed.error.errors.map(
			(e) => `${e.path.join(".") || "(root)"}: ${e.message}`
		);
		return {
			verified: false,
			signatureValid: false,
			outputsHashMatches: null,
			benchmarkContentHashMatches: null,
			signedBy: null,
			manifestVersion: "(invalid)",
			scoreProvenance: null,
			outputsCoverage: null,
			warnings,
			errors: [`schema validation failed: ${issues.join("; ")}`],
		};
	}

	const m: TrustRunManifest = parsed.data;
	const sig = m.signatures[0];

	// An unknown provider id is not a verification failure: the signature below
	// is checked over the manifest as received, identically to a known id. It
	// only means this verifier is older than the run. Warning, so --strict fails.
	if (!isKnownProviderId(m.model.providerId)) {
		warnings.push(
			`unknown provider id '${m.model.providerId}'; verifier may be older than the run`
		);
	}

	// Resolve the public key
	let resolvedKey: Uint8Array | null = null;
	let registry: WellKnownRegistry | null = null;
	try {
		if (options.keyResolver) {
			resolvedKey = await options.keyResolver(sig.keyId);
		} else {
			registry = await fetchWellKnown(
				options.wellKnownUrl ?? DEFAULT_WELL_KNOWN_URL,
				options.fetchImpl
			);
			const resolver = makeKeyResolver(registry);
			resolvedKey = await resolver(sig.keyId);
		}
	} catch (e: unknown) {
		errors.push(
			`failed to resolve signing key: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	if (!resolvedKey) {
		errors.push(
			`unknown signing keyId '${sig.keyId}' (not found in registry or resolver)`
		);
	} else {
		// Sanity check: the registry's public key should match the manifest's
		// `publicKey` field. If they diverge, the manifest is lying about its
		// keyId — fail loudly.
		const manifestPubKey = decodeBase64(sig.publicKey);
		if (!constantTimeEqual(manifestPubKey, resolvedKey)) {
			errors.push(
				`manifest signatures[0].publicKey does not match the registry entry for keyId '${sig.keyId}'`
			);
		}
		if (registry && isKeyDeprecated(registry, sig.keyId)) {
			warnings.push(
				`signing keyId '${sig.keyId}' is marked deprecated; signature is valid but key is being retired`
			);
		}
	}

	// Verify the Ed25519 signature
	let signatureValid = false;
	if (resolvedKey && errors.length === 0) {
		try {
			// Digested from the manifest AS RECEIVED, not the parsed value. Zod
			// strips unknown keys, so hashing `parsed.data` computed a digest over
			// a different document than the one signed: any manifest carrying a
			// field this version does not know failed its signature check, which
			// made additive manifest evolution impossible (every released
			// verifier <= 0.4.0 would reject it). verifyErasureReceipt and
			// verifyArtifactAttestation already work this way. The schema still
			// validates structure above; it just no longer decides the bytes.
			const body = manifestBodyForSigning(manifest as { signatures?: unknown });
			const canonical = canonicalJSON(body);
			const digest = await sha256Bytes(utf8Bytes(canonical));
			const sigBytes = decodeBase64(sig.signature);
			signatureValid = await ed.verifyAsync(sigBytes, digest, resolvedKey);
			if (!signatureValid) {
				errors.push("Ed25519 signature does not validate against canonical body hash");
			}
		} catch (e) {
			errors.push(
				`signature verification threw: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}

	// Verify outputs hash if outputs were provided
	let outputsHashMatches: boolean | null = null;
	if (options.outputs !== undefined) {
		try {
			const bytes = toUint8(options.outputs);
			const digest = await sha256Bytes(bytes);
			const expected = m.results.outputsHash.replace(/^sha256:/, "");
			const actual = sha256HexFromBytes(digest);
			outputsHashMatches = constantTimeEqualHex(expected, actual);
			if (!outputsHashMatches) {
				errors.push(
					`outputs hash mismatch: manifest expects sha256:${expected.slice(0, 12)}…, got sha256:${actual.slice(0, 12)}…`
				);
			}
		} catch (e) {
			errors.push(
				`outputs hash check threw: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}

	// Verify benchmark content hash if benchmark content was provided
	let benchmarkContentHashMatches: boolean | null = null;
	if (options.benchmarkContent !== undefined) {
		try {
			const bytes = toUint8(options.benchmarkContent);
			const digest = await sha256Bytes(bytes);
			const expected = m.benchmark.contentHash.replace(/^sha256:/, "");
			const actual = sha256HexFromBytes(digest);
			benchmarkContentHashMatches = constantTimeEqualHex(expected, actual);
			if (!benchmarkContentHashMatches) {
				errors.push(
					`benchmark content hash mismatch: manifest expects sha256:${expected.slice(0, 12)}…, got sha256:${actual.slice(0, 12)}…`
				);
			}
		} catch (e) {
			errors.push(
				`benchmark content hash check threw: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}

	// Provenance — measured, or merely signed?
	//
	// A valid signature attests that Divinci signed the document. It has never
	// attested that the number inside it was measured, and on 2026-08-27 a
	// stub-scored manifest (score = a hash of two id strings, the model never
	// called) and a real evaluation verified IDENTICALLY on two live public
	// URLs. Neither of the checks below can be a hard error: a manifest signed
	// before `results.provenance` existed must stay verifiable, and a manifest
	// that honestly declares itself a stub has a genuinely valid signature.
	// Both are warnings, which `strict: true` promotes to failures — so a
	// consumer who cares can refuse them in one flag.
	const scoreProvenance = m.results.provenance ?? null;
	if (scoreProvenance === null) {
		warnings.push(
			"manifest carries no results.provenance: the signature proves Divinci " +
				"signed this document, but the manifest does not attest that its " +
				"score was measured (pre-provenance manifest)"
		);
	} else if (scoreProvenance.sourceKind === "stub") {
		warnings.push(
			"results.provenance.sourceKind is 'stub': the score is FABRICATED and " +
				"the model under test was never called — this manifest is a " +
				"transport fixture, not a measurement"
		);
	} else if (scoreProvenance.sourceKind === "republished") {
		warnings.push(
			"results.provenance.sourceKind is 'republished': the score was computed " +
				"by an earlier run" +
				(scoreProvenance.upstreamRef ? ` (${scoreProvenance.upstreamRef})` : "") +
				", not by the evaluator execution this manifest attests"
		);
	}
	// The one provenance check that IS fatal: a provenance block pointing at a
	// different artifact than the one this manifest hashes would let a signed
	// document claim evidence it does not carry. The signer refuses to mint
	// that, so seeing it here means the body was tampered with — except the
	// signature covers the body, so it cannot be. Checked anyway: a claim this
	// cheap to verify should never rest on an argument about why it holds.
	if (
		scoreProvenance !== null &&
		scoreProvenance.outputsR2Key !== m.results.outputsR2Key
	) {
		errors.push(
			`results.provenance.outputsR2Key ('${scoreProvenance.outputsR2Key}') does ` +
				`not match results.outputsR2Key ('${m.results.outputsR2Key}')`
		);
	}

	// Coverage, read from the SIGNED outputs (scoredqa-publish/v1.1). Only
	// trusted when the outputs hash matched: otherwise the bytes are not the
	// ones the manifest attests. Older outputs carry no coverage block and
	// produce no warning here, since absence is not evidence of a gap.
	const outputsCoverage =
		outputsHashMatches === true && options.outputs !== undefined
			? readOutputsCoverage(options.outputs)
			: null;
	if (outputsCoverage) warnings.push(...coverageWarnings(outputsCoverage));

	const strictFails = options.strict === true && warnings.length > 0;
	const verified = errors.length === 0 && signatureValid && !strictFails;

	return {
		verified,
		signatureValid,
		outputsHashMatches,
		benchmarkContentHashMatches,
		signedBy: { keyId: sig.keyId, signer: sig.signer },
		manifestVersion: m.version,
		scoreProvenance,
		outputsCoverage,
		warnings,
		errors,
	};
}

/** Parse the coverage block of scoredqa-publish/v1.1 outputs; null when absent or malformed. */
export function readOutputsCoverage(outputs: ArrayBuffer | Uint8Array | string): OutputsCoverage | null {
	try {
		const text = typeof outputs === "string" ? outputs : new TextDecoder().decode(toUint8(outputs));
		const doc = JSON.parse(text) as { schema?: unknown; coverage?: unknown; selection?: unknown };
		if (typeof doc.schema !== "string" || !doc.schema.startsWith("scoredqa-publish/v1.")) return null;
		const c = doc.coverage as Record<string, unknown> | undefined;
		if (!c || typeof c !== "object") return null;
		const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
		const r = (c.retrieval ?? {}) as Record<string, unknown>;
		const sel = (doc.selection ?? {}) as Record<string, unknown>;
		return {
			expectedSamples: num(c.expectedSamples),
			scoredSamples: num(c.scoredSamples),
			missingSamples: num(c.missingSamples),
			filledSamples: num(c.filledSamples),
			retrievalRecorded: num(r.recorded),
			retrievalWithFailure: num(r.withFailure),
			selectionMode: typeof sel.mode === "string" ? sel.mode : null,
			allowDegradedRetrieval: sel.allowDegradedRetrieval === true,
		};
	} catch {
		return null;
	}
}

/** Warnings a coverage block earns. Pure. */
export function coverageWarnings(c: OutputsCoverage): string[] {
	const w: string[] = [];
	if (c.retrievalWithFailure > 0) {
		w.push(
			`retrieval failed on ${c.retrievalWithFailure} of ${c.retrievalRecorded} recorded samples: ` +
				"those answers were generated while a retrieval backend had failed, so this run " +
				"measures a degraded stack" +
				(c.allowDegradedRetrieval ? " (published with allowDegradedRetrieval)" : "")
		);
	}
	if (c.filledSamples > 0) {
		w.push(
			`${c.filledSamples} sample(s) were taken from an earlier pass than the rest of the run ` +
				"(a test missing from the latest pass is filled from a previous one)"
		);
	}
	if (c.missingSamples > 0) {
		w.push(
			`${c.missingSamples} of the benchmark's ${c.expectedSamples} samples have no score in these outputs`
		);
	}
	return w;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

function constantTimeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
