import { z } from "zod";

/**
 * Artifact Attestation, v1 — the mirror of the server's
 * `trustbench/artifact/attestation-body.ts`.
 *
 * ## What this document is, and what it is NOT
 *
 * A signed statement that Divinci identifies a named artifact — for example a
 * LarQL vindex — as exactly these files with exactly these SHA-256 digests. It
 * lets someone who received the files through ANY channel (a presigned URL, a
 * mirror, a disk) check they hold the bytes Divinci's measurements refer to,
 * without trusting the channel.
 *
 * ⛔ It says nothing about what the artifact DOES, whether it is fit for any
 * purpose, where it came from before its stated origin, or under what licence
 * it may be used. It is an identity claim about bytes.
 *
 * ## Per-file witness: how strongly each digest is vouched for
 *
 * Two different things can stand behind a digest, and the document says which:
 *
 *   artifact-manifest   the signer hashed the file and it matched the checksum
 *                       the artifact recorded about itself at extraction. The
 *                       signer checked this.
 *   operator-declared   the signer hashed the file but had nothing of the
 *                       artifact's own to check it against, and relies on the
 *                       operator's account (recorded in `note`) of how the file
 *                       was obtained. The signer did NOT check that account.
 *
 * Both are real digests of real bytes. The difference is whether anything
 * independent confirmed those bytes are the artifact rather than a copy of it
 * that had been modified — which, for LarQL vindex b20ff753, is not
 * hypothetical: a copy on disk under that name had two files rewritten after
 * extraction. A verifier warns on `operator-declared` rather than hiding it.
 */

export const ARTIFACT_ATTESTATION_SCHEMA_URL =
	"https://divinci.ai/schemas/artifact-attestation/v1.json";

/** Artifact attestations sign under their own key lineage; see verify-artifact.ts. */
export const ARTIFACT_KEY_ID = /^tba-/;

export const ArtifactSignatureBlock = z.object({
	signer: z.literal("divinci-artifact"),
	keyId: z.string().min(1),
	algorithm: z.literal("ed25519"),
	publicKey: z.string().min(1),
	signature: z.string().min(1),
});

export const FileWitness = z.enum(["artifact-manifest", "operator-declared"]);

export const ArtifactFile = z
	.object({
		/** Relative to the artifact root, forward slashes, no `..` or leading `/`. */
		path: z
			.string()
			.min(1)
			.refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), {
				message: "path must be relative and must not contain '..'",
			}),
		sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
		bytes: z.number().int().nonnegative(),
		witness: FileWitness,
	})
	.passthrough();

export const ArtifactAttestationV1 = z
	.object({
		schema: z.literal(ARTIFACT_ATTESTATION_SCHEMA_URL),
		version: z.literal("1.0.0"),
		attestationId: z.string().min(1),
		issuedAt: z.string().min(1),
		artifact: z
			.object({
				name: z.string().min(1),
				kind: z.string().min(1),
				/** Where the artifact was obtained from, as recorded by the signer. */
				origin: z.string().min(1),
				totalBytes: z.number().int().nonnegative(),
				files: z.array(ArtifactFile).min(1),
				/** The operator's account behind any `operator-declared` witness. */
				note: z.string().nullable(),
			})
			.passthrough(),
		/** Plain statement of what this document does and does not attest. */
		scope: z.string().min(1),
		signatures: z.array(ArtifactSignatureBlock).min(1),
	})
	.passthrough();

export type ArtifactAttestation = z.infer<typeof ArtifactAttestationV1>;
export type ArtifactFileT = z.infer<typeof ArtifactFile>;
