import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createPublicKey, sign as nodeSign, createHash } from "node:crypto";

import { verifyArtifactAttestation, checkArtifactFiles } from "../src/verify-artifact.js";
import { ARTIFACT_ATTESTATION_SCHEMA_URL } from "../src/artifact-schema.js";
import { canonicalJSON, manifestBodyForSigning } from "../src/canonical.js";

/**
 * Signed with plain node crypto, verified with the package — the shape a
 * stranger checking one of our artifact attestations would use, with no Divinci
 * server code in the path.
 */

const { privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY = Buffer.from(
	(createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer).subarray(-32)
).toString("base64");

const keyResolver = async (keyId: string) =>
	keyId.startsWith("tba-") ? new Uint8Array(Buffer.from(PUBLIC_KEY, "base64")) : null;

const HEX = (c: string) => c.repeat(64);

function body(over: Record<string, unknown> = {}, artifactOver: Record<string, unknown> = {}) {
	const files = [
		{ path: "gate_vectors.bin", sha256: HEX("a"), bytes: 100, witness: "artifact-manifest" },
		{ path: "ple_weights.bin", sha256: HEX("b"), bytes: 50, witness: "operator-declared" },
	];
	return {
		schema: ARTIFACT_ATTESTATION_SCHEMA_URL,
		version: "1.0.0",
		attestationId: "att-1",
		issuedAt: "2026-09-17T00:00:00.000Z",
		artifact: {
			name: "gemma4-full-b20ff753",
			kind: "larql-vindex",
			origin: "gs://divinci-larql-vindex/gemma4-full-b20ff753",
			totalBytes: 150,
			files,
			note: "downloaded with gcloud storage cp, which validates checksums",
			...artifactOver,
		},
		scope: "identity of bytes only",
		...over,
	};
}

/** Sign exactly as the server does: Ed25519 over sha256(canonicalJSON(body)). */
function sign(b: Record<string, unknown>, keyId = "tba-prod-001", signer = "divinci-artifact") {
	const digest = createHash("sha256")
		.update(canonicalJSON(manifestBodyForSigning(b as { signatures?: unknown })))
		.digest();
	return {
		...b,
		signatures: [{
			signer,
			keyId,
			algorithm: "ed25519",
			publicKey: PUBLIC_KEY,
			signature: nodeSign(null, digest, privateKey).toString("base64"),
		}],
	};
}

describe("verifyArtifactAttestation", () => {
	it("verifies a well-formed attestation offline", async () => {
		const r = await verifyArtifactAttestation(sign(body()), { keyResolver });
		expect(r.errors).toEqual([]);
		expect(r.signatureValid).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.signedBy).toEqual({ keyId: "tba-prod-001", signer: "divinci-artifact" });
		expect(r.artifactName).toBe("gemma4-full-b20ff753");
	});

	it("names operator-declared digests as a warning — and strict refuses them", async () => {
		const signed = sign(body());
		const loose = await verifyArtifactAttestation(signed, { keyResolver });
		expect(loose.operatorDeclaredPaths).toEqual(["ple_weights.bin"]);
		expect(loose.warnings.join(" ")).toContain("operator-declared");
		expect(loose.verified).toBe(true);
		const strict = await verifyArtifactAttestation(signed, { keyResolver, strict: true });
		expect(strict.verified).toBe(false);
	});

	it("raises no witness warning when every digest was manifest-confirmed", async () => {
		const allConfirmed = body({}, {
			files: [{ path: "a.bin", sha256: HEX("a"), bytes: 150, witness: "artifact-manifest" }],
		});
		const r = await verifyArtifactAttestation(sign(allConfirmed), { keyResolver, strict: true });
		expect(r.warnings).toEqual([]);
		expect(r.verified).toBe(true);
	});

	it("rejects a TAMPERED digest — the whole point of signing one", async () => {
		const signed = sign(body()) as any;
		signed.artifact.files[0].sha256 = HEX("c");
		const r = await verifyArtifactAttestation(signed, { keyResolver });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toContain("does not validate");
	});

	it("rejects an attestation signed under the erasure lineage", async () => {
		// tbr-* is server-held; it must not be able to vouch for which bytes an artifact is.
		const r = await verifyArtifactAttestation(sign(body(), "tbr-staging-001"), {
			keyResolver: async () => new Uint8Array(Buffer.from(PUBLIC_KEY, "base64")),
		});
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toContain("not in the artifact lineage");
	});

	it("rejects a key the registry does not know, even with a valid-looking key attached", async () => {
		// A key carried on the document proves nothing: anyone can sign with their own.
		const r = await verifyArtifactAttestation(sign(body()), { keyResolver: async () => null });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toContain("unknown signing keyId");
	});

	it("rejects the wrong signer literal", async () => {
		const r = await verifyArtifactAttestation(sign(body(), "tba-prod-001", "divinci-erasure"), { keyResolver });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toContain("schema validation failed");
	});

	it("rejects totalBytes that disagree with the files, even when signed", async () => {
		const r = await verifyArtifactAttestation(sign(body({}, { totalBytes: 999 })), { keyResolver });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toContain("totalBytes");
	});

	it("rejects duplicate paths", async () => {
		const dup = body({}, {
			files: [
				{ path: "a.bin", sha256: HEX("a"), bytes: 75, witness: "artifact-manifest" },
				{ path: "a.bin", sha256: HEX("b"), bytes: 75, witness: "artifact-manifest" },
			],
		});
		const r = await verifyArtifactAttestation(sign(dup), { keyResolver });
		expect(r.errors.join(" ")).toContain("duplicate file path");
	});

	it.each(["../escape.bin", "/abs.bin", "dir/../x.bin"])("rejects an unsafe path %j", async (p) => {
		const bad = body({}, { files: [{ path: p, sha256: HEX("a"), bytes: 150, witness: "artifact-manifest" }] });
		const r = await verifyArtifactAttestation(sign(bad), { keyResolver });
		expect(r.verified).toBe(false);
	});

	it("rejects a malformed digest", async () => {
		const bad = body({}, { files: [{ path: "a.bin", sha256: "ABC", bytes: 150, witness: "artifact-manifest" }] });
		expect((await verifyArtifactAttestation(sign(bad), { keyResolver })).verified).toBe(false);
	});

	// NOTE — an equivalent mutant, recorded rather than hidden: digesting the
	// PARSED value instead of the original input currently changes nothing,
	// because every digested object in ArtifactAttestationV1 is .passthrough()
	// and canonicalJSON sorts keys. No test can distinguish them today. The
	// input-digest rule is kept for the day a schema object is tightened: then
	// zod would strip a newer field and a parsed-value digest would reject every
	// newer document. This test still pins the forward-compatible outcome.
	it("still verifies a document carrying fields this version does not know", async () => {
		const r = await verifyArtifactAttestation(sign({ ...body(), someV2Field: { added: "later" } }), { keyResolver });
		expect(r.signatureValid).toBe(true);
		expect(r.errors).toEqual([]);
	});
});

describe("checkArtifactFiles", () => {
	const attested = [
		{ path: "gate_vectors.bin", sha256: HEX("a"), bytes: 100 },
		{ path: "up_weights.bin", sha256: HEX("b"), bytes: 100 },
	];

	it("matches when every file is present with the right digest and size", () => {
		const r = checkArtifactFiles(attested, new Map([
			["gate_vectors.bin", { sha256: HEX("a"), bytes: 100 }],
			["up_weights.bin", { sha256: HEX("b"), bytes: 100 }],
		]));
		expect(r.matches).toBe(true);
	});

	it("catches the modified-copy case: right names, rewritten bytes", () => {
		// ~/vindex/gemma4-full-b20ff753 on 2026-09-16: two files rewritten after
		// extraction, under the artifact's name.
		const r = checkArtifactFiles(attested, new Map([
			["gate_vectors.bin", { sha256: HEX("e"), bytes: 100 }],
			["up_weights.bin", { sha256: HEX("b"), bytes: 100 }],
		]));
		expect(r.matches).toBe(false);
		expect(r.mismatched.map((m) => m.path)).toEqual(["gate_vectors.bin"]);
	});

	it("catches a truncated file whose digest you did not compute", () => {
		const r = checkArtifactFiles(attested, new Map([
			["gate_vectors.bin", { sha256: HEX("a"), bytes: 99 }],
			["up_weights.bin", { sha256: HEX("b"), bytes: 100 }],
		]));
		expect(r.matches).toBe(false);
	});

	it("reports missing and unexpected files rather than ignoring them", () => {
		const r = checkArtifactFiles(attested, new Map([
			["gate_vectors.bin", { sha256: HEX("a"), bytes: 100 }],
			["extra.bin", { sha256: HEX("f"), bytes: 1 }],
		]));
		expect(r.matches).toBe(false);
		expect(r.missing).toEqual(["up_weights.bin"]);
		expect(r.unexpected).toEqual(["extra.bin"]);
	});

	it("refuses a directory with an EXTRA file even when every attested file matches", () => {
		// An artifact directory is loaded as a unit; a file nobody attested can
		// still be read. A check that only looks at attested paths would pass it.
		const r = checkArtifactFiles(attested, new Map([
			["gate_vectors.bin", { sha256: HEX("a"), bytes: 100 }],
			["up_weights.bin", { sha256: HEX("b"), bytes: 100 }],
			["injected.bin", { sha256: HEX("f"), bytes: 1 }],
		]));
		expect(r.missing).toEqual([]);
		expect(r.mismatched).toEqual([]);
		expect(r.unexpected).toEqual(["injected.bin"]);
		expect(r.matches).toBe(false);
	});

	it("compares digests case-insensitively on the caller's side only", () => {
		const r = checkArtifactFiles(attested, new Map([
			["gate_vectors.bin", { sha256: HEX("A"), bytes: 100 }],
			["up_weights.bin", { sha256: HEX("b"), bytes: 100 }],
		]));
		expect(r.matches).toBe(true);
	});
});
