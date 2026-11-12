# @divinci-ai/trustbench-verifier

Verify TrustBench attested benchmark run manifests. Pure TypeScript, MIT-licensed, no Divinci-internal dependencies — works in browsers, Node ≥18, Cloudflare Workers, and Deno.

## Install

```bash
npm install @divinci-ai/trustbench-verifier
# or
pnpm add @divinci-ai/trustbench-verifier
```

## Quick start

```ts
import { verify } from "@divinci-ai/trustbench-verifier";

// Fetch a signed manifest (from R2, an HTTP endpoint, or a local file)
const manifest = await fetch("https://app.divinci.app/v1/trustbench/runs/tr_x")
  .then(r => r.json());

// Verify it (default: fetches well-known platform keys)
const result = await verify(manifest);

if (result.verified) {
  console.log("Verified by", result.signedBy.keyId);
} else {
  console.error("Failed:", result.errors);
}
```

## Verifying outputs and benchmark content

To check that the outputs file and benchmark spec haven't been tampered with, pass them in:

```ts
const outputs = await fetch(manifest.results.outputsR2Key).then(r => r.text());
const benchmarkContent = await loadBenchmarkSpec(manifest.benchmark.id);

const result = await verify(manifest, {
  outputs,
  benchmarkContent,
});

console.log({
  verified: result.verified,
  signatureValid: result.signatureValid,
  outputsHashMatches: result.outputsHashMatches,
  benchmarkContentHashMatches: result.benchmarkContentHashMatches,
});
```

## Air-gapped / custom key resolution

Don't want to make an outbound HTTPS call to fetch the well-known? Pass a custom resolver:

```ts
const knownKeys = new Map<string, Uint8Array>([
  ["tbp-2026-04-26-001", base64ToBytes(MY_LOCAL_PUB_KEY)],
]);

const result = await verify(manifest, {
  keyResolver: async (keyId) => knownKeys.get(keyId) ?? null,
});
```

## Strict mode

By default, warnings (deprecated key still serving, etc.) don't fail verification. Pass `strict: true` to make them fail:

```ts
const result = await verify(manifest, { strict: true });
```

## What `verify()` checks

A run is `verified: true` only if all of:

1. The manifest passes JSON-Schema-style validation against `TrustRunManifestV1`.
2. The keyId in `signatures[0]` resolves to a known platform public key (from the well-known registry, or the supplied `keyResolver`).
3. The manifest's claimed `publicKey` matches what the registry says — protects against a malicious manifest claiming a different keyId than it was actually signed with.
4. Ed25519-verifying the signature against `sha256(canonicalJSON(body_without_signatures))` succeeds.
5. (When `outputs` is provided) `sha256(outputs)` matches `manifest.results.outputsHash`.
6. (When `benchmarkContent` is provided) `sha256(benchmarkContent)` matches `manifest.benchmark.contentHash`.
7. `results.provenance.outputsR2Key`, when present, matches `results.outputsR2Key` — a signed manifest must not cite evidence other than the artifact it hashes.
8. (When `strict: true`) no warnings present.

The function never throws on a verification failure — it returns a structured `VerifyResult` with errors and warnings. It DOES throw on operational failures (no `crypto.subtle` in the runtime, no `fetch` and no `fetchImpl`, etc.).

## Signed ≠ measured: `result.scoreProvenance`

A valid signature attests that Divinci **signed** the document. It does not
attest that the number inside it was **measured**. Those are different claims,
and until `results.provenance` existed a manifest carried only the first.

`verify()` returns the signed provenance block on `result.scoreProvenance`:

| `sourceKind` | meaning |
|---|---|
| `measured` | the evaluator execution named in `evaluator.invocationId` invoked the model under test and scored its actual replies |
| `republished` | the score was computed by an earlier run (see `upstreamRef`), and this manifest only signs it |
| `stub` | the score is **fabricated**; the model was never called |

`scoreProvenance: null` means the manifest predates the field and therefore
says nothing either way. **Treat `null` as unknown provenance, never as
measured.** Each of `null`, `stub` and `republished` raises a warning, so
`strict: true` refuses all three in one flag:

```ts
const r = await verify(manifest, { strict: true });
if (r.verified && r.scoreProvenance?.sourceKind === "measured") {
  // this number was measured, by the execution the manifest names
}
```

The platform signer refuses to mint a manifest without a provenance block, one
whose declaration contradicts itself (a `stub` claiming it called the model), or
a `stub` under a production key at all. So the guarantee is enforced where
manifests are created; this package is how you check it without trusting us.

## Manifest schema

Documented at: `https://app.divinci.app/.well-known/trustbench/schemas/trustrun-v1.json`

The `TrustRunManifestV1` Zod schema is exported from this package and is the source of truth for the public-facing manifest shape.

## License

MIT.
