import { describe, it, expect, beforeAll } from "vitest";
import * as ed from "@noble/ed25519";

import { verify } from "../src/verify";
import {
	canonicalJSON,
	manifestBodyForSigning,
	utf8Bytes,
} from "../src/canonical";
import type {
	TrustRunManifest,
	WellKnownRegistry,
	KeyResolver,
} from "../src/types";

// Test fixtures
const TEST_KEY_ID = "tbp-test-001";
const RUN_ID_VALID = "tr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const BMID_VALID = "bm_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const BAID_VALID = "ba_01HZZZZZZZZZZZZZZZZZZZZZZZ";

let signingPrivateKey: Uint8Array;
let signingPublicKey: Uint8Array;
let signingPublicKeyBase64: string;

beforeAll(async () => {
	// Generate a deterministic-enough Ed25519 keypair for tests
	signingPrivateKey = ed.utils.randomPrivateKey();
	signingPublicKey = await ed.getPublicKeyAsync(signingPrivateKey);
	signingPublicKeyBase64 = bytesToBase64(signingPublicKey);
});

function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
	return out;
}

async function sha256Hex(s: string): Promise<string> {
	return bytesToHex(await sha256(utf8Bytes(s)));
}

async function makeSignedManifest(
	overrides: Partial<TrustRunManifest> = {},
	outputsContent: string = "test-outputs"
): Promise<TrustRunManifest> {
	const outputsHash = "sha256:" + (await sha256Hex(outputsContent));
	const baseBody: Omit<TrustRunManifest, "signatures"> = {
		$schema:
			"https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json",
		version: "1.0.0",
		runId: RUN_ID_VALID,
		createdAt: "2026-04-26T10:00:00.000Z",
		completedAt: "2026-04-26T10:01:23.000Z",
		benchmark: {
			id: BMID_VALID,
			slug: "divinci-test-v1",
			version: "1.0.0",
			contentHash:
				"sha256:0000000000000000000000000000000000000000000000000000000000000000",
			authorId: BAID_VALID,
			authorSignature: "base64sig",
		},
		model: {
			assistantId: "claude-opus-4-7",
			providerId: "anthropic",
			modelId: "claude-opus-4-7",
			configHash:
				"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		},
		harness: {
			name: "inspect_ai",
			version: "0.3.0",
			imageDigest:
				"sha256:2222222222222222222222222222222222222222222222222222222222222222",
			configHash:
				"sha256:3333333333333333333333333333333333333333333333333333333333333333",
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
			outputsR2Key: "trustbench/runs/" + RUN_ID_VALID + "/outputs.json",
			outputsHash,
			sampleCount: 1,
		},
		...(overrides as object),
	};

	const canonical = canonicalJSON(baseBody);
	const digest = await sha256(utf8Bytes(canonical));
	const sigBytes = await ed.signAsync(digest, signingPrivateKey);

	return {
		...baseBody,
		signatures: [
			{
				signer: "trustbench-platform",
				keyId: TEST_KEY_ID,
				algorithm: "ed25519",
				publicKey: signingPublicKeyBase64,
				signature: bytesToBase64(sigBytes),
			},
		],
	};
}

describe("verify() — happy paths", () => {
	it("accepts a valid signed manifest with matching key (resolver)", async () => {
		const manifest = await makeSignedManifest();
		const resolver: KeyResolver = async (keyId) => {
			if (keyId === TEST_KEY_ID) return signingPublicKey;
			return null;
		};
		const result = await verify(manifest, { keyResolver: resolver });
		expect(result.verified).toBe(true);
		expect(result.signatureValid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.signedBy).toEqual({
			keyId: TEST_KEY_ID,
			signer: "trustbench-platform",
		});
		expect(result.outputsHashMatches).toBeNull();
		expect(result.benchmarkContentHashMatches).toBeNull();
	});

	it("validates outputs hash when outputs are provided", async () => {
		const manifest = await makeSignedManifest({}, "test-outputs");
		const resolver: KeyResolver = async () => signingPublicKey;
		const result = await verify(manifest, {
			keyResolver: resolver,
			outputs: "test-outputs",
		});
		expect(result.verified).toBe(true);
		expect(result.outputsHashMatches).toBe(true);
	});

	it("supports outputs as Uint8Array and ArrayBuffer", async () => {
		const text = "binary-bytes";
		const manifest = await makeSignedManifest({}, text);
		const resolver: KeyResolver = async () => signingPublicKey;

		const u8 = utf8Bytes(text);
		const r1 = await verify(manifest, { keyResolver: resolver, outputs: u8 });
		expect(r1.verified).toBe(true);
		expect(r1.outputsHashMatches).toBe(true);

		const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
		const r2 = await verify(manifest, { keyResolver: resolver, outputs: ab });
		expect(r2.verified).toBe(true);
		expect(r2.outputsHashMatches).toBe(true);
	});
});

describe("verify() — failure paths", () => {
	it("returns verified=false on schema validation failure", async () => {
		const manifest = await makeSignedManifest({ runId: "wrong" as never });
		const resolver: KeyResolver = async () => signingPublicKey;
		const result = await verify(manifest, { keyResolver: resolver });
		expect(result.verified).toBe(false);
		expect(result.errors[0]).toContain("schema validation failed");
	});

	it("returns verified=false on signature mismatch (tampered body)", async () => {
		const manifest = await makeSignedManifest();
		// Tamper with the score AFTER signing
		manifest.results.score = 0.99;
		const resolver: KeyResolver = async () => signingPublicKey;
		const result = await verify(manifest, { keyResolver: resolver });
		expect(result.verified).toBe(false);
		expect(result.signatureValid).toBe(false);
		expect(result.errors.some((e) => e.includes("signature does not validate"))).toBe(true);
	});

	it("returns verified=false on unknown keyId", async () => {
		const manifest = await makeSignedManifest();
		const resolver: KeyResolver = async () => null;
		const result = await verify(manifest, { keyResolver: resolver });
		expect(result.verified).toBe(false);
		expect(result.errors.some((e) => e.includes("unknown signing keyId"))).toBe(true);
	});

	it("returns verified=false when manifest publicKey lies about itself", async () => {
		const manifest = await makeSignedManifest();
		// Replace the manifest's claimed pubKey with a different valid base64
		const otherKey = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
		manifest.signatures[0].publicKey = bytesToBase64(otherKey);
		const resolver: KeyResolver = async () => signingPublicKey;
		const result = await verify(manifest, { keyResolver: resolver });
		expect(result.verified).toBe(false);
		expect(
			result.errors.some((e) => e.includes("does not match the registry entry"))
		).toBe(true);
	});

	it("returns outputsHashMatches=false on mismatched outputs", async () => {
		const manifest = await makeSignedManifest({}, "real-outputs");
		const resolver: KeyResolver = async () => signingPublicKey;
		const result = await verify(manifest, {
			keyResolver: resolver,
			outputs: "tampered-outputs",
		});
		expect(result.verified).toBe(false);
		expect(result.outputsHashMatches).toBe(false);
		expect(
			result.errors.some((e) => e.includes("outputs hash mismatch"))
		).toBe(true);
	});
});

describe("verify() — well-known fetch path", () => {
	it("uses the supplied fetchImpl to load the registry", async () => {
		const manifest = await makeSignedManifest();
		const registry: WellKnownRegistry = {
			version: "1.0.0",
			platform: "trustbench-divinci",
			keys: [
				{
					keyId: TEST_KEY_ID,
					algorithm: "ed25519",
					publicKey: signingPublicKeyBase64,
					validFrom: "2026-04-26T00:00:00.000Z",
					validUntil: null,
					deprecated: false,
				},
			],
		};
		let calledUrl = "";
		const stubFetch: typeof fetch = async (input) => {
			calledUrl = typeof input === "string" ? input : input.toString();
			return new Response(JSON.stringify(registry), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const result = await verify(manifest, {
			fetchImpl: stubFetch,
			wellKnownUrl: "https://example.test/.well-known/trustbench-keys.json",
		});
		expect(result.verified).toBe(true);
		expect(calledUrl).toBe(
			"https://example.test/.well-known/trustbench-keys.json"
		);
	});

	it("emits a warning when the resolved key is marked deprecated", async () => {
		const manifest = await makeSignedManifest();
		const registry: WellKnownRegistry = {
			version: "1.0.0",
			platform: "trustbench-divinci",
			keys: [
				{
					keyId: TEST_KEY_ID,
					algorithm: "ed25519",
					publicKey: signingPublicKeyBase64,
					validFrom: "2026-04-26T00:00:00.000Z",
					validUntil: null,
					deprecated: true,
				},
			],
		};
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(registry), {
				status: 200,
			});
		const result = await verify(manifest, { fetchImpl: stubFetch });
		expect(result.verified).toBe(true);
		expect(result.warnings.some((w) => w.includes("deprecated"))).toBe(true);
	});

	it("strict mode fails when warnings are present", async () => {
		const manifest = await makeSignedManifest();
		const registry: WellKnownRegistry = {
			version: "1.0.0",
			platform: "trustbench-divinci",
			keys: [
				{
					keyId: TEST_KEY_ID,
					algorithm: "ed25519",
					publicKey: signingPublicKeyBase64,
					validFrom: "2026-04-26T00:00:00.000Z",
					validUntil: null,
					deprecated: true,
				},
			],
		};
		const stubFetch: typeof fetch = async () =>
			new Response(JSON.stringify(registry), { status: 200 });
		const result = await verify(manifest, { fetchImpl: stubFetch, strict: true });
		expect(result.verified).toBe(false);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("throws on a non-OK well-known fetch", async () => {
		const manifest = await makeSignedManifest();
		const stubFetch: typeof fetch = async () =>
			new Response("not found", { status: 404 });
		// verify catches the throw and surfaces it as an error
		const result = await verify(manifest, { fetchImpl: stubFetch });
		expect(result.verified).toBe(false);
		expect(
			result.errors.some((e) => e.includes("failed to resolve signing key"))
		).toBe(true);
	});
});
