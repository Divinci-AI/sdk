import { describe, it, expect, beforeAll } from "vitest";
import * as ed from "@noble/ed25519";

import { verify } from "../src/verify";
import { canonicalJSON, utf8Bytes } from "../src/canonical";
import type { TrustRunManifest, KeyResolver } from "../src/types";

/**
 * A verifier must be able to tell a measured score from a fabricated one
 * WITHOUT trusting Divinci.
 *
 * Until R1 it could not. On 2026-08-27 a stub evaluation (score = a byte of
 * sha256(benchmarkId + ":" + assistantId), the model never called) and a real
 * ScoredQA publish sat in the same bucket and verified IDENTICALLY on two live
 * public URLs — `verified: true`, `signatureValid: true`, no warnings, same
 * platform key. The only tell was a `_stub: true` marker in the OUTPUTS blob,
 * which a consumer who verifies the manifest and stops there never fetches.
 *
 * `results.provenance` is signed, so it cannot be edited after the fact, and
 * `verify()` surfaces it on the result.
 */

const TEST_KEY_ID = "tbp-test-001";
const RUN_ID = "tr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const OUTPUTS_KEY = `trustbench/runs/${RUN_ID}/outputs.json`;

let priv: Uint8Array;
let pub: Uint8Array;
let pubB64: string;

beforeAll(async () => {
	priv = ed.utils.randomPrivateKey();
	pub = await ed.getPublicKeyAsync(priv);
	pubB64 = bytesToBase64(pub);
});

const resolver: KeyResolver = async () => pub;

function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
	return out;
}

type Provenance = NonNullable<TrustRunManifest["results"]["provenance"]>;

const MEASURED: Provenance = {
	sourceKind: "measured",
	modelInvoked: true,
	evaluator: {
		name: "divinci-qa-v1",
		version: "1.0",
		invocationId: "evh_0123456789abcdef0123456789abcdef",
	},
	outputsR2Key: OUTPUTS_KEY,
};

async function signed(
	provenance?: Provenance,
	resultOverrides: Partial<TrustRunManifest["results"]> = {}
): Promise<TrustRunManifest> {
	const outputs = "test-outputs";
	const outputsHash =
		"sha256:" +
		bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Bytes(outputs))));
	const body: Omit<TrustRunManifest, "signatures"> = {
		$schema:
			"https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json",
		version: "1.0.0",
		runId: RUN_ID,
		createdAt: "2026-04-26T10:00:00.000Z",
		completedAt: "2026-04-26T10:01:23.000Z",
		benchmark: {
			id: "bm_01HZZZZZZZZZZZZZZZZZZZZZZZ",
			slug: "divinci-test-v1",
			version: "1.0.0",
			contentHash: "sha256:" + "0".repeat(64),
			authorId: "ba_01HZZZZZZZZZZZZZZZZZZZZZZZ",
			authorSignature: "base64sig",
		},
		model: {
			assistantId: "claude-opus-4-7",
			providerId: "anthropic",
			modelId: "claude-opus-4-7",
			configHash: "sha256:" + "1".repeat(64),
		},
		harness: {
			name: "inspect_ai",
			version: "0.3.0",
			configHash: "sha256:" + "3".repeat(64),
		},
		execution: {
			tier: "v1-signed-logs",
			platform: "trustbench-divinci",
			region: "us-central1",
			durationMs: 1000,
			signedAt: "2026-04-26T10:01:24.000Z",
		},
		results: {
			score: 0.5,
			metric: "accuracy",
			range: { min: 0, max: 1 },
			outputsR2Key: OUTPUTS_KEY,
			outputsHash,
			sampleCount: 1,
			...(provenance ? { provenance } : {}),
			...resultOverrides,
		},
	};

	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", utf8Bytes(canonicalJSON(body)))
	);
	return {
		...body,
		signatures: [
			{
				signer: "trustbench-platform",
				keyId: TEST_KEY_ID,
				algorithm: "ed25519",
				publicKey: pubB64,
				signature: bytesToBase64(await ed.signAsync(digest, priv)),
			},
		],
	};
}

describe("a verifier can tell measured from fabricated", () => {
	it("surfaces a measured score with no provenance warning", async () => {
		const r = await verify(await signed(MEASURED), { keyResolver: resolver });
		expect(r.verified).toBe(true);
		expect(r.scoreProvenance?.sourceKind).toBe("measured");
		expect(r.scoreProvenance?.evaluator.invocationId).toBe(
			MEASURED.evaluator.invocationId
		);
		expect(r.warnings).toEqual([]);
	});

	it("flags a stub as fabricated even though the signature is valid", async () => {
		const stub: Provenance = {
			...MEASURED,
			sourceKind: "stub",
			modelInvoked: false,
			evaluator: { ...MEASURED.evaluator, name: "trustbench-stub-v1" },
		};
		const r = await verify(await signed(stub), { keyResolver: resolver });

		// The signature IS valid — that is the whole point. A signature attests
		// authorship; provenance attests measurement. They are different claims
		// and the verifier now reports both.
		expect(r.signatureValid).toBe(true);
		expect(r.scoreProvenance?.sourceKind).toBe("stub");
		expect(r.warnings.join(" ")).toMatch(/FABRICATED/);
		expect(r.warnings.join(" ")).toMatch(/never called/);
	});

	it("refuses a stub under strict, while a measured run passes", async () => {
		const stub: Provenance = { ...MEASURED, sourceKind: "stub", modelInvoked: false };
		const strict = { keyResolver: resolver, strict: true } as const;
		expect((await verify(await signed(stub), strict)).verified).toBe(false);
		expect((await verify(await signed(MEASURED), strict)).verified).toBe(true);
	});

	it("names the upstream run for a republished score", async () => {
		const republished: Provenance = {
			...MEASURED,
			sourceKind: "republished",
			modelInvoked: false,
			evaluator: { ...MEASURED.evaluator, name: "divinci-arena-shim" },
			upstreamRef: "divinci://scored-qa/suite/abc/release/def",
		};
		const r = await verify(await signed(republished), { keyResolver: resolver });
		expect(r.verified).toBe(true);
		expect(r.scoreProvenance?.sourceKind).toBe("republished");
		expect(r.warnings.join(" ")).toContain("divinci://scored-qa/suite/abc/release/def");
	});
});

describe("manifests signed before provenance existed", () => {
	/**
	 * The three production TrustRuns of 2026-08-27/28 — including
	 * tr_7M6WVSAKQ17A4E3N78GKGMMFAR under tbp-prod-002 — carry no provenance
	 * block. They must keep verifying, and they must not be reported as
	 * measured, because nobody knows whether they were.
	 */
	it("still verify, with scoreProvenance null and a warning saying so", async () => {
		const r = await verify(await signed(undefined), { keyResolver: resolver });
		expect(r.verified).toBe(true);
		expect(r.signatureValid).toBe(true);
		expect(r.errors).toEqual([]);
		expect(r.scoreProvenance).toBeNull();
		expect(r.warnings.join(" ")).toMatch(/no results\.provenance/);
	});

	it("a consumer who cannot accept unknown provenance can refuse in one flag", async () => {
		const r = await verify(await signed(undefined), {
			keyResolver: resolver,
			strict: true,
		});
		expect(r.verified).toBe(false);
		expect(r.signatureValid).toBe(true); // the signature was never the problem
	});
});

describe("provenance must point at the evidence this manifest hashes", () => {
	it("fails when provenance.outputsR2Key disagrees with results.outputsR2Key", async () => {
		const mismatched: Provenance = {
			...MEASURED,
			outputsR2Key: "trustbench/runs/tr_SOMEONE_ELSE/outputs.json",
		};
		const r = await verify(await signed(mismatched), { keyResolver: resolver });
		expect(r.verified).toBe(false);
		expect(r.errors.join(" ")).toMatch(/outputsR2Key/);
	});
});

describe("schema drift with the signer", () => {
	/**
	 * This package could not parse what the signer mints: `harness.name` was
	 * pinned to `z.literal("inspect_ai")` and `imageDigest` was required, both
	 * of which the server-side schema relaxed. A shim-produced manifest —
	 * every ScoredQA publish — failed schema validation here.
	 */
	it("parses a shim manifest with no image digest", async () => {
		const m = await signed(MEASURED);
		const shim = { ...m, harness: { ...m.harness, name: "divinci-arena-shim" as const } };
		const r = await verify(shim, { keyResolver: resolver });
		// The signature no longer covers the edited body, so it fails on the
		// SIGNATURE — not on schema validation, which is what regressed before.
		expect(r.errors.join(" ")).not.toMatch(/schema validation failed/);
	});
});
