/**
 * An independent signing time: a transparency-log entry naming the manifest.
 * KNOWN-GAPS trustbench-signing-time-is-self-asserted.
 *
 * Everything here runs against a LOCAL MOCK LOG: a P-256 key, and an RFC 6962
 * Merkle tree built in this file. Nothing is submitted anywhere.
 */
import { webcrypto } from "node:crypto";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { canonicalJSON } from "../src/canonical.js";
import { TIMESTAMP_SCHEMA, derEcdsaToRaw, verifyTimestamp, type TimestampDocument, type TrustedLogKey } from "../src/verify-timestamp.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const H = (...parts: Uint8Array[]) => new Uint8Array(createHash("sha256").update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest());
const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

/** RFC 6962 Merkle tree hash and audit path, independently of the code under test. */
function mth(d: Uint8Array[]): Uint8Array {
	if (d.length === 1) return H(LEAF, d[0]);
	let k = 1;
	while (k * 2 < d.length) k *= 2;
	return H(NODE, mth(d.slice(0, k)), mth(d.slice(k)));
}
function path(m: number, d: Uint8Array[]): Uint8Array[] {
	if (d.length === 1) return [];
	let k = 1;
	while (k * 2 < d.length) k *= 2;
	return m < k ? [...path(m, d.slice(0, k)), mth(d.slice(k))] : [...path(m - k, d.slice(k)), mth(d.slice(0, k))];
}

/** raw r||s (what WebCrypto signs) -> DER, as Rekor serves it. */
function rawToDer(raw: Uint8Array): Uint8Array {
	const int = (v: Uint8Array) => {
		let i = 0;
		while (i < v.length - 1 && v[i] === 0) i++;
		let x = v.slice(i);
		if (x[0] & 0x80) x = new Uint8Array([0, ...x]);
		return [0x02, x.length, ...x];
	};
	const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
	return new Uint8Array([0x30, body.length, ...body]);
}

const MANIFEST_HEX = "ab".repeat(32);
const MANIFEST_HASH = `sha256:${MANIFEST_HEX}`;
/** What the entry must name: sha256 of the signed digest D, not D itself. */
const NAMED_HEX = hex(H(Buffer.from(MANIFEST_HEX, "hex")));
const LOG_ID = "c0ffee".repeat(10) + "abcd";

let keyPair: CryptoKeyPair;
let trusted: TrustedLogKey[];

beforeAll(async () => {
	keyPair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
	trusted = [{ logId: LOG_ID, publicKeySpki: b64(new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey))) }];
});

/** A rekord body as Rekor stores it: the content replaced by its hash. */
function rekordBody(hashHex: string): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({ apiVersion: "0.0.1", kind: "rekord", spec: { data: { hash: { algorithm: "sha256", value: hashHex } }, signature: { format: "x509", content: "c2ln", publicKey: { content: "a2V5" } } } }),
	);
}

/**
 * A mock log with `n` entries; ours is at tree position `index`. `globalIndex`
 * is the entry's logIndex, which on a sharded log differs from its position in
 * the shard's tree.
 */
async function anchored(opts: { hashHex?: string; n?: number; index?: number; globalIndex?: number; time?: number } = {}): Promise<TimestampDocument> {
	const n = opts.n ?? 7;
	const index = opts.index ?? 4;
	const leaves = Array.from({ length: n }, (_, i) => (i === index ? rekordBody(opts.hashHex ?? NAMED_HEX) : rekordBody((i.toString(16) + "0").repeat(32))));
	const entry = { body: b64(leaves[index]), integratedTime: opts.time ?? 1_790_000_000, logIndex: opts.globalIndex ?? index, logID: LOG_ID };
	const raw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(canonicalJSON(entry))));
	return {
		schema: TIMESTAMP_SCHEMA,
		manifestHash: MANIFEST_HASH,
		authority: { kind: "rekor", logId: LOG_ID, url: "http://mock-log.test" },
		entry,
		signedEntryTimestamp: b64(rawToDer(raw)),
		inclusionProof: { logIndex: index, treeSize: n, rootHash: hex(mth(leaves)), hashes: path(index, leaves).map(hex) },
	};
}

describe("verifyTimestamp against a mock log", () => {
	it("verifies, and reports the LOG's time rather than the manifest's claim", async () => {
		const r = await verifyTimestamp(await anchored({ time: 1_790_000_000 }), { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r).toMatchObject({ verified: true, attestedTime: "2026-09-21T14:13:20.000Z", logIndex: 4, checks: { hashMatches: true, signedEntryTimestamp: true, inclusionProof: "valid" } });
		expect(r.errors).toEqual([]);
	});

	it.each([[1, 0], [2, 1], [5, 4], [8, 7], [13, 6]])("checks inclusion in a tree of %i at index %i", async (n, index) => {
		const r = await verifyTimestamp(await anchored({ n, index }), { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r.checks.inclusionProof).toBe("valid");
	});

	it("refuses an entry that names a different manifest", async () => {
		const r = await verifyTimestamp(await anchored({ hashHex: "cd".repeat(32) }), { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r.verified).toBe(false);
		expect(r.checks.hashMatches).toBe(false);
		expect(r.attestedTime).toBeUndefined();
	});

	it("refuses an entry naming the digest D itself: that is not what the platform key signed", async () => {
		const r = await verifyTimestamp(await anchored({ hashHex: MANIFEST_HEX }), { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r.verified).toBe(false);
		expect(r.checks.hashMatches).toBe(false);
	});

	it("checks a sharded log's proof at its tree position, not the entry's global index", async () => {
		const r = await verifyTimestamp(await anchored({ n: 7, index: 4, globalIndex: 123_456_789 }), { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r).toMatchObject({ verified: true, logIndex: 123_456_789, checks: { inclusionProof: "valid" } });
	});

	it("refuses a time that was changed after the log signed it", async () => {
		const doc = await anchored();
		doc.entry.integratedTime -= 86_400 * 365; // backdated a year
		const r = await verifyTimestamp(doc, { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r.verified).toBe(false);
		expect(r.checks.signedEntryTimestamp).toBe(false);
	});

	it("refuses a log it was not told to trust", async () => {
		const r = await verifyTimestamp(await anchored(), { manifestHash: MANIFEST_HASH, trustedLogKeys: [], subtle });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toContain("not a trusted log");
	});

	it("refuses a tampered inclusion proof, but accepts a document with none", async () => {
		const doc = await anchored();
		doc.inclusionProof!.hashes[0] = "00".repeat(32);
		expect((await verifyTimestamp(doc, { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle })).checks.inclusionProof).toBe("invalid");
		delete doc.inclusionProof;
		const r = await verifyTimestamp(doc, { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle });
		expect(r).toMatchObject({ verified: true, checks: { inclusionProof: "absent" } });
	});

	it("rejects things that are not timestamp documents", async () => {
		for (const bad of [null, {}, { schema: "other" }]) {
			expect((await verifyTimestamp(bad, { manifestHash: MANIFEST_HASH, trustedLogKeys: trusted, subtle })).verified).toBe(false);
		}
	});
});

describe("derEcdsaToRaw", () => {
	it("round-trips a signature with high-bit and short components", () => {
		const raw = new Uint8Array(64);
		raw[0] = 0x80; // r needs a leading zero in DER
		raw[63] = 0x01; // s is one byte long
		expect(derEcdsaToRaw(rawToDer(raw))).toEqual(raw);
	});
	it("rejects malformed DER", () => {
		expect(derEcdsaToRaw(new Uint8Array([0x31, 0x00]))).toBeNull();
		expect(derEcdsaToRaw(new Uint8Array([0x30, 0x05, 0x02, 0x01, 0x01]))).toBeNull();
	});
});
