/**
 * Vitest setup for MCP package
 *
 * Provides crypto polyfill for Node.js environment
 */

import { Crypto } from "@peculiar/webcrypto";

// Polyfill crypto.subtle for Node.js
if (typeof globalThis.crypto === "undefined") {
  const crypto = new Crypto();
  Object.defineProperty(globalThis, "crypto", {
    value: crypto,
    writable: true,
    configurable: true,
  });
} else if (typeof globalThis.crypto.subtle === "undefined") {
  const crypto = new Crypto();
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: crypto.subtle,
    writable: true,
    configurable: true,
  });
}

// Polyfill btoa for Node.js
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
}

// Polyfill atob for Node.js
if (typeof globalThis.atob === "undefined") {
  globalThis.atob = (str: string) => Buffer.from(str, "base64").toString("binary");
}
