/**
 * The error-surface contract: what a user is TOLD when auth fails.
 *
 * This is the second half of the cli<=0.2.9 incident. The token was minted by
 * the wrong Auth0 tenant, so the server could not validate it — but the server
 * fails OPEN (optionalAuthMiddlewareHTTP swallows the validation error), the
 * handler then throws FORBIDDEN from getUserId, and the CLI renders 403 as
 * "Permission denied". "Permission denied" is a statement about AUTHORIZATION:
 * it tells the user their account lacks access. So the user goes looking for
 * API keys, workspace membership and org headers — all of which were fine —
 * and never suspects the credential itself.
 *
 * errors.ts already contains the right sentence ("Authentication failed. Run
 * `divinci auth login`"), sitting on the 401 branch the server never triggers.
 *
 * These tests pin the CLIENT half of the contract: whatever the server sends,
 * an authentication failure must read as one. The server half (returning 401
 * with a reason when a token is present but invalid) is tracked separately;
 * until it lands, `403 + an auth-shaped code` is the signal the CLI has to work
 * with, which is why that case is asserted explicitly here.
 */
import { describe, test, expect } from "vitest";
import { ServerApiError } from "@divinci-ai/server";

import { formatError } from "../../../src/utils/errors.js";

/** Strip ANSI so assertions are about wording, not colour. */
const plain = (s: string) => s.replace(/\[[0-9;]*m/g, "");

function apiError(status: number, message: string, code?: string): ServerApiError {
  const e = new ServerApiError(message, { status, code } as never);
  // Constructor shape varies by SDK version; force the fields the formatter reads.
  Object.assign(e, { status, code, message });
  return e;
}

describe("error surface: authentication vs authorization", () => {
  test("401 tells the user to re-authenticate", () => {
    const out = plain(formatError(apiError(401, "unauthorized")));
    expect(out).toMatch(/auth login/);
    expect(out).not.toMatch(/Permission denied/);
  });

  test("a plain 403 still reads as an authorization problem", () => {
    // Correct behaviour: a genuine authorization failure SHOULD say so. This
    // test exists so the fix for the case below cannot over-correct and start
    // telling users to re-login when they simply lack access.
    const out = plain(formatError(apiError(403, "forbidden")));
    expect(out).toMatch(/Permission denied/);
  });

  test("an auth-shaped 403 does NOT send the user hunting for permissions", () => {
    // The incident case. When the server signals that the credential itself is
    // the problem, the CLI must not render it as "Permission denied".
    for (const code of ["INVALID_TOKEN", "TOKEN_EXPIRED", "AUTHENTICATION_FAILED"]) {
      const out = plain(formatError(apiError(403, "forbidden", code)));
      expect(out, `code=${code} should point at the credential`).toMatch(/auth login/);
      expect(out, `code=${code} must not blame permissions`).not.toMatch(/Permission denied/);
    }
  });

  test("the re-auth message names the exact command to run", () => {
    // A message that says "authentication failed" without the remedy is how a
    // user ends up trying four different things. Name the command.
    const out = plain(formatError(apiError(401, "unauthorized")));
    expect(out).toContain("divinci auth login");
  });
});
