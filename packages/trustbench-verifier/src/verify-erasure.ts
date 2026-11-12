import * as ed from "@noble/ed25519";

import { canonicalJSON, manifestBodyForSigning, utf8Bytes } from "./canonical.js";
import { decodeBase64, fetchWellKnown, isKeyDeprecated, makeKeyResolver } from "./keys.js";
import { ErasureReceiptV1, ERASURE_KEY_ID } from "./erasure-schema.js";
import type { EditProvenanceT } from "./erasure-schema.js";
import type { VerifyOptions, WellKnownRegistry } from "./types.js";
import { DEFAULT_WELL_KNOWN_URL } from "./types.js";

export interface ErasureVerifyResult {
	/** True only when every gating check passed (and, under strict, no warnings). */
	verified: boolean;
	signatureValid: boolean;
	signedBy: { keyId: string; signer: string } | null;
	receiptVersion: string;
	/** Content address of the patch set the receipt describes. */
	patchSetSha: string | null;
	/** How many edits carried an actual measurement, out of how many. */
	measured: { edits: number; measuredEdits: number };
	/**
	 * Whether this receipt carries an efficacy claim (two bracketing runs).
	 * ALWAYS false in v1. A changelog is not evidence of erasure, and a reader
	 * must be able to tell the two apart without reading the spec.
	 */
	carriesEfficacyEvidence: boolean;
	warnings: string[];
	errors: string[];
}

function fail(errors: string[], warnings: string[] = []): ErasureVerifyResult {
	return {
		verified: false,
		signatureValid: false,
		signedBy: null,
		receiptVersion: "(invalid)",
		patchSetSha: null,
		measured: { edits: 0, measuredEdits: 0 },
		carriesEfficacyEvidence: false,
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
 * Verify a signed erasure Change Receipt.
 *
 * Same cryptographic convention as a TrustRun manifest — Ed25519 over
 * `sha256(canonicalJSON(body-without-signatures))` — so a stranger with this
 * package can check one offline, with no network call to us and no account.
 *
 * ## What a pass means, and what it does not
 *
 * `verified: true` says the document is intact and was signed by a key in the
 * erasure lineage. It says NOTHING about whether the erasure worked. Read
 * `measured` and `carriesEfficacyEvidence` for that: a receipt where
 * `measuredEdits` is 0, or `carriesEfficacyEvidence` is false, is a tamper-
 * evident CHANGELOG and not proof of anything about the model's behaviour.
 * Those cases raise warnings, and `strict: true` turns any warning into a
 * failure — so a consumer who needs evidence rather than a record can refuse
 * them with one flag.
 *
 * Never throws for a failed verification; returns `verified: false` with
 * reasons. Still throws on operational failure (no network for the registry,
 * no `crypto.subtle`).
 */
export async function verifyErasureReceipt(
	receipt: unknown,
	options: VerifyOptions = {}
): Promise<ErasureVerifyResult> {
	const warnings: string[] = [];
	const errors: string[] = [];

	const parsed = ErasureReceiptV1.safeParse(receipt);
	if (!parsed.success) {
		const issues = parsed.error.errors.map(
			(e) => `${e.path.join(".") || "(root)"}: ${e.message}`
		);
		return fail([`schema validation failed: ${issues.join("; ")}`]);
	}

	const r = parsed.data;
	const sig = r.signatures[0];

	// ── Key lineage ─────────────────────────────────────────────────────────
	// The server refuses to SIGN an erasure receipt under a tbp-* manifest key;
	// this is the same rule enforced from the reading side, so a receipt that
	// somehow reached a consumer under the wrong lineage is rejected rather
	// than quietly accepted because the maths happened to work out.
	if (!ERASURE_KEY_ID.test(sig.keyId)) {
		errors.push(
			`signing keyId '${sig.keyId}' is not in the erasure lineage (tbr-*): an ` +
				"erasure receipt must not be signed with the TrustRun manifest key"
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
	// ⚠️ Digested from the ORIGINAL input, not from `parsed.data`.
	//
	// Zod strips unknown keys by default. Hashing the parsed value would
	// compute a digest over a document the signer never saw, so any receipt
	// carrying a field this version of the package does not know about would
	// fail — breaking additive evolution in the forward direction, which is
	// the one that matters for a verifier pinned in someone else's lockfile.
	let signatureValid = false;
	if (resolvedKey && errors.length === 0) {
		try {
			const body = manifestBodyForSigning(receipt as { signatures?: unknown });
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

	// ── What the document actually claims ───────────────────────────────────
	const edits = r.edits.length;
	const measuredEdits = r.edits.filter(
		(e) => (e.provenance as EditProvenanceT).sourceKind === "measured"
	).length;

	if (edits === 0) {
		warnings.push("receipt carries no edits: it attests an empty change set");
	} else if (measuredEdits === 0) {
		warnings.push(
			`none of the ${edits} edit(s) carry a measurement: this receipt is a ` +
				"tamper-evident CHANGELOG of what was applied, not evidence that the " +
				"model's behaviour changed"
		);
	} else if (measuredEdits < edits) {
		warnings.push(
			`${edits - measuredEdits} of ${edits} edit(s) carry no measurement; ` +
				"read provenance per edit before treating the set as measured"
		);
	}

	// v1 always. Stated as a warning rather than assumed from the null, so a
	// consumer reading only `warnings` still learns that no efficacy claim is
	// being made.
	const carriesEfficacyEvidence = r.runs !== null;
	if (!carriesEfficacyEvidence) {
		warnings.push(
			"receipt carries no bracketing runs (`runs` is null): it does not assert " +
				"a measured before/after difference, and must not be read as proof of erasure"
		);
	}

	if (r.edits.some((e) => e.subjectFingerprint === null)) {
		warnings.push(
			"one or more edits carry no subjectFingerprint: those records predate " +
				"subject sealing and cannot be matched to an erasure request"
		);
	}

	const strictFails = options.strict === true && warnings.length > 0;
	return {
		verified: errors.length === 0 && signatureValid && !strictFails,
		signatureValid,
		signedBy: { keyId: sig.keyId, signer: sig.signer },
		receiptVersion: r.version,
		patchSetSha: r.patchSet.sha,
		measured: { edits, measuredEdits },
		carriesEfficacyEvidence,
		warnings,
		errors,
	};
}
