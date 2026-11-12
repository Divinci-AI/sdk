import { Command } from "commander";

import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { loadCredentials, saveCredentials } from "../../config/credentials.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { colors } from "../../output/colors.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci privacy` — read and change the account's product-analytics consent.
 *
 * Deliberately NOT workspace-scoped: this is a property of the person, not of
 * a workspace, and requiring `workspace use` first would make opting out
 * harder than opting in. It needs authentication and nothing else.
 *
 * The same record backs the web app's privacy page and the MCP privacy tools,
 * so a change here is immediately reflected everywhere the user signs in.
 */

interface AnalyticsPreference {
  /** null = never chosen; true = opted out; false = explicitly opted in. */
  optOut: boolean | null;
  chosen: boolean;
}

const ROUTE = "/user/preferences/analytics";

function describe(pref: AnalyticsPreference): string {
  if (pref.optOut === true) return `${colors.yellow("off")} — analytics is disabled for your account`;
  if (pref.optOut === false) return `${colors.green("on")} — you have opted in to product analytics`;
  return `${colors.dim("not set")} — no account-level choice; each client applies its own default`;
}

async function readPreference(globalOpts: Record<string, unknown>): Promise<AnalyticsPreference> {
  let config = requireConfig(globalOpts as never);
  config = await ensureValidToken(config);
  const httpClient = createClient(config).getHttpClient();
  return withSpinner("Reading privacy preference...", () =>
    httpClient.get<AnalyticsPreference>(ROUTE),
  );
}

async function writePreference(
  globalOpts: Record<string, unknown>,
  optOut: boolean | null,
): Promise<AnalyticsPreference> {
  let config = requireConfig(globalOpts as never);
  config = await ensureValidToken(config);
  const httpClient = createClient(config).getHttpClient();
  return withSpinner("Saving privacy preference...", () =>
    httpClient.put<AnalyticsPreference>(ROUTE, { optOut }),
  );
}

function report(pref: AnalyticsPreference, note?: string): void {
  if (isJsonMode()) { output(pref); return; }
  console.log(`Product analytics: ${describe(pref)}`);
  if (note) console.log(colors.dim(note));
}

/**
 * `divinci privacy error-reporting` — consent for automatic CLI error reports.
 *
 * Deliberately LOCAL, unlike the analytics preference above, which is an
 * account property stored server-side. Two reasons it cannot live there: the
 * errors worth reporting are the ones where authentication is broken, so
 * reading a server-side preference would fail exactly when it matters; and
 * asking the server for permission to report that the server is unreachable is
 * circular. It is therefore per-machine, and OFF until someone says yes.
 */
function reportErrorReportingState(): void {
  let enabled: boolean | undefined;
  try { enabled = loadCredentials().errorReporting; } catch { /* unreadable */ }

  const state = enabled === true
    ? `${colors.green("on")} — anonymous CLI error reports are sent`
    : enabled === false
      ? `${colors.yellow("off")} — you have declined`
      : `${colors.yellow("off")} — never chosen (nothing has been sent)`;

  if (isJsonMode()) { console.log(JSON.stringify({ errorReporting: enabled ?? null })); return; }
  console.log(`CLI error reporting: ${state}`);
  console.log(colors.dim(
    "\nWhen on, a failed command queues a small report: CLI version, command NAME,\n" +
    "error kind, HTTP status, platform, and which environment your API URL and\n" +
    "Auth0 tenant belong to. Never arguments, paths, prompts, tokens or ids —\n" +
    "there is no free-text field. Use `divinci bug-report` to send details yourself.",
  ));
}

function setErrorReporting(enabled: boolean): void {
  const creds = loadCredentials();
  creds.errorReporting = enabled;
  saveCredentials(creds);
  if (isJsonMode()) { console.log(JSON.stringify({ errorReporting: enabled })); return; }
  console.log(enabled
    ? colors.green("CLI error reporting is ON. Thank you — this is how we find broken releases.")
    : colors.yellow("CLI error reporting is OFF. Nothing will be sent."));
}

export function registerPrivacyCommand(program: Command): void {
  const privacy = program
    .command("privacy")
    .description("View or change your product-analytics and CLI error-reporting preferences");

  const errorReporting = privacy
    .command("error-reporting")
    .description("Anonymous CLI error reports (local to this machine, off by default)");

  errorReporting
    .command("status", { isDefault: true })
    .description("Show whether CLI error reporting is on")
    .action(() => { reportErrorReportingState(); });

  errorReporting
    .command("on")
    .description("Turn anonymous CLI error reporting ON for this machine")
    .action(() => {
      try { setErrorReporting(true); } catch (error) { handleCommandError(error); }
    });

  errorReporting
    .command("off")
    .description("Turn anonymous CLI error reporting OFF for this machine")
    .action(() => {
      try { setErrorReporting(false); } catch (error) { handleCommandError(error); }
    });

  privacy
    .command("status")
    .description("Show whether product analytics is enabled for your account")
    .action(async (_opts, cmd: Command) => {
      try {
        report(await readPreference(cmd.optsWithGlobals()));
      } catch (error) {
        handleCommandError(error);
      }
    });

  privacy
    .command("opt-out")
    .description("Turn product analytics OFF for your account, on every device")
    .action(async (_opts, cmd: Command) => {
      try {
        report(
          await writePreference(cmd.optsWithGlobals(), true),
          "Applies to every device you sign in on. Browsers already open may take a moment.",
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  privacy
    .command("opt-in")
    .description("Turn product analytics ON for your account")
    .action(async (_opts, cmd: Command) => {
      try {
        report(await writePreference(cmd.optsWithGlobals(), false), "Thank you — usage and error events help us find bugs faster.");
      } catch (error) {
        handleCommandError(error);
      }
    });

  privacy
    .command("reset")
    .description("Clear your account-level choice and fall back to each client's default")
    .action(async (_opts, cmd: Command) => {
      try {
        // Withdrawing a decision is not the same as reversing it — after this
        // a browser signal such as Global Privacy Control governs again.
        report(await writePreference(cmd.optsWithGlobals(), null), "Cleared. Client defaults and browser privacy signals apply again.");
      } catch (error) {
        handleCommandError(error);
      }
    });
}
