import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
	canonicalJSON,
	manifestBodyForSigning,
} from "../src/canonical";

interface CanonicalVector {
	name: string;
	input: unknown;
	canonical: string;
}

// Shared golden-vector fixture. This package's encoder is the REFERENCE, but
// the same file is asserted against the server-resources mirror and the Python
// eval-harness encoder, so it is the single source of truth for cross-impl
// parity. Regenerate via tests/generate-canonical-vectors.ts.
const canonicalVectors: CanonicalVector[] = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("./canonical-vectors.json", import.meta.url)),
		"utf-8"
	)
).vectors;

describe("canonicalJSON (verifier package)", () => {
	it("sorts keys lexicographically at every level", () => {
		const out = canonicalJSON({ b: { y: 1, x: 2 }, a: 3 });
		expect(out).toBe('{"a":3,"b":{"x":2,"y":1}}');
	});

	it("emits no whitespace", () => {
		const out = canonicalJSON({ a: 1, b: [1, 2, 3] });
		expect(out).not.toMatch(/\s/);
	});

	it("normalizes negative zero", () => {
		expect(canonicalJSON({ n: -0 })).toBe('{"n":0}');
	});

	it("rejects NaN, Infinity, undefined", () => {
		expect(() => canonicalJSON({ n: NaN })).toThrow();
		expect(() => canonicalJSON({ n: Infinity })).toThrow();
		expect(() =>
			canonicalJSON({ a: undefined } as unknown as Record<string, unknown>)
		).toThrow();
		expect(() => canonicalJSON(undefined)).toThrow();
	});

	it("produces identical output regardless of declaration order", () => {
		const a = { foo: 1, bar: 2, baz: { z: 9, a: 8 } };
		const b = { baz: { a: 8, z: 9 }, bar: 2, foo: 1 };
		expect(canonicalJSON(a)).toBe(canonicalJSON(b));
	});

	it("handles unicode strings", () => {
		expect(canonicalJSON({ s: "café 你好" })).toBe('{"s":"café 你好"}');
	});

	it("supports null, booleans, integers, fractions", () => {
		expect(canonicalJSON({ a: null, b: true, c: false, d: 42, e: 1.5 })).toBe(
			'{"a":null,"b":true,"c":false,"d":42,"e":1.5}'
		);
	});

	describe("shared golden vectors (cross-impl parity)", () => {
		it.each(canonicalVectors.map((v) => [v.name, v] as const))(
			"%s",
			(_name, v) => {
				expect(canonicalJSON(v.input)).toBe(v.canonical);
			}
		);
	});
});

describe("manifestBodyForSigning", () => {
	it("strips signatures field", () => {
		const m = {
			version: "1.0.0",
			runId: "tr_x",
			signatures: [{ keyId: "k1" }],
		};
		const body = manifestBodyForSigning(m);
		expect("signatures" in body).toBe(false);
		expect(body).toEqual({ version: "1.0.0", runId: "tr_x" });
	});

	it("does not mutate the input manifest", () => {
		const m = {
			version: "1.0.0",
			signatures: [{ keyId: "k1" }],
		};
		manifestBodyForSigning(m);
		expect(m.signatures).toEqual([{ keyId: "k1" }]);
	});
});
