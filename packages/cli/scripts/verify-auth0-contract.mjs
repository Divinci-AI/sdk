#!/usr/bin/env node
// Verify the CLI's pinned Auth0 contract against what the servers ACTUALLY
// validate (Infisical AUTH0_AUDIENCE / AUTH0_BASE_URL, path /).
//
// The unit test (tests/unit/auth/auth0-contract.test.ts) proves src/auth/oauth.ts
// matches src/auth/auth0-contract.lock.json. It cannot prove the LOCK matches
// reality — both halves could be wrong together, which is exactly the state the
// CLI shipped in until 0.2.10. This closes that half, and needs credentials, so
// it lives here rather than in the always-on test suite.
//
//   node scripts/verify-auth0-contract.mjs
//
// Exit codes: 0 = every measurable environment agrees (or none was measurable),
// 1 = a real mismatch. An environment that cannot be read is reported as
// SKIPPED and never silently counted as agreement.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const lock = JSON.parse(readFileSync(path.join(here, "../src/auth/auth0-contract.lock.json"), "utf8"));

/** Set once we detect an expired CLI session, so the hint prints only once. */
let loginExpired = false;

function infisicalGet(key, env, workspaceId) {
  try {
    return execFileSync(
      "infisical",
      ["secrets", "get", key, "--projectId", workspaceId, "--env", env, "--path", "/", "--plain"],
      // stdin from /dev/null: with an expired session the CLI drops into an
      // INTERACTIVE login picker and hangs a non-TTY caller forever. Closing
      // stdin makes it fail fast instead. Capture stderr so we can tell an
      // expired session from a genuine read failure — they look identical
      // otherwise, and "skipped" then hides a fixable problem.
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
    ).trim();
  } catch (e) {
    const stderr = String(e.stderr ?? "");
    if (/No valid login session|not logged in|Please login/i.test(stderr)) loginExpired = true;
    throw e;
  }
}

/**
 * Read INFISICAL_WORKSPACE_ID out of an environment's infisical.env.
 *
 * The Infisical environment slug and the private-keys directory name do NOT
 * match for two of the four: Infisical "prod" lives in production/, and
 * Infisical "dev" lives in develop/. (There are four environments, not three —
 * "local" is separate from "dev"; see CLAUDE.md.)
 */
const KEY_DIR = { prod: "production", dev: "develop", staging: "staging", local: "local" };
function workspaceIdFor(infisicalEnv) {
  const dir = KEY_DIR[infisicalEnv] ?? infisicalEnv;
  const file = path.join(repoRoot, "private-keys", dir, "infisical.env");
  if (!existsSync(file)) return null;
  const m = readFileSync(file, "utf8").match(/^INFISICAL_WORKSPACE_ID=(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

let mismatches = 0;
let checked = 0;
const skipped = [];

for (const [apiUrl, expected] of Object.entries(lock.environments)) {
  const { infisicalEnv } = expected;
  const workspaceId = infisicalEnv ? workspaceIdFor(infisicalEnv) : null;
  if (!workspaceId) { skipped.push(`${apiUrl} (no infisical.env for "${infisicalEnv}")`); continue; }

  let audience, baseUrl;
  try {
    audience = infisicalGet("AUTH0_AUDIENCE", infisicalEnv, workspaceId);
    baseUrl = infisicalGet("AUTH0_BASE_URL", infisicalEnv, workspaceId);
  } catch (e) {
    skipped.push(`${apiUrl} (Infisical read failed: ${e.code ?? "error"})`);
    continue;
  }
  if (!audience && !baseUrl) { skipped.push(`${apiUrl} (secrets empty)`); continue; }

  checked++;
  const issues = [];
  if (audience && audience !== expected.audience) {
    issues.push(`audience: CLI asks for "${expected.audience}", server validates "${audience}"`);
  }
  // Compare origins so a trailing slash is not reported as drift.
  const norm = (u) => (u ?? "").replace(/\/+$/, "");
  if (baseUrl && norm(baseUrl) !== norm(expected.issuer)) {
    issues.push(`issuer: CLI uses "${expected.issuer}", server validates "${baseUrl}"`);
  }

  if (issues.length) {
    mismatches += issues.length;
    console.error(`✗ ${apiUrl}`);
    for (const i of issues) console.error(`    ${i}`);
  } else {
    console.log(`✓ ${apiUrl} — tenant and audience agree with the server`);
  }
}

for (const s of skipped) console.warn(`⏭️  SKIPPED ${s}`);

if (mismatches > 0) {
  console.error(
    `\n✗ ${mismatches} mismatch(es). A token minted by this CLI will fail validation,\n` +
    `  and the server fails OPEN — so users see an indistinguishable 403 on every\n` +
    `  authenticated route and re-authenticating never helps. Fix the lock AND\n` +
    `  src/auth/oauth.ts together, or correct the server's Infisical values.\n`,
  );
  process.exit(1);
}

if (checked === 0) {
  console.warn("\n⚠️  Nothing was verified — every environment was skipped. This is NOT a pass.");
  if (loginExpired) {
    console.warn("   Cause: the Infisical CLI session has expired. Fix with:  infisical login");
  }
  process.exit(0);
}
console.log(`\nOK  ${checked} environment(s) verified against Infisical.`);
