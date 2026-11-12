import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createPublicKey, sign as nodeSign, createHash } from "node:crypto";

import { verifyErasureReceipt } from "../src/verify-erasure.js";
import { ERASURE_RECEIPT_SCHEMA_URL } from "../src/erasure-schema.js";
import { canonicalJSON, manifestBodyForSigning, utf8Bytes } from "../src/canonical.js";

/**
 * These tests sign with plain node crypto and verify with the package — the
 * same shape a stranger checking one of our receipts would use, with no
 * Divinci server code in the path.
 */

const { privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY = Buffer.from(
	(createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer).subarray(-32)
).toString("base64");

const keyResolver = async (keyId: string) =>
	keyId.startsWith("tbr-") ? new Uint8Array(Buffer.from(PUBLIC_KEY, "base64")) : null;

function edit(over: Record<string, unknown> = {}) {
	return {
		seqNo: 1,
		op: "DELETE",
		status: "COMMITTED",
		kind: "ffn_delete",
		kindSource: "recorded",
		subjectFingerprint: "f00dcafe1234567890abcdef00000000",
		vindexSha256: "b20ff753",
		layer: 14,
		feature: 2113,
		alpha: -1,
		larqlRuntime: "b20ff753-2017b761",
		committedAt: "2026-09-14T10:00:00.000Z",
		revertedAt: null,
		evidence: {
			gate: { scoreBefore: 0.81, scoreAfter: 0.02 },
			output: { top1Changed: true, totalVariation: 0.63, k: 10 },
			readings: { k: 10, measuredAtomically: true, promptCount: 1 },
			survival: null,
		},
		provenance: { sourceKind: "measured", modelInvoked: true },
		...over,
	};
}

function body(over: Record<string, unknown> = {}) {
	return {
		schema: ERASURE_RECEIPT_SCHEMA_URL,
		version: "1.0.0",
		receiptId: "erc_abc123",
		issuedAt: "2026-09-14T10:00:00.000Z",
		workspaceId: "wl-1",
		model: { id: "gemma-4-E2B" },
		patchSet: { sha: "deadbeef", activeCount: 1, version: 3 },
		scope: "Each edit below records that a suppression was applied…",
		kinds: { ffn_delete: "…" },
		edits: [edit()],
		runs: null,
		...over,
	};
}

/** Sign exactly as the server does: Ed25519 over sha256(canonicalJSON(body)). */
function sign(b: Record<string, unknown>, keyId = "tbr-staging-001") {
	const digest = createHash("sha256")
		.update(canonicalJSON(manifestBodyForSigning(b as { signatures?: unknown })))
		.digest();
	return {
		...b,
		signatures: [{
			signer: "divinci-erasure",
			keyId,
			algorithm: "ed25519",
			publicKey: PUBLIC_KEY,
			signature: nodeSign(null, digest, privateKey).toString("base64"),
		}],
	};
}

describe("verifyErasureReceipt", () => {
	it("verifies a well-formed signed receipt offline", async () => {
		const r = await verifyErasureReceipt(sign(body()), { keyResolver });
		expect(r.errors).toEqual([]);
		expect(r.signatureValid).toBe(true);
		expect(r.signedBy).toEqual({ keyId: "tbr-staging-001", signer: "divinci-erasure" });
		expect(r.patchSetSha).toBe("deadbeef");
		expect(r.measured).toEqual({ edits: 1, measuredEdits: 1 });
	});

	it("still verifies a receipt carrying fields this version does not know", async () => {
		// The forward-compatibility case, and the one easiest to get wrong: zod
		// STRIPS unknown keys by default, so a verifier that hashed its parsed
		// output instead of the original input would compute a digest over a
		// document the signer never saw and reject every newer receipt.
		const future = sign({ ...body(), someV2Field: { added: "later" } });
		const r = await verifyErasureReceipt(future, { keyResolver });
		expect(r.signatureValid).toBe(true);
		expect(r.errors).toEqual([]);
	});

	it("rejects a receipt signed under the TrustRun manifest lineage", async () => {
		// The server refuses to MINT this; the same rule is enforced on read, so
		// a receipt that reached a consumer under the wrong lineage is refused
		// rather than accepted because the maths happened to work.
		const r = await verifyErasureReceipt(sign(body(), "tbp-prod-002"), {
			keyResolver: async () => new Uint8Array(Buffer.from(PUBLIC_KEY, "base64")),
		});
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toMatch(/not in the erasure lineage/);
	});

	it("detects a tampered body", async () => {
		const signed = sign(body()) as Record<string, any>;
		signed["edits"][0]["evidence"]["output"]["totalVariation"] = 0.99;
		const r = await verifyErasureReceipt(signed, { keyResolver });
		expect(r.verified).toBe(false);
		expect(r.signatureValid).toBe(false);
	});

	it("WARNS that a changelog is not evidence when nothing was measured", async () => {
		const unmeasured = sign(body({
			edits: [edit({
				evidence: { gate: null, output: null, readings: null, survival: null },
				provenance: { sourceKind: "unmeasured", modelInvoked: false },
			})],
		}));
		const r = await verifyErasureReceipt(unmeasured, { keyResolver });
		expect(r.signatureValid).toBe(true);
		expect(r.measured).toEqual({ edits: 1, measuredEdits: 0 });
		expect(r.warnings.join(" ")).toMatch(/CHANGELOG of what was applied, not evidence/);
	});

	it("always reports that no efficacy evidence is carried in v1", async () => {
		// `runs: null` is the absent Efficacy Receipt. Saying so out loud matters
		// more than the field: a reader skimming warnings must not come away
		// thinking a signed changelog proved an erasure.
		const r = await verifyErasureReceipt(sign(body()), { keyResolver });
		expect(r.carriesEfficacyEvidence).toBe(false);
		expect(r.warnings.join(" ")).toMatch(/must not be read as proof of erasure/);
	});

	it("strict turns those warnings into a failure", async () => {
		const ok = await verifyErasureReceipt(sign(body()), { keyResolver });
		expect(ok.verified).toBe(true);
		const strict = await verifyErasureReceipt(sign(body()), { keyResolver, strict: true });
		expect(strict.verified).toBe(false);
		expect(strict.signatureValid).toBe(true); // the signature was never the problem
	});

	it("flags an edit with no subject fingerprint", async () => {
		const r = await verifyErasureReceipt(
			sign(body({ edits: [edit({ subjectFingerprint: null })] })),
			{ keyResolver }
		);
		expect(r.warnings.join(" ")).toMatch(/predate subject sealing/);
	});

	it("refuses a receipt whose publicKey disagrees with the registry", async () => {
		const other = generateKeyPairSync("ed25519");
		const otherPub = new Uint8Array(
			(other.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32)
		);
		const r = await verifyErasureReceipt(sign(body()), { keyResolver: async () => otherPub });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toMatch(/does not match the registry entry/);
	});

	it("rejects a non-receipt without throwing", async () => {
		const r = await verifyErasureReceipt({ hello: "world" }, { keyResolver });
		expect(r.verified).toBe(false);
		expect(r.errors[0]).toMatch(/schema validation failed/);
	});

	it("never carries a subject, only its fingerprint", async () => {
		const wire = JSON.stringify(sign(body()));
		expect(wire).not.toMatch(/"entity"|"relation"|"target"|sealedSubject/);
		expect(wire).toContain("subjectFingerprint");
	});
});
