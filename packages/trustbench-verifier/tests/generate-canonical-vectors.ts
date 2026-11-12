/**
 * Regenerates `canonical-vectors.json`, the SHARED golden-vector fixture that
 * the TrustBench canonical encoders (this verifier package, the server-resources
 * mirror, and the Python eval-harness) are all tested against.
 *
 * The expected `canonical` bytes are produced by the REFERENCE implementation
 * in this package's `src/canonical.ts` (which implements RFC-8785 / JCS number
 * formatting + UTF-16 key ordering). Inputs are defined as JS values and carried
 * to the other implementations as embedded JSON in the fixture — every input
 * here is chosen to survive a JSON round-trip identically on both V8 and
 * CPython (fractional/scientific floats + key ordering), so the embedded-JSON
 * carrier is lossless for these cases.
 *
 * Run:  node tests/generate-canonical-vectors.ts > tests/canonical-vectors.json
 * (Node >= 22.14 strips the TS types natively.) This is a MANUAL maintenance
 * tool — the committed JSON is the source of truth that CI asserts against.
 */
import { canonicalJSON } from "../src/canonical.ts";

const cases: Array<{ name: string; input: unknown }> = [
	// --- structural (overlaps existing inline tests; kept for cross-impl proof) ---
	{ name: "sorts object keys", input: { b: 1, a: 2 } },
	{ name: "sorts nested object keys", input: { b: { y: 1, x: 2 }, a: 3 } },
	{ name: "preserves array order", input: [3, 1, 2] },
	{ name: "no whitespace mixed", input: { a: 1, b: [1, 2, 3] } },
	{ name: "null and booleans", input: { a: null, b: true, c: false } },
	{ name: "unicode strings (BMP)", input: { s: "café 你好" } },
	{ name: "string escapes", input: { s: 'a "b" c' } },
	{ name: "integers", input: { n: 42 } },
	{ name: "common score fraction", input: { score: 0.842 } },
	{ name: "half", input: { e: 1.5 } },

	// --- B1 number-formatting edge cases (repr vs String divergence) ---
	{ name: "sci small 1e-7", input: { n: 1e-7 } },
	{ name: "sci small 2.5e-8", input: { n: 2.5e-8 } },
	{ name: "boundary 1e-6 -> decimal", input: { n: 1e-6 } },
	{ name: "boundary 1e-5 -> decimal", input: { n: 1e-5 } },
	{ name: "tiny 1.23e-10", input: { n: 1.23e-10 } },
	{ name: "large 1e21 -> sci", input: { n: 1e21 } },
	{ name: "large 1e22 -> sci", input: { n: 1e22 } },
	{ name: "large fractional 1.5e22", input: { n: 1.5e22 } },
	{ name: "negative fractional", input: { n: -0.0001 } },
	{ name: "negative sci", input: { n: -3.2e-9 } },

	// --- B1 UTF-16 key-ordering edge cases (codepoint vs code-unit divergence) ---
	// 😀 = U+1F600 (surrogate pair D83D DE00); JS sorts it BEFORE BMP chars >= 0xE000.
	{ name: "astral key before high-BMP digraph", input: { "\u{1F600}": 1, "ﬀ": 2 } },
	{ name: "astral key before private-use BMP", input: { "": 1, "\u{1F600}": 2 } },
	{ name: "astral mixed with ascii", input: { z: 1, "\u{1F600}": 2, a: 3 } },
	{ name: "two astral keys ordered", input: { "\u{1F680}": 1, "\u{1F600}": 2 } },
];

const vectors = cases.map((c) => ({
	name: c.name,
	input: c.input,
	canonical: canonicalJSON(c.input),
}));

const doc = {
	_comment:
		"SHARED golden vectors for the TrustBench canonical-JSON encoder. Asserted against ALL THREE implementations (TS verifier, TS server-resources, Python eval-harness). Do NOT hand-edit a single encoder's expectation — regenerate via tests/generate-canonical-vectors.ts and keep all three green. See B1 audit (repr-vs-String float formatting + codepoint-vs-UTF16 key sort).",
	vectors,
};

process.stdout.write(JSON.stringify(doc, null, "\t") + "\n");
