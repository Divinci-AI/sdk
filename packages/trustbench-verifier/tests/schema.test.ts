import { describe, it, expect } from "vitest";
import { TrustRunManifestV1 } from "../src/schema";
import type { TrustRunManifest } from "../src/schema";

const VALID: TrustRunManifest = {
	$schema:
		"https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json",
	version: "1.0.0",
	runId: "tr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
	createdAt: "2026-04-26T10:00:00.000Z",
	completedAt: "2026-04-26T10:01:23.000Z",
	benchmark: {
		id: "bm_01HZZZZZZZZZZZZZZZZZZZZZZZ",
		slug: "divinci-general-helpfulness-v1",
		version: "1.0.0",
		contentHash:
			"sha256:0000000000000000000000000000000000000000000000000000000000000000",
		authorId: "ba_01HZZZZZZZZZZZZZZZZZZZZZZZ",
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
		durationMs: 83000,
		signedAt: "2026-04-26T10:01:24.000Z",
	},
	results: {
		score: 0.842,
		metric: "accuracy",
		range: { min: 0, max: 1 },
		outputsR2Key: "trustbench/runs/tr_01HZZZZZZZZZZZZZZZZZZZZZZZ/outputs.json",
		outputsHash:
			"sha256:4444444444444444444444444444444444444444444444444444444444444444",
		sampleCount: 100,
	},
	signatures: [
		{
			signer: "trustbench-platform",
			keyId: "tbp-2026-04-26-001",
			algorithm: "ed25519",
			publicKey: "base64pubkey",
			signature: "base64sig",
		},
	],
};

describe("TrustRunManifestV1 (verifier package)", () => {
	it("accepts a fully populated valid manifest", () => {
		expect(TrustRunManifestV1.safeParse(VALID).success).toBe(true);
	});

	it("rejects wrong $schema URL", () => {
		expect(
			TrustRunManifestV1.safeParse({ ...VALID, $schema: "https://wrong" }).success
		).toBe(false);
	});

	it("rejects wrong version literal", () => {
		expect(TrustRunManifestV1.safeParse({ ...VALID, version: "2.0.0" }).success).toBe(false);
	});

	it("rejects bad runId / benchmarkId / authorId formats", () => {
		expect(
			TrustRunManifestV1.safeParse({ ...VALID, runId: "01HZZZ" }).success
		).toBe(false);
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				benchmark: { ...VALID.benchmark, id: "wrong" },
			}).success
		).toBe(false);
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				benchmark: { ...VALID.benchmark, authorId: "wrong" },
			}).success
		).toBe(false);
	});

	it("rejects bad sha256 prefix on hash fields", () => {
		const bad = "0000000000000000000000000000000000000000000000000000000000000000";
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				benchmark: { ...VALID.benchmark, contentHash: bad },
			}).success
		).toBe(false);
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				model: { ...VALID.model, configHash: bad },
			}).success
		).toBe(false);
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				results: { ...VALID.results, outputsHash: bad },
			}).success
		).toBe(false);
	});

	it("rejects a malformed provider id (shape, not membership)", () => {
		for (const bad of ["", "Anthropic", "has space", "semi;colon", "-leading", "a".repeat(65), "<b>x</b>"]) {
			expect(
				TrustRunManifestV1.safeParse({
					...VALID,
					model: { ...VALID.model, providerId: bad },
				}).success,
				JSON.stringify(bad)
			).toBe(false);
		}
	});

	it("accepts a well-shaped provider id this release does not know (forward compat)", () => {
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				model: { ...VALID.model, providerId: "some-future.provider_2" },
			}).success
		).toBe(true);
	});

	it("accepts typesafe as a provider (Jev runs over TypeSafe's own API)", () => {
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				model: { ...VALID.model, providerId: "typesafe", modelId: "jev-latest" },
			}).success
		).toBe(true);
	});

	it("rejects results.range with min > max", () => {
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				results: { ...VALID.results, range: { min: 1, max: 0 } },
			}).success
		).toBe(false);
	});

	it("rejects empty signatures array", () => {
		expect(
			TrustRunManifestV1.safeParse({ ...VALID, signatures: [] }).success
		).toBe(false);
	});

	it("rejects non-ed25519 algorithm in signature block", () => {
		expect(
			TrustRunManifestV1.safeParse({
				...VALID,
				signatures: [
					{ ...VALID.signatures[0], algorithm: "ecdsa" as never },
				],
			}).success
		).toBe(false);
	});

	// #204 — executionContext is optional and additive at v1.0.0.
	it("accepts manifest WITHOUT executionContext (backward compat)", () => {
		// VALID has no executionContext — verify this is the baseline.
		expect("executionContext" in VALID).toBe(false);
		expect(TrustRunManifestV1.safeParse(VALID).success).toBe(true);
	});

	it("accepts manifest WITH a fully populated executionContext", () => {
		const withCtx = {
			...VALID,
			executionContext: {
				randomSeed: 42,
				temperature: 0,
				topP: 1,
				topK: 0,
				maxTokens: 4096,
				numTrials: 1,
				timeoutMs: 60000,
				concurrency: 8,
				systemPromptHash:
					"sha256:5555555555555555555555555555555555555555555555555555555555555555",
				harnessSpecific: { inspectVersion: "0.3.0", solver: "default" },
			},
		};
		expect(TrustRunManifestV1.safeParse(withCtx).success).toBe(true);
	});

	it("accepts manifest with a partial executionContext (only some fields set)", () => {
		const withPartial = {
			...VALID,
			executionContext: { randomSeed: 7, temperature: 0.7 },
		};
		expect(TrustRunManifestV1.safeParse(withPartial).success).toBe(true);
	});

	it("rejects executionContext.temperature outside [0, 2]", () => {
		const bad = {
			...VALID,
			executionContext: { temperature: 2.5 },
		};
		expect(TrustRunManifestV1.safeParse(bad).success).toBe(false);
	});

	it("rejects executionContext.systemPromptHash without sha256: prefix", () => {
		const bad = {
			...VALID,
			executionContext: {
				systemPromptHash:
					"5555555555555555555555555555555555555555555555555555555555555555",
			},
		};
		expect(TrustRunManifestV1.safeParse(bad).success).toBe(false);
	});
});
