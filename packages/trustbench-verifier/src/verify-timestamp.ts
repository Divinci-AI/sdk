/**
 * Verify an independent timestamp for a TrustRun manifest.
 *
 * A manifest's signature proves WHO signed it, not WHEN: `execution.signedAt`
 * is written by the party being attested. A timestamp document
 * (`trustbench-timestamp/v1`, stored beside the manifest, never inside it) is
 * a transparency-log entry (Sigstore Rekor `rekord`) over the manifest's signed digest,
 * with the log's signed entry timestamp (SET) and, optionally, a Merkle
 * inclusion proof. When it verifies, `attestedTime` is the LOG's time, which
 * Divinci did not write.
 *
 * Design and the choice of Rekor over RFC 3161:
 * notes/research/2026-09-27-trustbench-timestamping.md.
 *
 * Pure apart from WebCrypto (`crypto.subtle`: browsers, Node >= 18, Workers,
 * Deno). No new dependency.
 *
 * ⚠️ The entry is a Rekor `rekord` over the signed digest. It has been
 * exercised against a LOCAL MOCK LOG only; confirm it against a real Rekor
 * entry before any run is anchored for real.
 */
import { canonicalJSON, utf8Bytes } from "./canonical.js";
import { decodeBase64 } from "./keys.js";

export const TIMESTAMP_SCHEMA = "trustbench-timestamp/v1";

export interface TimestampDocument {
	schema: typeof TIMESTAMP_SCHEMA;
	/**
	 * "sha256:<hex>" of the canonical manifest body, signatures EXCLUDED. That
	 * digest (D) is exactly what the platform key signs, so it is the artifact the
	 * log entry records, and the entry names sha256(D).
	 */
	manifestHash: string;
	authority: { kind: "rekor"; logId: string; url?: string };
	entry: { body: string; integratedTime: number; logIndex: number; logID: string };
	/** base64 of a DER-encoded ECDSA P-256 / SHA-256 signature. */
	signedEntryTimestamp: string;
	inclusionProof?: { logIndex: number; treeSize: number; rootHash: string; hashes: string[] };
}

export interface TrustedLogKey {
	/** Hex log id, matching `entry.logID`. */
	logId: string;
	/** base64 of the log's P-256 public key, SubjectPublicKeyInfo DER. */
	publicKeySpki: string;
}

export interface TimestampVerifyResult {
	/** True only when the hash matches, the SET verifies, and any inclusion proof verifies. */
	verified: boolean;
	/** The log's time, ISO 8601. Present only when `verified`. Never the manifest's own claim. */
	attestedTime?: string;
	logIndex?: number;
	checks: {
		hashMatches: boolean;
		signedEntryTimestamp: boolean;
		inclusionProof: "valid" | "invalid" | "absent";
	};
	errors: string[];
}

type Subtle = Pick<SubtleCrypto, "importKey" | "verify" | "digest">;

/** A copy backed by a plain ArrayBuffer, which is what WebCrypto's types accept. */
const bs = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

function hexToBytes(hex: string): Uint8Array | null {
	if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return null;
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
	return d === 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** DER ECDSA-Sig-Value (SEQUENCE { r INTEGER, s INTEGER }) -> 64-byte r||s for WebCrypto. */
export function derEcdsaToRaw(der: Uint8Array, size = 32): Uint8Array | null {
	let i = 0;
	if (der[i++] !== 0x30) return null;
	let len = der[i++];
	if (len & 0x80) {
		const n = len & 0x7f;
		if (n < 1 || n > 2) return null;
		len = 0;
		for (let k = 0; k < n; k++) len = (len << 8) | der[i++];
	}
	if (i + len !== der.length) return null;
	const out = new Uint8Array(size * 2);
	for (let part = 0; part < 2; part++) {
		if (der[i++] !== 0x02) return null;
		const l = der[i++];
		if (l < 1 || i + l > der.length) return null;
		let v = der.subarray(i, i + l);
		i += l;
		while (v.length > 0 && v[0] === 0) v = v.subarray(1);
		if (v.length > size) return null;
		out.set(v, part * size + (size - v.length));
	}
	return i === der.length ? out : null;
}

async function sha256(subtle: Subtle, bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await subtle.digest("SHA-256", bs(bytes)));
}

/** RFC 9162 section 2.1.3.2: does `hashes` prove `leaf` at `index` in a tree of `size` with `root`? */
export async function verifyInclusion(
	subtle: Subtle,
	leaf: Uint8Array,
	index: number,
	size: number,
	hashes: Uint8Array[],
	root: Uint8Array,
): Promise<boolean> {
	if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size) || index < 0 || index >= size) return false;
	let fn = index;
	let sn = size - 1;
	let r = await sha256(subtle, concat(new Uint8Array([0x00]), leaf));
	for (const p of hashes) {
		if (sn === 0) return false;
		if (fn % 2 === 1 || fn === sn) {
			r = await sha256(subtle, concat(new Uint8Array([0x01]), p, r));
			if (fn % 2 === 0) {
				while (fn % 2 === 0 && fn !== 0) {
					fn = Math.floor(fn / 2);
					sn = Math.floor(sn / 2);
				}
			}
		} else {
			r = await sha256(subtle, concat(new Uint8Array([0x01]), r, p));
		}
		fn = Math.floor(fn / 2);
		sn = Math.floor(sn / 2);
	}
	return sn === 0 && bytesEqual(r, root);
}

/** The SHA-256 a rekord (or hashedrekord) body commits to, lower-case hex, or null. */
function bodyHash(bodyBytes: Uint8Array): string | null {
	try {
		const body = JSON.parse(new TextDecoder().decode(bodyBytes)) as {
			spec?: { data?: { hash?: { algorithm?: unknown; value?: unknown } } };
		};
		const h = body.spec?.data?.hash;
		return h?.algorithm === "sha256" && typeof h.value === "string" && /^[0-9a-f]{64}$/i.test(h.value) ? h.value.toLowerCase() : null;
	} catch {
		return null;
	}
}

export async function verifyTimestamp(
	doc: unknown,
	opts: { manifestHash: string; trustedLogKeys: readonly TrustedLogKey[]; subtle?: Subtle },
): Promise<TimestampVerifyResult> {
	const errors: string[] = [];
	const checks: TimestampVerifyResult["checks"] = { hashMatches: false, signedEntryTimestamp: false, inclusionProof: "absent" };
	const done = (): TimestampVerifyResult => ({ verified: false, checks, errors });
	const subtle = opts.subtle ?? (globalThis.crypto?.subtle as Subtle | undefined);
	if (!subtle) return { ...done(), errors: ["WebCrypto (crypto.subtle) is not available in this runtime"] };

	const d = doc as Partial<TimestampDocument> | null;
	if (!d || d.schema !== TIMESTAMP_SCHEMA || !d.entry || typeof d.signedEntryTimestamp !== "string") {
		return { ...done(), errors: [`not a ${TIMESTAMP_SCHEMA} document`] };
	}
	const { body, integratedTime, logIndex, logID } = d.entry;
	if (typeof body !== "string" || !Number.isSafeInteger(integratedTime) || !Number.isSafeInteger(logIndex) || typeof logID !== "string") {
		return { ...done(), errors: ["malformed entry"] };
	}

	// 1. The entry names THIS manifest: its artifact is the signed digest D, so
	//    the body commits to sha256(D). An entry naming D itself names nothing
	//    the platform key signed.
	const digestHex = /^sha256:([0-9a-f]{64})$/i.exec(opts.manifestHash)?.[1]?.toLowerCase();
	const digest = digestHex ? hexToBytes(digestHex) : null;
	const want = digest ? [...(await sha256(subtle, digest))].map((b) => b.toString(16).padStart(2, "0")).join("") : undefined;
	let bodyBytes: Uint8Array;
	try {
		bodyBytes = decodeBase64(body);
	} catch {
		return { ...done(), errors: ["entry body is not base64"] };
	}
	const named = bodyHash(bodyBytes);
	checks.hashMatches = !!want && named === want && d.manifestHash?.toLowerCase() === `sha256:${digestHex}`;
	if (!checks.hashMatches) errors.push("the log entry does not name this manifest's hash");

	// 2. The log signed (body, time, index, log id). The key must be one the caller trusts.
	const key = opts.trustedLogKeys.find((k) => k.logId.toLowerCase() === logID.toLowerCase());
	if (!key) {
		errors.push(`log ${logID} is not a trusted log`);
	} else {
		try {
			const pub = await subtle.importKey("spki", bs(decodeBase64(key.publicKeySpki)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
			const raw = derEcdsaToRaw(decodeBase64(d.signedEntryTimestamp));
			const payload = utf8Bytes(canonicalJSON({ body, integratedTime, logID, logIndex }));
			checks.signedEntryTimestamp = !!raw && (await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, bs(raw), bs(payload)));
		} catch (e) {
			errors.push(`signed entry timestamp could not be checked: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (!checks.signedEntryTimestamp && !errors.some((x) => x.startsWith("signed entry timestamp"))) {
			errors.push("the signed entry timestamp does not verify");
		}
	}

	// 3. Optional: the entry is in the log's tree. The proof's index is the
	//    position in the TREE (shard) it proves against, which on a sharded log
	//    such as rekor.sigstore.dev differs from the entry's global logIndex;
	//    the leaf hash is what binds the proof to this entry.
	//    The root is not authenticated here (no signed checkpoint is checked),
	//    so a valid proof adds nothing to the SET; an invalid one still fails.
	if (d.inclusionProof) {
		const p = d.inclusionProof;
		const root = typeof p.rootHash === "string" ? hexToBytes(p.rootHash) : null;
		const path = Array.isArray(p.hashes) ? p.hashes.map((h) => (typeof h === "string" ? hexToBytes(h) : null)) : null;
		const ok =
			!!root && !!path && path.every((h): h is Uint8Array => h !== null && h.length === 32) &&
			(await verifyInclusion(subtle, bodyBytes, p.logIndex, p.treeSize, path as Uint8Array[], root));
		checks.inclusionProof = ok ? "valid" : "invalid";
		if (!ok) errors.push("the inclusion proof does not verify");
	}

	const verified = checks.hashMatches && checks.signedEntryTimestamp && checks.inclusionProof !== "invalid";
	return verified
		? { verified, attestedTime: new Date(integratedTime * 1000).toISOString(), logIndex, checks, errors }
		: { verified, checks, errors };
}
