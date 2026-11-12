# @divinci-ai/trustbench-verifier

## 0.9.0

### Minor Changes

- fdafff2: Provider ids are forward compatible: `model.providerId` no longer has to be one this release knows.

  `verify()` accepts any well-shaped provider id (lowercase letters, digits, `.`, `_`, `-`, 1-64 chars, starting with a letter or digit) and runs the signature, canonical-hash and key checks exactly as before. An id missing from `KNOWN_PROVIDER_IDS` adds the warning `unknown provider id '<id>'; verifier may be older than the run`; `strict: true` (CLI `--strict`) turns that warning into a failure. A malformed id is still rejected by the schema, and a tampered manifest still fails its signature.

  Why: a closed enum rejected unknown ids before the signature step, so a stale verifier showed genuinely signed rows (Voyage) as failed. Adding a provider no longer requires releasing a verifier first, though adding it to `KNOWN_PROVIDER_IDS` still silences the warning.

  Types: `TrustRunManifest["model"]["providerId"]` widens from the closed union to `string`. `ProviderId` (the union of known ids) is still exported. New exports: `KNOWN_PROVIDER_IDS`, `ProviderIdShape`, `PROVIDER_ID_SHAPE`, `isKnownProviderId`.

## 0.8.0

### Minor Changes

- [`cf78f67`](https://github.com/Divinci-AI/server/commit/cf78f67ec252a57cf6ec11dd0094613304e839fe) - `"voyage"` is a valid `providerId` in a TrustRun manifest.

  Signed embedding-board runs of Voyage AI models (`voyage/voyage-4-large`, `voyage/voyage-4`, `voyage/voyage-4-lite`), called over Voyage's API, name `voyage` as the provider. It is additive: `TrustRunManifestV1` is otherwise unchanged and every existing manifest still verifies, but verifiers older than this release reject a manifest that names it, so install this version to verify those runs offline.

## 0.7.0

### Minor Changes

- [`6e7cee4`](https://github.com/Divinci-AI/server/commit/6e7cee4096198eaba94c418c63b3b8ccc79e59c9) - `verifyTimestamp()` checks an independent signing time for a TrustRun manifest.

  A manifest's signature proves who signed it, not when: `execution.signedAt` is written by the signer. A `trustbench-timestamp/v1` document, stored beside the manifest and never inside it, carries a transparency-log entry (Sigstore Rekor shape) naming the manifest's SHA-256. `verifyTimestamp(doc, { manifestHash, trustedLogKeys })` checks three things:

  - the entry names this manifest;
  - the log's signed entry timestamp verifies under a log key you chose to trust (ECDSA P-256, via WebCrypto);
  - if an RFC 6962 inclusion proof is present, it verifies.

  It returns `attestedTime`, the log's time rather than the manifest's claim. No new dependency. `TrustRunManifestV1` is unchanged.

  Exercised against a local mock log only. The entry is a Rekor `rekord` over the signed digest (so it names sha256 of the manifest hash); it has not yet been checked against a live Rekor entry.

## 0.6.0

### Minor Changes

- [`ab2a6231ce`](https://github.com/Divinci-AI/server/commit/ab2a6231cebf595a22d77172faecd9b732696d5f) - Accept `typesafe` as a manifest `providerId`.

  TypeSafe's System One models (Jev) are called over TypeSafe's own API, so neither `self-hosted` nor any existing provider describes them honestly. The first board that needs it is the chat-safety classifier board (`notebooks/2026-10-01-classifier-board/`).

  This is additive, but a verifier older than 0.6.0 rejects a manifest that names `typesafe` at schema validation, so install 0.6.0 before verifying those runs.

## 0.5.0

### Minor Changes

- [`ff48b5b`](https://github.com/Divinci-AI/server/commit/ff48b5b08559c0504756878eaeb67f60a38db109) - `verify()` checks a TrustRun signature over the manifest **as received**, and reads coverage from signed republished outputs.

  **Signature check no longer breaks on new fields.** `verify()` used to hash the zod-parsed manifest. Zod strips unknown keys, so a manifest carrying any field this version did not know was hashed as a different document than the one signed, and failed with "Ed25519 signature does not validate". That made it impossible to add a field to the manifest without breaking every installed verifier. The 0.3.0 notes flagged exactly this shape in `verify()`; `verifyErasureReceipt` and `verifyArtifactAttestation` already digest the original input. The schema still validates structure; it no longer decides which bytes are hashed. Tampering with an unknown field after signing still fails.

  **Coverage warnings from `scoredqa-publish/v1.1` outputs.** When `options.outputs` is supplied and its hash matches the manifest, the result carries `outputsCoverage` (expected, scored, missing and filled samples; samples with a retrieval record; samples answered while a retrieval backend had failed; selection mode). Its gaps become warnings, so `strict: true` refuses a run that:

  - was answered while retrieval had failed on some samples (published only with `allowDegradedRetrieval`),
  - filled a sample from an earlier pass than the rest,
  - or is missing samples.

  Older outputs carry no coverage block and produce no warning: absence is not evidence of a gap. New exports: `readOutputsCoverage`, `coverageWarnings`, `OutputsCoverage`.

## 0.4.0

### Minor Changes

- Export the artifact-attestation surface, which has been in the package since 2026-09-17 without a version to carry it.

  `fd54e6638a` added artifact attestations — signing _which bytes_ an artifact is, rather than only which run produced it — and shipped 12 new exports: `ARTIFACT_ATTESTATION_SCHEMA_URL`, `ARTIFACT_KEY_ID`, `ArtifactAttestation`, `ArtifactAttestationV1`, `ArtifactFile`, `ArtifactFileCheck`, `ArtifactFileT`, `ArtifactSignatureBlock`, `ArtifactVerifyResult`, `FileWitness`, `checkArtifactFiles`, `verifyArtifactAttestation`.

  It carried no changeset, so the version stayed 0.3.0 — the same number already on npm. That made two different packages both called 0.3.0: the published one without these exports, and the checkout with them. Nothing consuming `verify()` broke, but the next release would have pinned `@divinci-ai/cli` to a `trustbench-verifier@0.3.0` whose published content does not match the source it was built against.

  `packages/cli/scripts/smoke-test-tarball.sh` refused to pack for exactly this reason ("a workspace dependency's version number is not honest"), which is the check working as intended rather than an obstacle.

  Minor rather than patch: these are additive exports on a 0.x package, and the published 0.3.0 cannot be retroactively corrected — the honest fix is a new version that actually contains them.

## 0.3.0

### Minor Changes

- Adds `verifyErasureReceipt()` — offline verification for signed erasure Change Receipts, the artifact a customer hands a supervisory authority under GDPR Art. 17.

  A Change Receipt is a signed CHANGELOG of a workspace's model-edit stack: which edits exist, against which model artifact, under which runtime, and what was measured for each. It carries a salted fingerprint of each erased record, never the record itself, so a data subject can recompute their own entry while the document names nobody.

  **A pass does not mean anything was proven erased**, and the result type is shaped so you cannot miss that. `carriesEfficacyEvidence` is `false` for every v1 receipt — the before/after measured comparison is a separate artifact that does not exist yet — and `measured` reports how many edits carried an actual measurement out of how many. Both raise warnings, and `strict: true` refuses them in one flag, so a consumer who needs evidence rather than a record can say so.

  Erasure receipts verify under their own key lineage (`tbr-*`). A receipt signed with the TrustRun manifest key (`tbp-*`) is an error, not a warning — the server refuses to mint one, and this refuses to accept one.

  **Also fixes a forward-compatibility trap in the signature path.** Zod strips unknown keys by default, so hashing its parsed output computes a digest over a different document than the one that was signed — meaning any receipt carrying a field the installed verifier version does not know about would fail. `verifyErasureReceipt` digests the original input, and every schema object is `.passthrough()`. Worth knowing that `verify()` for TrustRun manifests still has this shape and is filed separately.

## 0.2.0

### Minor Changes

- [`ac06d95`](https://github.com/Divinci-AI/server/commit/ac06d9555c61ad71390fb42b1c0100a9a571445a) - Adds `results.provenance` — the difference between "Divinci signed this" and "this number was measured".

  A valid Ed25519 signature attests that Divinci signed the document. It never attested that the score inside it came from running the model. On 2026-08-27 that stopped being theoretical: a stub evaluation (score = a byte of `sha256(benchmarkId + ":" + assistantId)`, the model never called) and a real evaluation verified **identically** on two live public URLs — same platform key, `verified: true`, no warnings. The only tell was a marker in the outputs blob, invisible to anyone who verifies the manifest and stops there.

  `verify()` now reports `scoreProvenance`, and warns when a manifest carries none or declares `sourceKind: "stub"`. Both are warnings rather than errors on purpose: a manifest signed before this field existed is legitimately signed, and a manifest that honestly declares itself a stub has a genuinely valid signature. Pass `strict: true` to refuse both in one flag.

  New exports: `ScoreSourceKind` (`measured` | `republished` | `stub`) and `ScoreProvenance`.

  Backward compatible in both directions — old manifests still verify, and consumers who ignore the new field see no change.

### Patch Changes

- [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716) - Point `repository` and `bugs` at github.com/Divinci-AI/sdk, which now exists.

  Seven packages already declared `Divinci-AI/sdk` and three pointed `bugs`
  there, but the repository had never been created — so ten fields across the
  published SDK linked to a 404, and npm renders `repository` as the
  "Repository" link on every package page. `cli` named `Divinci-AI/server`
  instead, which is private and therefore 404s for anonymous visitors just the
  same.

  The new repo is the public home for the SDK: issues, changelogs, and an
  explicit statement that the source is not public rather than an implication
  that it is.

  `repository.directory` is dropped rather than corrected. It pointed at
  `packages/<name>` (and, for cli, `workspace/sdk/packages/cli` — the two
  disagreed), and the public repo contains no package source, so any
  subdirectory pointer would name a path that does not exist there.

  `robot-avatar` also gains `license: MIT` and a LICENSE file. It had none, which
  means it was published to a public registry as all-rights-reserved — nobody
  could legally use it. MIT matches all seven sibling packages.

  `extension-bridge` is included because it is published (0.1.0 is live on npm)
  and had no `repository`, `bugs` or `homepage` at all. It was missed when the
  other eight were surveyed; the guard that ships with this change is what
  found it.

## 0.1.1

### Patch Changes

- [`300c9e4`](https://github.com/Divinci-AI/server/commit/300c9e4b28093d2396e65ecd5e2ebf755b974749) - Point `repository` and `bugs` at github.com/Divinci-AI/sdk, which now exists.

  Seven packages already declared `Divinci-AI/sdk` and three pointed `bugs`
  there, but the repository had never been created — so ten fields across the
  published SDK linked to a 404, and npm renders `repository` as the
  "Repository" link on every package page. `cli` named `Divinci-AI/server`
  instead, which is private and therefore 404s for anonymous visitors just the
  same.

  The new repo is the public home for the SDK: issues, changelogs, and an
  explicit statement that the source is not public rather than an implication
  that it is.

  `repository.directory` is dropped rather than corrected. It pointed at
  `packages/<name>` (and, for cli, `workspace/sdk/packages/cli` — the two
  disagreed), and the public repo contains no package source, so any
  subdirectory pointer would name a path that does not exist there.

  `robot-avatar` also gains `license: MIT` and a LICENSE file. It had none, which
  means it was published to a public registry as all-rights-reserved — nobody
  could legally use it. MIT matches all seven sibling packages.

  `extension-bridge` is included because it is published (0.1.0 is live on npm)
  and had no `repository`, `bugs` or `homepage` at all. It was missed when the
  other eight were surveyed; the guard that ships with this change is what
  found it.
