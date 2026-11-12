#!/usr/bin/env node
/**
 * Drift-guard for COMPRESSION_STRATEGIES.
 *
 * Asserts the runtime array exported by @divinci-ai/types matches the
 * canonical list maintained alongside @divinci-ai/models. If you change
 * one, change the other AND update both drift-guard tests in the same
 * commit.
 *
 * AS-514 lost this constants extraction TWICE to linter/auto-edit reverts
 * because nothing failed loudly when the export disappeared. This guard
 * replaces "nobody noticed" with a build-script failure.
 */

import { COMPRESSION_STRATEGIES, COMPRESSION_RATIO_MIN, COMPRESSION_RATIO_MAX } from "../dist/rag.js";

const expected = [
  "none",
  "exit",
  "llmlingua2",
  "headroom",
  "recomp-extractive",
  "recomp-abstractive",
  "pisco",
  "clara",
  "core-rag",
];

const actual = [...COMPRESSION_STRATEGIES];

if (actual.length !== expected.length || !actual.every((s, i) => s === expected[i])) {
  console.error("❌ COMPRESSION_STRATEGIES drift detected.");
  console.error("   Expected:", expected);
  console.error("   Actual:  ", actual);
  console.error("");
  console.error("   The canonical list lives in @divinci-ai/models. If this");
  console.error("   change is intentional, update BOTH packages and BOTH");
  console.error("   drift-guards together:");
  console.error("   - workspace/resources/models/src/white-label/RagVector/rag-vector.ts");
  console.error("   - workspace/resources/models/tests/compression-strategies.test.ts");
  console.error("   - workspace/sdk/packages/types/src/rag.ts");
  console.error("   - workspace/sdk/packages/types/scripts/check-compression-strategies.mjs");
  process.exit(1);
}

if (COMPRESSION_RATIO_MIN !== 2 || COMPRESSION_RATIO_MAX !== 128) {
  console.error("❌ Compression ratio bounds drifted.");
  console.error(`   Expected: min=2, max=128`);
  console.error(`   Actual:   min=${COMPRESSION_RATIO_MIN}, max=${COMPRESSION_RATIO_MAX}`);
  process.exit(1);
}

console.log("✅ COMPRESSION_STRATEGIES in sync with @divinci-ai/models canonical list (9 strategies, ratio bounds 2-128).");
