import type {
	KeyResolver,
	WellKnownKey,
	WellKnownRegistry,
} from "./types.js";
import { DEFAULT_WELL_KNOWN_URL } from "./types.js";

/**
 * Decode a base64-encoded public key string into raw bytes.
 *
 * Works in browsers (atob) and Node ≥18 (Buffer). The verifier prefers
 * `globalThis.atob` because it's universal; the Node fallback covers
 * environments where atob isn't yet on the global.
 */
export function decodeBase64(s: string): Uint8Array {
	if (typeof globalThis.atob === "function") {
		const bin = globalThis.atob(s);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	// Node fallback (no global atob in Node <16)
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return new Uint8Array(Buffer.from(s, "base64"));
}

/**
 * Fetch and parse the well-known platform key registry.
 *
 * Defaults to https://api.divinci.app/.well-known/trustbench-keys.json
 * (DEFAULT_WELL_KNOWN_URL — see types.ts for why this isn't
 * app.divinci.app). Accepts a custom URL + fetch impl for testing,
 * staging, or restricted environments — e.g.
 * `fetchWellKnown("https://api.stage.divinci.app/.well-known/trustbench-keys.json")`.
 */
export async function fetchWellKnown(
	wellKnownUrl: string = DEFAULT_WELL_KNOWN_URL,
	fetchImpl?: typeof fetch
): Promise<WellKnownRegistry> {
	const f = fetchImpl ?? globalThis.fetch;
	if (typeof f !== "function") {
		throw new Error(
			"trustbench-verifier: no fetch implementation available; pass `fetchImpl` in VerifyOptions"
		);
	}
	const res = await f(wellKnownUrl);
	if (!res.ok) {
		throw new Error(
			`trustbench-verifier: failed to fetch well-known (${res.status} ${res.statusText})`
		);
	}
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(
			`trustbench-verifier: well-known body is not JSON (status ${res.status})`
		);
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!Array.isArray((parsed as { keys?: unknown }).keys)
	) {
		throw new Error(
			"trustbench-verifier: well-known body is missing `keys` array"
		);
	}
	return parsed as WellKnownRegistry;
}

/**
 * Build a KeyResolver from a fetched WellKnownRegistry. Returns null
 * for unknown keyIds; the caller treats that as a verification failure.
 */
export function makeKeyResolver(registry: WellKnownRegistry): KeyResolver {
	const byId = new Map<string, WellKnownKey>();
	for (const k of registry.keys) {
		byId.set(k.keyId, k);
	}
	return async (keyId: string): Promise<Uint8Array | null> => {
		const entry = byId.get(keyId);
		if (!entry) return null;
		return decodeBase64(entry.publicKey);
	};
}

/**
 * Returns true if the given keyId is marked deprecated in the registry.
 */
export function isKeyDeprecated(
	registry: WellKnownRegistry,
	keyId: string
): boolean {
	return registry.keys.some((k: WellKnownKey) => k.keyId === keyId && k.deprecated);
}
