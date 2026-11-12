#!/usr/bin/env node
/**
 * Live smoke test for the deployed docs site.
 *
 *   node scripts/check-live.mjs                       # checks https://sdk.divinci.ai
 *   node scripts/check-live.mjs https://<preview-url> # checks a preview deploy
 *
 * Verifies key routes return 200, redirects land, security headers are
 * present, and head assets (favicon / og-image) resolve. Exits non-zero on
 * any failure, so it can gate a production cutover.
 */
const base = (process.argv[2] ?? "https://sdk.divinci.ai").replace(/\/$/, "");

const PAGES = [
  "/",
  "/getting-started/quickstart",
  "/getting-started/error-handling",
  "/client/overview",
  "/client/chat",
  "/client/streaming",
  "/embed/overview",
  "/embed/reference",
  "/server/overview",
  "/server/rag",
  "/server/red-team",
  "/server/x402",
  "/mcp/overview",
  "/mcp/payments",
  "/cli/overview",
  "/reference/types",
];
// Bare section paths + npm package `homepage` targets must resolve via redirect.
const REDIRECTS = ["/client", "/server", "/mcp", "/embed", "/cli", "/reference"];
const ASSETS = [
  "/favicon.png",
  "/og-image.png",
  "/og/pages/index.png",
  "/og/pages/server/red-team.png",
  "/llms.txt",
  "/client/chat.md",
];
const EXPECTED_HEADERS = ["x-content-type-options", "x-frame-options", "referrer-policy"];

let failures = 0;
const fail = (msg) => { failures++; console.error(`✗ ${msg}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with retry-on-non-200. Cloudflare's edge needs a few seconds to
 * propagate freshly-deployed assets globally, so the instant `wrangler deploy`
 * returns, a just-added route (e.g. /llms.txt, a new page's raw .md) can 404 on
 * the edge node this check happens to hit — then 200 moments later. Without
 * retries the smoke test flaps on every deploy that adds a route. A genuinely
 * broken route still fails, just after exhausting the backoff.
 */
async function status(path, opts = {}) {
  const maxAttempts = 6;
  let res;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(base + path, { redirect: "follow", ...opts });
      if (res.status === 200) return res;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
    }
    if (attempt < maxAttempts) await sleep(attempt * 1500); // 1.5s,3s,…,7.5s
  }
  return res;
}

for (const path of [...PAGES, ...ASSETS]) {
  const res = await status(path);
  if (res.status === 200) console.log(`✓ 200 ${path}`);
  else fail(`${res.status} ${path}`);
}

for (const path of REDIRECTS) {
  const res = await status(path); // follow redirects to the landing page
  if (res.status === 200 && new URL(res.url).pathname !== path + "/") {
    console.log(`✓ redirect ${path} → ${new URL(res.url).pathname}`);
  } else if (res.status === 200) {
    console.log(`✓ 200 ${path}`);
  } else {
    fail(`redirect ${path} ended at ${res.status} ${res.url}`);
  }
}

// Security headers on a representative page.
{
  const res = await status("/client/overview");
  for (const header of EXPECTED_HEADERS) {
    if (res.headers.get(header)) console.log(`✓ header ${header}: ${res.headers.get(header)}`);
    else fail(`missing security header: ${header}`);
  }
}

if (failures) {
  console.error(`\n${failures} failure(s) against ${base}`);
  process.exit(1);
}
console.log(`\nall live checks passed against ${base}`);
