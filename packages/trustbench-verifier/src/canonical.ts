/**
 * Canonical JSON encoding for TrustBench manifest signing/verification.
 *
 * Produces deterministic byte output for any JSON value:
 * - Object keys sorted lexicographically at every level
 * - No whitespace
 * - Negative zero normalized to zero
 * - NaN, Infinity, and `undefined` rejected
 * - Strings encoded via JSON.stringify (RFC 8259 escapes)
 *
 * This is the same algorithm implemented server-side at
 * `@divinci-ai/server-resources/trustbench/manifest/canonical`. The two
 * implementations MUST stay byte-equivalent — see the parity tests in
 * tests/canonical.test.ts.
 */

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

function canonicalNumber(n: number): string {
	if (!Number.isFinite(n)) {
		throw new Error(
			`canonicalJSON: non-finite numbers are not allowed (got ${String(n)})`
		);
	}
	if (Object.is(n, -0)) return "0";
	if (Number.isInteger(n) && Math.abs(n) < 1e21) {
		return n.toFixed(0);
	}
	return String(n);
}

function canonicalString(s: string): string {
	return JSON.stringify(s);
}

function canonicalize(value: JsonValue): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return canonicalNumber(value);
	if (typeof value === "string") return canonicalString(value);

	if (Array.isArray(value)) {
		const parts = value.map((item) => canonicalize(item));
		return "[" + parts.join(",") + "]";
	}

	if (typeof value === "object") {
		const keys = Object.keys(value).sort();
		const parts = keys.map((k) => {
			const v = value[k];
			if (v === undefined) {
				throw new Error(
					`canonicalJSON: undefined value at key ${JSON.stringify(k)}`
				);
			}
			return canonicalString(k) + ":" + canonicalize(v);
		});
		return "{" + parts.join(",") + "}";
	}

	throw new Error(
		`canonicalJSON: unsupported value type ${typeof value}`
	);
}

export function canonicalJSON(value: unknown): string {
	if (value === undefined) {
		throw new Error("canonicalJSON: top-level undefined is not allowed");
	}
	return canonicalize(value as JsonValue);
}

export function manifestBodyForSigning<
	T extends { signatures?: unknown }
>(manifest: T): Omit<T, "signatures"> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { signatures: _omit, ...body } = manifest;
	return body;
}

/**
 * UTF-8 encode a string for hashing/signing. Works in browsers, Node 18+,
 * Workers, and Deno.
 */
export function utf8Bytes(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}
