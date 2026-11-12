export { verify, readOutputsCoverage, coverageWarnings } from "./verify.js";
export { verifyErasureReceipt } from "./verify-erasure.js";
export { verifyTimestamp, verifyInclusion, derEcdsaToRaw, TIMESTAMP_SCHEMA } from "./verify-timestamp.js";
export type { TimestampDocument, TimestampVerifyResult, TrustedLogKey } from "./verify-timestamp.js";
export { verifyArtifactAttestation, checkArtifactFiles } from "./verify-artifact.js";

export {
	canonicalJSON,
	manifestBodyForSigning,
	utf8Bytes,
} from "./canonical.js";

export {
	fetchWellKnown,
	makeKeyResolver,
	isKeyDeprecated,
	decodeBase64,
} from "./keys.js";

export {
	TrustRunManifestV1,
	SignatureBlock,
	ProviderId,
	ProviderIdShape,
	PROVIDER_ID_SHAPE,
	KNOWN_PROVIDER_IDS,
	isKnownProviderId,
	ScoreProvenance,
	ScoreSourceKind,
	SHA256_PREFIXED,
	RUN_ID,
	BENCHMARK_ID,
	AUTHOR_ID,
} from "./schema.js";

export {
	ErasureReceiptV1,
	ErasureSignatureBlock,
	ErasureReceiptEdit,
	EditEvidence,
	EditProvenance,
	EditProvenanceKind,
	ERASURE_RECEIPT_SCHEMA_URL,
	ERASURE_KEY_ID,
} from "./erasure-schema.js";

export type {
	ErasureReceipt,
	ErasureReceiptEditT,
	EditProvenanceT,
} from "./erasure-schema.js";

export type { ErasureVerifyResult } from "./verify-erasure.js";

export {
	ArtifactAttestationV1,
	ArtifactSignatureBlock,
	ArtifactFile,
	FileWitness,
	ARTIFACT_ATTESTATION_SCHEMA_URL,
	ARTIFACT_KEY_ID,
} from "./artifact-schema.js";

export type { ArtifactAttestation, ArtifactFileT } from "./artifact-schema.js";

export type { ArtifactVerifyResult, ArtifactFileCheck } from "./verify-artifact.js";

export type {
	TrustRunManifest,
	WellKnownKey,
	WellKnownRegistry,
	KeyResolver,
	VerifyOptions,
	VerifyResult,
	OutputsCoverage,
} from "./types.js";

export { DEFAULT_WELL_KNOWN_URL } from "./types.js";
