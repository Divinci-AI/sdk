/**
 * KNOWN-GAPS `trustbench-verifier-strips-unknown-manifest-fields` (and its
 * duplicate `trustrun-verifier-strips-unknown-keys-before-hashing`) and
 * `publish-to-trust-fills-and-times-without-recording`.
 *
 * 1. verify() used to hash the ZOD-PARSED manifest. Zod strips unknown keys,
 *    so a manifest carrying any field this version did not know was hashed as
 *    a different document than the one signed, and failed. That made additive
 *    manifest evolution impossible. It now hashes the manifest as received.
 * 2. Republished outputs (scoredqa-publish/v1.1) carry a coverage block:
 *    failed retrieval, samples filled from an earlier pass, missing samples.
 *    Those become warnings, so `strict: true` refuses them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as ed from "@noble/ed25519";
import { verify, readOutputsCoverage, coverageWarnings } from "../src/verify";
import { canonicalJSON, utf8Bytes } from "../src/canonical";

const KEY_ID = "tbp-test-001";
let priv: Uint8Array;
let pub: Uint8Array;
const resolver = async (id: string) => (id === KEY_ID ? pub : null);

beforeAll(async () => {
	priv = ed.utils.randomPrivateKey();
	pub = await ed.getPublicKeyAsync(priv);
});

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function signed(outputs: string, extra: Record<string, unknown> = {}) {
	const body: Record<string, unknown> = {
		$schema: "https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json",
		version: "1.0.0",
		runId: "tr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
		createdAt: "2026-09-24T23:28:35.000Z",
		completedAt: "2026-09-24T23:40:19.000Z",
		benchmark: {
			id: "bm_01HZZZZZZZZZZZZZZZZZZZZZZZ", slug: "dfo", version: "1.0.0",
			contentHash: "sha256:" + "0".repeat(64), authorId: "ba_01HZZZZZZZZZZZZZZZZZZZZZZZ", authorSignature: "x",
		},
		model: { assistantId: "@cf/zai-org/glm-5.3-flash", providerId: "cloudflare-workers-ai", modelId: "glm-5.3-flash", configHash: "sha256:" + "1".repeat(64) },
		harness: { name: "divinci-arena-shim", version: "divinci-arena-shim-1.0", configHash: "sha256:" + "3".repeat(64) },
		execution: { tier: "v1-signed-logs", platform: "trustbench-divinci", region: "us-central1", durationMs: 704000, signedAt: "2026-09-25T00:42:08.000Z" },
		results: {
			score: 0.9467, metric: "llm-factual-consistency-vs-reference-judged-by-gemini-2.5-flash", range: { min: 0, max: 1 },
			outputsR2Key: "trustbench/runs/tr_01HZZZZZZZZZZZZZZZZZZZZZZZ/outputs.json",
			outputsHash: "sha256:" + hex(await sha256(utf8Bytes(outputs))), sampleCount: 60,
		},
		...extra,
	};
	const sig = await ed.signAsync(await sha256(utf8Bytes(canonicalJSON(body))), priv);
	return { ...body, signatures: [{ signer: "trustbench-platform", keyId: KEY_ID, algorithm: "ed25519", publicKey: b64(pub), signature: b64(sig) }] };
}

const v11 = (coverage: Record<string, unknown>, selection: Record<string, unknown> = { mode: "run", allowDegradedRetrieval: false }) =>
	JSON.stringify({ schema: "scoredqa-publish/v1.1", selection, coverage, results: [] });

describe("forward compatibility: a manifest with a field this verifier does not know", () => {
	it("still verifies, because the signature is checked over the manifest as received", async () => {
		const m = await signed("o", { futureQualityBlock: { retrievalWithFailure: 0 } });
		const r = await verify(m, { keyResolver: resolver });
		expect(r.errors).toEqual([]);
		expect(r.signatureValid).toBe(true);
	});

	it("still fails when the unknown field is tampered with after signing", async () => {
		const m = await signed("o", { futureQualityBlock: { retrievalWithFailure: 0 } });
		(m as Record<string, unknown>).futureQualityBlock = { retrievalWithFailure: 9 };
		const r = await verify(m, { keyResolver: resolver });
		expect(r.signatureValid).toBe(false);
	});
});

describe("coverage from signed outputs (scoredqa-publish/v1.1)", () => {
	const clean = { expectedSamples: 60, scoredSamples: 60, missingSamples: 0, filledSamples: 0, retrieval: { recorded: 60, withContext: 60, withFailure: 0 } };

	it("a complete run with healthy retrieval adds no warning", async () => {
		const outputs = v11(clean);
		const r = await verify(await signed(outputs), { keyResolver: resolver, outputs });
		expect(r.outputsCoverage).toMatchObject({ expectedSamples: 60, retrievalWithFailure: 0, selectionMode: "run" });
		expect(r.warnings.filter((w) => !w.includes("provenance"))).toEqual([]);
	});

	it("warns on failed retrieval, filled and missing samples, and strict refuses", async () => {
		const outputs = v11(
			{ ...clean, scoredSamples: 59, missingSamples: 1, filledSamples: 1, retrieval: { recorded: 60, withContext: 57, withFailure: 3 } },
			{ mode: "latest-per-test", allowDegradedRetrieval: true },
		);
		const m = await signed(outputs);
		const r = await verify(m, { keyResolver: resolver, outputs });
		const w = r.warnings.join("\n");
		expect(w).toContain("retrieval failed on 3 of 60 recorded samples");
		expect(w).toContain("allowDegradedRetrieval");
		expect(w).toContain("1 sample(s) were taken from an earlier pass");
		expect(w).toContain("1 of the benchmark's 60 samples have no score");
		expect(r.signatureValid).toBe(true);
		const strict = await verify(m, { keyResolver: resolver, outputs, strict: true });
		expect(strict.verified).toBe(false);
	});

	it("ignores coverage when the outputs do not match the manifest", async () => {
		const m = await signed(v11(clean));
		const tampered = v11({ ...clean, retrieval: { recorded: 60, withFailure: 5 } });
		const r = await verify(m, { keyResolver: resolver, outputs: tampered });
		expect(r.outputsHashMatches).toBe(false);
		expect(r.outputsCoverage).toBeNull();
	});

	it("reads nothing from pre-v1.1 outputs: absence is not evidence of a gap", () => {
		expect(readOutputsCoverage(JSON.stringify({ schema: "scoredqa-publish/v1", results: [] }))).toBeNull();
		expect(readOutputsCoverage("not json")).toBeNull();
		expect(coverageWarnings({
			expectedSamples: 0, scoredSamples: 0, missingSamples: 0, filledSamples: 0,
			retrievalRecorded: 0, retrievalWithFailure: 0, selectionMode: null, allowDegradedRetrieval: false,
		})).toEqual([]);
	});
});
