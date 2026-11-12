import { z } from "zod";

/**
 * Erasure Change Receipt, v1 — the mirror of the server's
 * `trustbench/erasure/receipt-body.ts`.
 *
 * ## What this document is, and what it is NOT
 *
 * A signed CHANGELOG of a workspace's model-edit stack: which edits exist,
 * against which model artifact, under which runtime, and what was measured for
 * each. Signing makes that record tamper-evident.
 *
 * ⛔ It is NOT a claim that anything was proven erased. That is a separate
 * Efficacy Receipt comparing two independently verifiable TrustRuns bracketing
 * the edit. Until one exists, `runs` is `null` — present and explicitly null,
 * so its absence cannot be read as the stronger claim being made.
 *
 * ## Absent is never zero
 *
 * Every evidence member is `T | null`. A measurement that was not taken is
 * `null`; a `totalVariation` of 0 is a real result meaning the distribution did
 * not move. Flattening those together is how a number nobody measured comes to
 * be read as a measurement — which has already happened once in this system.
 */

export const ERASURE_RECEIPT_SCHEMA_URL =
	"https://divinci.ai/schemas/erasure-change-receipt/v1.json";

/** Erasure receipts sign under their own key lineage; see verify-erasure.ts. */
export const ERASURE_KEY_ID = /^tbr-/;

export const ErasureSignatureBlock = z.object({
	signer: z.literal("divinci-erasure"),
	keyId: z.string().min(1),
	algorithm: z.literal("ed25519"),
	publicKey: z.string().min(1),
	signature: z.string().min(1),
});

export const EditProvenanceKind = z.enum(["measured", "unmeasured"]);

export const EditProvenance = z
	.object({
		sourceKind: EditProvenanceKind,
		modelInvoked: z.boolean(),
	})
	.passthrough();

export const EditEvidence = z
	.object({
		gate: z
			.object({
				scoreBefore: z.number().nullable(),
				scoreAfter: z.number().nullable(),
			})
			.passthrough()
			.nullable(),
		/** Numeric only — the top-1 token strings name the subject and are sealed. */
		output: z
			.object({
				top1Changed: z.boolean(),
				totalVariation: z.number(),
				k: z.number(),
			})
			.passthrough()
			.nullable(),
		readings: z
			.object({
				k: z.number(),
				measuredAtomically: z.boolean(),
				promptCount: z.number(),
			})
			.passthrough()
			.nullable(),
		/**
		 * Whether the suppression survives being asked a different way.
		 * Always null in v1 — nothing measures it in production yet, and the
		 * field exists so that gap is visible rather than merely missing.
		 */
		survival: z.null(),
	})
	.passthrough();

export const ErasureReceiptEdit = z
	.object({
		seqNo: z.number(),
		op: z.string(),
		status: z.string(),
		kind: z.string().nullable(),
		kindSource: z.enum(["recorded", "derived", "unknown"]),
		/**
		 * Salted digest of the erased triple — never the triple. A data subject
		 * recomputes it to recognise their own erasure; nobody else learns a name.
		 * Null on a record predating subject sealing.
		 */
		subjectFingerprint: z.string().nullable(),
		vindexSha256: z.string(),
		layer: z.number(),
		feature: z.number(),
		alpha: z.number(),
		larqlRuntime: z.string().nullable(),
		committedAt: z.string().nullable(),
		revertedAt: z.string().nullable(),
		evidence: EditEvidence,
		provenance: EditProvenance,
	})
	.passthrough();

/**
 * ⚠️ Every object here is `.passthrough()`, deliberately.
 *
 * Zod's DEFAULT is to strip unknown keys. A verifier that validated with the
 * default and then hashed the parsed result would compute a digest over a
 * DIFFERENT document than the one that was signed, so any receipt carrying a
 * field this version does not know about would fail signature verification —
 * breaking the additive-evolution rule in the forward direction, which is
 * exactly the direction that matters for a published verifier.
 *
 * Passthrough keeps the parsed value honest. `verifyErasureReceipt` belts and
 * braces it by digesting the ORIGINAL input rather than the parsed output.
 */
export const ErasureReceiptV1 = z
	.object({
		schema: z.literal(ERASURE_RECEIPT_SCHEMA_URL),
		version: z.literal("1.0.0"),
		receiptId: z.string().min(1),
		issuedAt: z.string().min(1),
		workspaceId: z.string().min(1),
		model: z.unknown(),
		patchSet: z
			.object({
				sha: z.string(),
				activeCount: z.number(),
				version: z.number().nullable(),
			})
			.passthrough(),
		scope: z.string().min(1),
		kinds: z.unknown(),
		edits: z.array(ErasureReceiptEdit),
		/** The Efficacy Receipt half. Null until a TrustRun records its patch set. */
		runs: z.null(),
		signatures: z.array(ErasureSignatureBlock).min(1),
	})
	.passthrough();

export type ErasureReceipt = z.infer<typeof ErasureReceiptV1>;
export type ErasureReceiptEditT = z.infer<typeof ErasureReceiptEdit>;
export type EditProvenanceT = z.infer<typeof EditProvenance>;
