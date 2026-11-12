#!/usr/bin/env bash
# smoke-test-tarball.sh — prove the PACKED tarball works for a stranger.
#
# A library's smoke test cannot be `--version` and `--help`; the thing that
# matters is whether someone who runs `npm i @divinci-ai/trustbench-verifier`
# can actually verify one of our attestations. So this installs the tarball
# into a clean project with no repo on the path and puts a real signed receipt
# through it, checking BOTH that a good one passes and a tampered one fails —
# a verifier that returns true for everything passes a one-sided test.
#
# ⚠️ Deliberately does NOT run `pnpm`. Any pnpm invocation under workspace/sdk
#    triggers an install that drops the lockfile's security `overrides:` block.
#    Build with ./node_modules/.bin/tsc and pack with npm.
#
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PACKAGE_DIR"

NAME="$(node -e "console.log(require('./package.json').name)")"
VERSION="$(node -e "console.log(require('./package.json').version)")"
echo "-> Smoke-testing $NAME@$VERSION"

echo "-> Building with the package-local tsc"
rm -rf dist tsconfig.tsbuildinfo
./node_modules/.bin/tsc

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "-> Packing"
PACKED="$(npm pack --pack-destination "$WORK" --silent | tail -1)"
TARBALL="$WORK/$PACKED"
[ -f "$TARBALL" ] || { echo "FAIL: npm pack produced no tarball"; exit 1; }

echo "-> Installing into a clean project (no repo on the path)"
PROJECT="$WORK/consumer"
mkdir -p "$PROJECT"
cd "$PROJECT"
npm init -y >/dev/null
npm install "$TARBALL" --silent --no-audit --no-fund >/dev/null

echo "-> Verifying a real signed receipt through the INSTALLED package"
cat > check.mjs <<'JS'
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { verifyErasureReceipt, canonicalJSON, manifestBodyForSigning, ERASURE_RECEIPT_SCHEMA_URL }
  from "@divinci-ai/trustbench-verifier";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pub = Buffer.from(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const keyResolver = async () => new Uint8Array(pub);

const body = {
  schema: ERASURE_RECEIPT_SCHEMA_URL, version: "1.0.0",
  receiptId: "erc_smoke", issuedAt: "2026-09-16T00:00:00.000Z",
  workspaceId: "wl-smoke", model: { id: "gemma-4-E2B" },
  patchSet: { sha: "deadbeef", activeCount: 1, version: 1 },
  scope: "scope statement", kinds: {},
  edits: [{
    seqNo: 1, op: "DELETE", status: "COMMITTED", kind: "ffn_delete", kindSource: "recorded",
    subjectFingerprint: "f00dcafe1234567890abcdef00000000", vindexSha256: "b20ff753",
    layer: 14, feature: 2113, alpha: -1, larqlRuntime: "rt", committedAt: null, revertedAt: null,
    evidence: {
      gate: { scoreBefore: 0.8, scoreAfter: 0.0 },
      output: { top1Changed: true, totalVariation: 0.6, k: 10 },
      readings: { k: 10, measuredAtomically: true, promptCount: 1 },
      survival: null,
    },
    provenance: { sourceKind: "measured", modelInvoked: true },
  }],
  runs: null,
};

const digest = createHash("sha256").update(canonicalJSON(manifestBodyForSigning(body))).digest();
const signed = { ...body, signatures: [{
  signer: "divinci-erasure", keyId: "tbr-staging-001", algorithm: "ed25519",
  publicKey: pub.toString("base64"), signature: sign(null, digest, privateKey).toString("base64"),
}]};

const ok = await verifyErasureReceipt(signed, { keyResolver });
if (!ok.verified) { console.error("FAIL: a VALID receipt failed:", ok.errors); process.exit(1); }
if (ok.carriesEfficacyEvidence !== false) { console.error("FAIL: v1 must not claim efficacy evidence"); process.exit(1); }

// The other side: a verifier that says yes to everything passes the test above.
const tampered = structuredClone(signed);
tampered.edits[0].evidence.output.totalVariation = 0.99;
const bad = await verifyErasureReceipt(tampered, { keyResolver });
if (bad.verified) { console.error("FAIL: a TAMPERED receipt verified"); process.exit(1); }

console.log("   ok: valid receipt verifies; tampered receipt is refused");
JS
node check.mjs

echo
echo "PASS: $NAME@$VERSION tarball is good"
