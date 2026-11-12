import { ServerApiError } from "@divinci-ai/server";
import { colors } from "../output/colors.js";
import { isJsonMode } from "../output/formatter.js";
import { isReportingEnabled, queueReport, buildReport } from "../telemetry/error-report.js";

export function formatError(error: unknown): string {
  if (error instanceof ServerApiError) {
    return formatApiError(error);
  }
  if (error instanceof Error) {
    return colors.red(`Error: ${error.message}`);
  }
  return colors.red(`Error: ${String(error)}`);
}

/**
 * F2 (dogfood 2026-06-13): the server's error body often carries a `context`
 * field with the actually-useful detail (e.g. `bad form data` + context
 * "Already has file" / "Draft already released"). Surface it.
 */
function contextSuffix(error: ServerApiError): string {
  const body = error.body as { context?: unknown } | undefined;
  const context = typeof body?.context === "string" ? body.context : undefined;
  return context && context !== error.message ? ` — ${context}` : "";
}

/**
 * Error codes that mean "the credential is the problem", whatever status they
 * arrive with.
 *
 * The server currently answers an unverifiable token with 403, not 401:
 * optionalAuthMiddlewareHTTP swallows the validation failure and continues
 * unauthenticated, then getUserId throws FORBIDDEN because there is no `sub`.
 * Rendering that as "Permission denied" tells the user their ACCOUNT lacks
 * access, which is how the cli<=0.2.9 wrong-tenant incident turned into days of
 * hunting through API keys and workspace membership while the token was the
 * only thing wrong. When the server does name the cause, believe the code over
 * the status.
 */
const AUTHENTICATION_CODES = new Set([
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "AUTHENTICATION_FAILED",
  "UNAUTHENTICATED",
]);

const REAUTH_MESSAGE = "Authentication failed. Run `divinci auth login` to re-authenticate.";

function formatApiError(error: ServerApiError): string {
  if (error.code && AUTHENTICATION_CODES.has(error.code)) {
    return colors.red(REAUTH_MESSAGE);
  }
  switch (error.status) {
    case 401:
      return colors.red(REAUTH_MESSAGE);
    case 402:
      return colors.red(
        `This feature requires a paid plan. See https://divinci.app/pricing`
      );
    case 403:
      if (error.code === "TERMS_NOT_ACCEPTED") {
        return colors.yellow(
          "You must accept this release's Terms of Service before chatting. " +
          "Run `divinci terms accept <releaseId>` (or accept in the web app), then retry.",
        );
      }
      return colors.red(`Permission denied. ${error.message}${contextSuffix(error)}`);
    case 404:
      return colors.red(`Not found: ${error.message}${contextSuffix(error)}`);
    case 429: {
      const retryInfo = error.details?.retryAfter
        ? ` Retry in ${error.details.retryAfter}s.`
        : "";
      return colors.yellow(`Rate limit exceeded.${retryInfo}`);
    }
    default:
      if (error.status && error.status >= 500) {
        return colors.red(`Server error (${error.status}): ${error.message}${contextSuffix(error)}`);
      }
      return colors.red(`API error (${error.status ?? "unknown"}): ${error.message}${contextSuffix(error)}`);
  }
}

/**
 * Command path for the current invocation, set by the root program so the error
 * funnel can name the failing command without parsing argv again. Deliberately
 * just the command NAME — arguments routinely carry file paths, release ids and
 * prompt text, and none of that may leave the machine.
 */
let currentCommand = "unknown";
let currentApiUrl = "https://api.divinci.app";
let currentCliVersion = "0.0.0";

export function setTelemetryContext(ctx: {
  command?: string; apiUrl?: string; cliVersion?: string;
}): void {
  if (ctx.command) currentCommand = ctx.command;
  if (ctx.apiUrl) currentApiUrl = ctx.apiUrl;
  if (ctx.cliVersion) currentCliVersion = ctx.cliVersion;
}

export function handleCommandError(error: unknown): never {
  // F4 (dogfood 2026-06-13): in --json mode, emit a machine-readable error on
  // stdout so scripted callers (`for f in *; do divinci ... --json; done`) can
  // distinguish failures without scraping stderr.
  if (isJsonMode()) {
    const api = error instanceof ServerApiError ? error : undefined;
    console.log(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(api?.status !== undefined && { status: api.status }),
        ...(api?.code !== undefined && { code: api.code }),
        ...((api?.body as { context?: string } | undefined)?.context !== undefined && {
          context: (api!.body as { context?: string }).context,
        }),
      },
    }));
  }
  console.error(formatError(error));

  // Opt-in only, and queued rather than sent: this is a synchronous function
  // that exits, with 261 unawaited call sites, so it must not gain async
  // behaviour. queueReport writes a small file and cannot alter the exit code.
  if (isReportingEnabled()) {
    const api = error instanceof ServerApiError ? error : undefined;
    queueReport(buildReport({
      cliVersion: currentCliVersion,
      command: currentCommand,
      apiUrl: currentApiUrl,
      status: api?.status,
      code: api?.code,
    }));
  }

  process.exit(1);
}

export class OAuthRequiredError extends Error {
  constructor(authType?: string) {
    super(
      `This command requires OAuth authentication. Run \`divinci auth login\` to sign in, ` +
      `then retry. (Current auth type: ${authType ?? "none"}.)`
    );
    this.name = "OAuthRequiredError";
  }
}

/**
 * Guard for commands that must NOT run with API-key auth (e.g. workspace-level
 * API key management endpoints use OAuth-only middleware on the server).
 */
export function requireOAuthAuth(config: { authType?: string; accessToken?: string; apiKey?: string }): void {
  if (!config.accessToken) {
    const reportedType = config.authType ?? (config.apiKey ? "api-key" : undefined);
    throw new OAuthRequiredError(reportedType);
  }
}
