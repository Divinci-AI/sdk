/**
 * Provider ids are forward compatible: a well-shaped id this verifier release
 * does not know must still verify (signature, hashes and keys checked exactly
 * as for a known id), with a WARNING. A malformed id is still rejected, and a
 * tampered manifest still fails its signature.
 *
 * Origin: the published verifier lacked `voyage` after Voyage rows went public,
 * and a stale CLI showed genuinely signed rows as failed, because a closed enum
 * rejected the id before the signature step ran.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as ed from "@noble/ed25519";
import { verify } from "../src/verify";
import { canonicalJSON, utf8Bytes } from "../src/canonical";
import { KNOWN_PROVIDER_IDS } from "../src/schema";

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

async function signedWithProvider(providerId: string) {
	const body = {
		$schema: "https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json",
		version: "1.0.0",
		runId: "tr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
		createdAt: "2026-09-24T23:28:35.000Z",
		completedAt: "2026-09-24T23:40:19.000Z",
		benchmark: {
			id: "bm_01HZZZZZZZZZZZZZZZZZZZZZZZ", slug: "dfo", version: "1.0.0",
			contentHash: "sha256:" + "0".repeat(64), authorId: "ba_01HZZZZZZZZZZZZZZZZZZZZZZZ", authorSignature: "x",
		},
		model: { assistantId: "a", providerId, modelId: "m", configHash: "sha256:" + "1".repeat(64) },
		harness: { name: "divinci-arena-shim", version: "v1", configHash: "sha256:" + "3".repeat(64) },
		execution: { tier: "v1-signed-logs", platform: "trustbench-divinci", region: "us-central1", durationMs: 1, signedAt: "2026-09-25T00:42:08.000Z" },
		results: {
			score: 0.5, metric: "m", range: { min: 0, max: 1 },
			outputsR2Key: "trustbench/runs/tr_01HZZZZZZZZZZZZZZZZZZZZZZZ/outputs.json",
			outputsHash: "sha256:" + "2".repeat(64), sampleCount: 1,
			provenance: {
				sourceKind: "measured", modelInvoked: true,
				evaluator: { name: "e", version: "1", invocationId: "i" },
				outputsR2Key: "trustbench/runs/tr_01HZZZZZZZZZZZZZZZZZZZZZZZ/outputs.json",
			},
		},
	};
	const sig = await ed.signAsync(await sha256(utf8Bytes(canonicalJSON(body))), priv);
	return { ...body, signatures: [{ signer: "trustbench-platform", keyId: KEY_ID, algorithm: "ed25519", publicKey: b64(pub), signature: b64(sig) }] };
}

describe("unknown provider id", () => {
	it("a known id verifies with no provider warning", async () => {
		const r = await verify(await signedWithProvider("voyage"), { keyResolver: resolver });
		expect(r.errors).toEqual([]);
		expect(r.verified).toBe(true);
		expect(r.warnings).toEqual([]);
	});

	it("an unknown id with a VALID signature verifies, with a warning", async () => {
		const r = await verify(await signedWithProvider("brand-new-provider"), { keyResolver: resolver });
		expect(r.errors).toEqual([]);
		expect(r.signatureValid).toBe(true);
		expect(r.verified).toBe(true);
		expect(r.warnings).toEqual([
			"unknown provider id 'brand-new-provider'; verifier may be older than the run",
		]);
	});

	it("--strict (options.strict) fails on the warning", async () => {
		const r = await verify(await signedWithProvider("brand-new-provider"), { keyResolver: resolver, strict: true });
		expect(r.signatureValid).toBe(true);
		expect(r.verified).toBe(false);
	});

	it("a tampered field on an unknown-provider manifest still FAILS the signature", async () => {
		const m = (await signedWithProvider("brand-new-provider")) as any;
		m.results.score = 0.99;
		const r = await verify(m, { keyResolver: resolver });
		expect(r.signatureValid).toBe(false);
		expect(r.verified).toBe(false);
	});

	it("swapping the provider id after signing fails the signature", async () => {
		const m = (await signedWithProvider("brand-new-provider")) as any;
		m.model.providerId = "anthropic";
		const r = await verify(m, { keyResolver: resolver });
		expect(r.signatureValid).toBe(false);
		expect(r.verified).toBe(false);
	});

	it.each([
		["empty", ""],
		["too long", "a".repeat(65)],
		["uppercase", "Voyage"],
		["space", "my provider"],
		["markup", "<script>"],
		["newline", "x\ny"],
	])("a malformed id (%s) is rejected before anything else, even when correctly signed", async (_n, bad) => {
		const r = await verify(await signedWithProvider(bad), { keyResolver: resolver });
		expect(r.verified).toBe(false);
		expect(r.signatureValid).toBe(false);
		expect(r.errors[0]).toMatch(/schema validation failed: model\.providerId/);
	});

	it("the known list contains every id the previous closed enum accepted", () => {
		for (const id of ["anthropic", "openai", "google", "xai", "cohere", "mistral", "together", "modal", "replicate", "fireworks", "cloudflare-workers-ai", "self-hosted", "typesafe", "voyage"]) {
			expect(KNOWN_PROVIDER_IDS).toContain(id);
		}
	});
});
