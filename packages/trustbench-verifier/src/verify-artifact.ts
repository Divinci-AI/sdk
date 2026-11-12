import * as ed from "@noble/ed25519";

import { canonicalJSON, manifestBodyForSigning, utf8Bytes } from "./canonical.js";
import { decodeBase64, fetchWellKnown, isKeyDeprecated, makeKeyResolver } from "./keys.js";
import { ArtifactAttestationV1, ARTIFACT_KEY_ID } from "./artifact-schema.js";
import type { ArtifactFileT } from "./artifact-schema.js";
import type { VerifyOptions, WellKnownRegistry } from "./types.js";
import { DEFAULT_WELL_KNOWN_URL } from "./types.js";

export interface ArtifactVerifyResult {
	/** True only when every gating check passed (and, under strict, no warnings). */
	verified: boolean;
	signatureValid: boolean;
	signedBy: { keyId: string; signer: string } | null;
	artifactName: string | null;
	/** Every file the document attests, as parsed. Empty when it did not parse. */
	files: ArtifactFileT[];
	/** Paths whose digest the signer did NOT independently confirm. */
	operatorDeclaredPaths: string[];
	warnings: string[];
	errors: string[];
}

function fail(errors: string[], warnings: string[] = []): ArtifactVerifyResult {
	return {
		verified: false,
		signatureValid: false,
		signedBy: null,
		artifactName: null,
		files: [],
		operatorDeclaredPaths: [],
		warnings,
		errors,
	};
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
	const buf = new ArrayBuffer(data.byteLength);
	new Uint8Array(buf).set(data);
	return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/**
 * Verify a signed Artifact Attestation.
 *
 * Same cryptographic convention as a TrustRun manifest and an erasure receipt —
 * Ed25519 over `sha256(canonicalJSON(body-without-signatures))` — so it can be
 * checked offline, with no network call to us, once the key is in the registry.
 *
 * ## What a pass means, and what it does not
 *
 * `verified: true` says the DOCUMENT is intact and was signed by a key in the
 * artifact lineage. It does NOT say that files you hold match it — hash them
 * and call `checkArtifactFiles`. And it says nothing about what the artifact
 * does. Any `operator-declared` file raises a warning, which `strict: true`
 * turns into a failure.
 *
 * Never throws for a failed verification; returns `verified: false` with
 * reasons. Still throws on operational failure (no network for the registry,
 * no `crypto.subtle`).
 */
export async function verifyArtifactAttestation(
	attestation: unknown,
	options: VerifyOptions = {}
): Promise<ArtifactVerifyResult> {
	const warnings: string[] = [];
	const errors: string[] = [];

	const parsed = ArtifactAttestationV1.safeParse(attestation);
	if (!parsed.success) {
		const issues = parsed.error.errors.map(
			(e) => `${e.path.join(".") || "(root)"}: ${e.message}`
		);
		return fail([`schema validation failed: ${issues.join("; ")}`]);
	}

	const a = parsed.data;
	const sig = a.signatures[0];

	// ── Key lineage ─────────────────────────────────────────────────────────
	// The server refuses to SIGN an attestation under another lineage's key;
	// this is the same rule from the reading side. A tbr-* key is server-held,
	// and must not be able to vouch for which bytes an artifact is.
	if (!ARTIFACT_KEY_ID.test(sig.keyId)) {
		errors.push(
			`signing keyId '${sig.keyId}' is not in the artifact lineage (tba-*): an ` +
				"artifact attestation must not be signed with a manifest or erasure key"
		);
	}

	// ── Internal consistency ────────────────────────────────────────────────
	// Checked before trusting anything: a signature over an inconsistent
	// document is still an inconsistent document.
	const seen = new Set<string>();
	for (const f of a.artifact.files) {
		if (seen.has(f.path)) errors.push(`duplicate file path '${f.path}'`);
		seen.add(f.path);
	}
	const summed = a.artifact.files.reduce((n, f) => n + f.bytes, 0);
	if (summed !== a.artifact.totalBytes) {
		errors.push(
			`artifact.totalBytes is ${a.artifact.totalBytes} but the files sum to ${summed}`
		);
	}

	// ── Resolve the public key ──────────────────────────────────────────────
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
			resolvedKey = await makeKeyResolver(registry)(sig.keyId);
		}
	} catch (e: unknown) {
		errors.push(
			`failed to resolve signing key: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	if (!resolvedKey) {
		// A key carried ON the document proves nothing: anyone can sign with a key
		// of their own and attach it. Only a registry entry counts.
		errors.push(
			`unknown signing keyId '${sig.keyId}' (not found in registry or resolver)`
		);
	} else {
		if (!constantTimeEqual(decodeBase64(sig.publicKey), resolvedKey)) {
			errors.push(
				`signatures[0].publicKey does not match the registry entry for keyId '${sig.keyId}'`
			);
		}
		if (registry && isKeyDeprecated(registry, sig.keyId)) {
			warnings.push(
				`signing keyId '${sig.keyId}' is marked deprecated; signature is valid but the key is being retired`
			);
		}
	}

	// ── Signature ───────────────────────────────────────────────────────────
	// Digested from the ORIGINAL input, not the parsed value: zod strips unknown
	// keys, and hashing the parsed value would break additive evolution.
	let signatureValid = false;
	if (resolvedKey && errors.length === 0) {
		try {
			const body = manifestBodyForSigning(attestation as { signatures?: unknown });
			const digest = await sha256Bytes(utf8Bytes(canonicalJSON(body)));
			signatureValid = await ed.verifyAsync(
				decodeBase64(sig.signature),
				digest,
				resolvedKey
			);
			if (!signatureValid) {
				errors.push("Ed25519 signature does not validate against the canonical body hash");
			}
		} catch (e) {
			errors.push(
				`signature verification threw: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}

	// ── How strongly each digest is vouched for ─────────────────────────────
	const operatorDeclaredPaths = a.artifact.files
		.filter((f) => f.witness === "operator-declared")
		.map((f) => f.path);
	if (operatorDeclaredPaths.length > 0) {
		warnings.push(
			`${operatorDeclaredPaths.length} of ${a.artifact.files.length} file digest(s) are ` +
				"operator-declared: the signer hashed them but had nothing of the artifact's own " +
				"to confirm them against. See artifact.note for the operator's account."
		);
	}

	const strictFails = options.strict === true && warnings.length > 0;
	return {
		verified: errors.length === 0 && signatureValid && !strictFails,
		signatureValid,
		signedBy: { keyId: sig.keyId, signer: sig.signer },
		artifactName: a.artifact.name,
		files: a.artifact.files,
		operatorDeclaredPaths,
		warnings,
		errors,
	};
}

export interface ArtifactFileCheck {
	/** True only when every attested file is present with the right size and digest, and nothing extra. */
	matches: boolean;
	missing: string[];
	/** Present, but the digest or size differs from the attestation. */
	mismatched: Array<{ path: string; expectedSha256: string; actualSha256: string; expectedBytes: number; actualBytes: number }>;
	/** Present locally but not attested. Reported, never silently ignored. */
	unexpected: string[];
}

/**
 * Compare files you hold against an attestation's digests.
 *
 * Pure: the caller hashes (this package has no filesystem access, so it runs in
 * a browser as well as in Node). Call it only with an attestation that
 * `verifyArtifactAttestation` has already verified — comparing against an
 * unverified document checks your files against a stranger's claim.
 */
export function checkArtifactFiles(
	attestedFiles: ReadonlyArray<Pick<ArtifactFileT, "path" | "sha256" | "bytes">>,
	actual: ReadonlyMap<string, { sha256: string; bytes: number }>
): ArtifactFileCheck {
	const missing: string[] = [];
	const mismatched: ArtifactFileCheck["mismatched"] = [];
	const attested = new Set<string>();
	for (const f of attestedFiles) {
		attested.add(f.path);
		const got = actual.get(f.path);
		if (!got) {
			missing.push(f.path);
			continue;
		}
		if (got.sha256.toLowerCase() !== f.sha256 || got.bytes !== f.bytes) {
			mismatched.push({
				path: f.path,
				expectedSha256: f.sha256,
				actualSha256: got.sha256.toLowerCase(),
				expectedBytes: f.bytes,
				actualBytes: got.bytes,
			});
		}
	}
	const unexpected = [...actual.keys()].filter((p) => !attested.has(p)).sort();
	return {
		matches: missing.length === 0 && mismatched.length === 0 && unexpected.length === 0,
		missing,
		mismatched,
		unexpected,
	};
}
