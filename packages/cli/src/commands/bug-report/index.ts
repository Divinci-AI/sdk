import { Command } from "commander";
import os from "node:os";

import { colors } from "../../output/colors.js";
import { isJsonMode } from "../../output/formatter.js";
import { tryGetAuth0Config } from "../../auth/oauth.js";
import { getProfile } from "../../config/credentials.js";

/**
 * `divinci bug-report` — assemble the diagnostics a support request needs.
 *
 * Why this exists. Until 2026-08-11 the CLI had NO reporting path at all: every
 * published package advertised a `bugs.url` on a private GitHub repo, which
 * returns 404 for anyone outside the org, so a user following the package's own
 * instructions had nowhere to go. The only command whose name looked like a
 * support channel was `divinci feedback` — which is an admin-tier read of chat
 * MESSAGE feedback and does nothing of the sort. Both a human and an AI
 * assistant made exactly that wrong turn.
 *
 * What it prints is chosen from a real incident. A CLI <=0.2.9 requested
 * production tokens from the DEV Auth0 tenant, so every /api/v1 route answered
 * 403 while `auth status` cheerfully reported "Authenticated, token valid".
 * Nothing the user could see named the tenant or the audience, so the
 * investigation went to API keys and workspace permissions for days. Those two
 * fields are now the first thing in the report.
 *
 * It SENDS NOTHING. Everything is gathered locally and printed for the user to
 * paste. That is deliberate: a report is most needed when authentication is
 * broken, so it must not require auth; and an unauthenticated endpoint that
 * accepts free text is an abuse surface this does not need to open. Automatic,
 * structured, consent-gated reporting is a separate thing.
 */

interface BugReport {
  cliVersion: string;
  node: string;
  platform: string;
  profile: string;
  apiUrl: string;
  authType: string;
  tokenPresent: boolean;
  tokenExpired: boolean | null;
  auth0Domain: string;
  auth0Audience: string;
}

/** Read `exp` from a JWT without verifying it. Never returns the token. */
function tokenExpired(accessToken?: string): boolean | null {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000 < Date.now();
  } catch {
    return null;
  }
}

export function collectBugReport(
  cliVersion: string,
  profileName: string,
  /**
   * The EFFECTIVE API URL, i.e. --api-url if given. Without this the report
   * showed the profile's stored URL, so someone diagnosing an "Unknown API URL"
   * refusal got a report naming a different host than the one that failed —
   * misleading in precisely the case the command exists for.
   */
  apiUrlOverride?: string,
): BugReport {
  // Never throws: a diagnostics command that dies on a broken config is useless
  // precisely when the config is what's broken.
  let profile: Record<string, unknown> = {};
  try {
    profile = (getProfile(profileName) ?? {}) as Record<string, unknown>;
  } catch { /* unreadable credentials file — report what we can */ }

  const apiUrl = apiUrlOverride ?? (profile.apiUrl as string) ?? "https://api.divinci.app";
  // Non-throwing: an unrecognized apiUrl is precisely the situation someone runs
  // bug-report to diagnose, so it must be reportable, not fatal.
  const auth0 = tryGetAuth0Config(apiUrl);
  const accessToken = profile.accessToken as string | undefined;

  return {
    cliVersion,
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    profile: profileName,
    apiUrl,
    authType: (profile.authType as string) ?? (profile.apiKey ? "api-key" : "none"),
    tokenPresent: Boolean(accessToken ?? profile.apiKey),
    tokenExpired: tokenExpired(accessToken),
    auth0Domain: auth0?.domain ?? "unknown (unrecognized API URL)",
    auth0Audience: auth0?.audience ?? "unknown (unrecognized API URL)",
  };
}

function render(report: BugReport): string {
  const lines = [
    `CLI version    ${report.cliVersion}`,
    `Node           ${report.node}`,
    `Platform       ${report.platform}`,
    ``,
    `Profile        ${report.profile}`,
    `API URL        ${report.apiUrl}`,
    `Auth type      ${report.authType}`,
    `Credential     ${report.tokenPresent ? "present" : "NONE — run `divinci auth login`"}`,
    `Token expired  ${report.tokenExpired === null ? "n/a" : report.tokenExpired ? "YES — re-authenticate" : "no"}`,
    ``,
    `Auth0 tenant   ${report.auth0Domain}`,
    `Auth0 audience ${report.auth0Audience}`,
  ];
  return lines.join("\n");
}

export function registerBugReportCommand(program: Command): void {
  program
    .command("bug-report")
    .description("Collect local diagnostics to include in a support request (sends nothing)")
    .action(() => {
      // Version is read off the root program so it cannot drift from --version.
      const cliVersion = program.version() ?? "unknown";
      const profileName = (program.opts().profile as string) ?? "default";
      const apiUrlOverride = program.opts().apiUrl as string | undefined;
      const report = collectBugReport(cliVersion, profileName, apiUrlOverride);

      if (isJsonMode()) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(colors.bold("\nDivinci CLI — diagnostics\n"));
      console.log(render(report));
      console.log(
        colors.dim(
          "\nNo credentials or tokens are included above, and nothing has been sent.\n",
        ),
      );
      console.log("Send this with a description of what you ran and what happened:");
      console.log(`  ${colors.cyan("https://divinci.ai/support")}`);
      console.log(`  ${colors.cyan("engineering@divinci.app")}\n`);

      if (report.tokenExpired === true) {
        console.log(colors.yellow("Note: your access token has expired. `divinci auth login` may fix this on its own.\n"));
      }
    });
}
