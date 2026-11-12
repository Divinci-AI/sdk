import { z } from "zod";

/**
 * TrustBench Run Manifest schema, version 1.0.0.
 *
 * This schema is the public contract for verifiers. It MUST stay
 * byte-compatible with the server-side schema at
 * `@divinci-ai/server-resources/trustbench/manifest/schema`. Any change
 * here is a public API change.
 */

export const SHA256_PREFIXED = /^sha256:[a-f0-9]{64}$/;
export const RUN_ID = /^tr_[0-9A-HJKMNP-TV-Z]{26}$/;
export const BENCHMARK_ID = /^bm_[0-9A-HJKMNP-TV-Z]{26}$/;
export const AUTHOR_ID = /^ba_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Provider ids this verifier release KNOWS. Not a gate.
 *
 * The signed manifest is validated against `ProviderIdShape` (below), so a
 * provider added after this release still verifies: the signature, canonical
 * hash and key checks run exactly as for a known id, and `verify()` adds a
 * warning (never an error) saying the id is unknown to this version. A closed
 * enum here rejected unknown ids BEFORE the signature step, so a stale verifier
 * showed genuinely signed Voyage rows as failed.
 *
 * The server-side writer stays a closed enum (it must only mint known
 * providers). Keep this list a SUPERSET of that one; a guard test in
 * server-resources enforces it. Extra values here are fine.
 */
export const KNOWN_PROVIDER_IDS = [
	"anthropic",
	"openai",
	"google",
	"xai",
	"cohere",
	"mistral",
	"together",
	"modal",
	"replicate",
	"fireworks",
	"cloudflare-workers-ai",
	"self-hosted",
	// TypeSafe System One models (Jev), called over TypeSafe's own API. Additive:
	// verifiers older than 0.6.0 reject a manifest naming it, so publish the verifier first.
	"typesafe",
	// Voyage AI embedders (voyage/<model>), called over Voyage's public API. Additive:
	// verifiers older than the release that adds it reject a manifest naming it, so
	// publish the verifier before a Voyage row goes public.
	"voyage",
] as const;

export const ProviderId = z.enum(KNOWN_PROVIDER_IDS);
/** The providers this release knows. A manifest's `model.providerId` is typed `string`. */
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * What a manifest's `model.providerId` must look like: lowercase letters,
 * digits, `.`, `_`, `-`, starting with a letter or digit, 1-64 chars.
 * Deliberately loose on membership, strict on shape (the value is echoed in a
 * warning, so it must not carry control characters or markup).
 */
export const PROVIDER_ID_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const ProviderIdShape = z.string().regex(PROVIDER_ID_SHAPE);

export function isKnownProviderId(id: string): id is ProviderId {
	return (KNOWN_PROVIDER_IDS as readonly string[]).includes(id);
}

export const SignatureBlock = z.object({
	signer: z.literal("trustbench-platform"),
	keyId: z.string().min(1),
	algorithm: z.literal("ed25519"),
	publicKey: z.string().min(1),
	signature: z.string().min(1),
});
export type SignatureBlock = z.infer<typeof SignatureBlock>;

/**
 * Where a score came from. Mirror of the server-side schema; see
 * @divinci-ai/server-resources/trustbench/manifest/schema.ts for the
 * canonical definition + rationale.
 *
 *   measured    — this evaluator execution invoked the model under test.
 *   republished — the score was computed elsewhere and only signed here.
 *   stub        — the score is FABRICATED; the model was never called.
 *
 * A valid signature attests that Divinci signed the document, not that the
 * number inside it was measured. This field is what carries that difference
 * inside the signed body, so a verifier can tell them apart without trusting
 * Divinci and without fetching the outputs blob.
 */
export const ScoreSourceKind = z.enum(["measured", "republished", "stub"]);
export type ScoreSourceKind = z.infer<typeof ScoreSourceKind>;

/**
 * Signed attestation of where `results.score` came from. OPTIONAL to parse
 * (manifests signed before this field existed must stay verifiable),
 * REQUIRED to mint. Verifiers MUST NOT reject a manifest that omits it at
 * v1.0.0 — `verify()` warns instead, and the warning fails under `strict`.
 */
export const ScoreProvenance = z
	.object({
		sourceKind: ScoreSourceKind,
		/** Did THIS evaluator execution invoke the model under test? */
		modelInvoked: z.boolean(),
		evaluator: z.object({
			name: z.string().min(1),
			version: z.string().min(1),
			/** Identifies the execution, not the TrustRun record. */
			invocationId: z.string().min(1),
		}),
		/** MUST equal results.outputsR2Key; the signer refuses a mismatch. */
		outputsR2Key: z.string().min(1),
		/** For `republished`: where the score was originally computed. */
		upstreamRef: z.string().min(1).optional(),
	})
	.optional();
export type ScoreProvenance = NonNullable<z.infer<typeof ScoreProvenance>>;

export const TrustRunManifestV1 = z.object({
	$schema: z.literal(
		"https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json"
	),
	version: z.literal("1.0.0"),
	runId: z.string().regex(RUN_ID),
	createdAt: z.string().datetime(),
	completedAt: z.string().datetime(),

	benchmark: z.object({
		id: z.string().regex(BENCHMARK_ID),
		slug: z.string().min(1),
		version: z.string().min(1),
		contentHash: z.string().regex(SHA256_PREFIXED),
		authorId: z.string().regex(AUTHOR_ID),
		authorSignature: z.string().min(1),
	}),

	model: z.object({
		assistantId: z.string().min(1),
		providerId: ProviderIdShape,
		modelId: z.string().min(1),
		modelVersion: z.string().optional(),
		configHash: z.string().regex(SHA256_PREFIXED),
		/**
		 * Optional FK to a Divinci ReleaseSnapshot (24-char ObjectId
		 * hex). When set, points at an atomically-frozen release
		 * config + pinned RagVectorVersion ids that a verifier can
		 * fetch via app.divinci.app/.well-known/trustbench/snapshots/
		 * to replay the run against the EXACT release state. Optional
		 * at v1.0.0 (additive backward-compat). Keep in lockstep with
		 * @divinci-ai/server-resources/trustbench/manifest/schema.ts.
		 */
		releaseSnapshotId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
	}),

	harness: z.object({
		/**
		 * Which harness actually ran. Was `z.literal("inspect_ai")`, which
		 * forced a shim-produced score to claim the Inspect framework.
		 * Widened to an enum so a shim can identify itself; additive, every
		 * manifest already published says "inspect_ai" and still validates.
		 */
		name: z.enum(["inspect_ai", "divinci-arena-shim"]),
		version: z.string().min(1),
		/**
		 * OPTIONAL, deliberately. It was required, and the one caller with no
		 * digest to give satisfied it with `sha256:0…0` — a value that passes
		 * the regex and means nothing. Absence is legible; a null-shaped
		 * digest is not. Keep in lockstep with
		 * @divinci-ai/server-resources/trustbench/manifest/schema.ts.
		 */
		imageDigest: z.string().regex(SHA256_PREFIXED).optional(),
		configHash: z.string().regex(SHA256_PREFIXED),
	}),

	execution: z.object({
		tier: z.literal("v1-signed-logs"),
		platform: z.literal("trustbench-divinci"),
		region: z.string().min(1),
		durationMs: z.number().int().nonnegative(),
		signedAt: z.string().datetime(),
	}),

	results: z.object({
		score: z.number(),
		metric: z.string().min(1),
		range: z
			.object({
				min: z.number(),
				max: z.number(),
			})
			.refine((r) => r.min <= r.max, {
				message: "results.range.min must be ≤ results.range.max",
			}),
		outputsR2Key: z.string().min(1),
		outputsHash: z.string().regex(SHA256_PREFIXED),
		sampleCount: z.number().int().positive(),

		// R1 — provenance inside the signed manifest. Optional to parse,
		// required to mint. See ScoreProvenance above.
		provenance: ScoreProvenance,
	}),

	// #204 — TrustRun manifest reproducibility extension. Optional at v1.0.0
	// (additive backward-compatible). Mirror of the server-side schema; see
	// @divinci-ai/server-resources/trustbench/manifest/schema.ts for the
	// canonical definition + rationale. Verifiers MUST NOT reject manifests
	// that omit this field at v1.0.0.
	executionContext: z
		.object({
			randomSeed: z.number().int().optional(),
			temperature: z.number().min(0).max(2).optional(),
			topP: z.number().min(0).max(1).optional(),
			topK: z.number().int().nonnegative().optional(),
			maxTokens: z.number().int().positive().optional(),
			numTrials: z.number().int().positive().optional(),
			timeoutMs: z.number().int().positive().optional(),
			concurrency: z.number().int().positive().optional(),
			systemPromptHash: z.string().regex(SHA256_PREFIXED).optional(),
			harnessSpecific: z.record(z.unknown()).optional(),
		})
		.optional(),

	signatures: z.array(SignatureBlock).min(1),
});

export type TrustRunManifest = z.infer<typeof TrustRunManifestV1>;
