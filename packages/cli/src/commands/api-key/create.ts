import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { colors } from "../../output/colors.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export const API_KEY_SCOPE_HELP =
  "Scope the key with --permissions, a comma-separated list of <resource>:<action> grants, e.g.\n" +
  "  divinci api-key create --name ci --permissions rag:read,chat:read\n" +
  "  divinci api-key create --name ingest --permissions rag:read,rag:write\n" +
  "Wildcards are accepted (rag:*, *:read). To deliberately create an unscoped key that can do\n" +
  "everything in the workspace, pass --full-access instead.";

/**
 * Resolve the permission list sent on create.
 *
 * Guard for `divinci-api-key-create-grants-everything-by-default`: the server
 * and MCP treat a MISSING or EMPTY permission list as "grant everything", so a
 * create with no --permissions used to mint a full-access credential silently.
 * Returns `undefined` only when the caller opted in with --full-access (the
 * body then omits `permissions`, exactly as before). Everything else must name
 * at least one permission.
 */
export function resolveCreatePermissions(
  rawPermissions: string | undefined,
  fullAccess: boolean
): string[] | undefined {
  if (rawPermissions !== undefined && fullAccess) {
    throw new Error(
      "--permissions and --full-access are mutually exclusive. Pass one or the other.\n" + API_KEY_SCOPE_HELP
    );
  }
  if (fullAccess) return undefined;
  if (rawPermissions === undefined) {
    throw new Error(
      "Refusing to create an API key without --permissions: an unscoped key can do everything in the workspace.\n" +
      API_KEY_SCOPE_HELP
    );
  }
  const permissions = rawPermissions.split(",").map((p) => p.trim()).filter(Boolean);
  if (permissions.length === 0) {
    // `--permissions ""` or `--permissions ,` would send [], which also means everything.
    throw new Error(
      `--permissions "${rawPermissions}" names no permissions, and an empty list grants everything.\n` +
      API_KEY_SCOPE_HELP
    );
  }
  return permissions;
}

export function registerApiKeyCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a new API key")
    .requiredOption("--name <name>", "API key name")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option(
      "--permissions <perms>",
      "Comma-separated permissions (e.g. rag:read,rag:write,chat:read). Required unless --full-access is passed."
    )
    .option(
      "--full-access",
      "Create an UNSCOPED key that can do everything in the workspace. Required to create a key " +
      "without --permissions; prefer --permissions for anything handed to another system."
    )
    .option(
      "--allowed-origins <origins>",
      "Comma-separated origins authorized for embed/external-login " +
      "(e.g. https://example.com,https://www.example.com). Required for keys used by the " +
      "embed widget's external-login: the origin of the embedding site must be listed here."
    )
    .option("--allowed-tiers <tiers>", "Comma-separated membership tiers allowed (e.g. free,basic)")
    .option("--expires <date>", "Expiration date (ISO 8601)")
    .option(
      "--linked-apikey <id>",
      "Share user identity with an existing active key ID on the same workspace " +
      "(a customer authenticating through either key is treated as the same person — " +
      "same tier, usage, chat history). Only settable at creation."
    )
    .action(async (opts, cmd) => {
      try {
        // Checked before auth so a missing scope fails fast, offline.
        const permissions = resolveCreatePermissions(opts.permissions, opts.fullAccess === true);
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;

        // Fail fast with an actionable message. Without this, a missing/invalid
        // workspaceId is sent as `/api/v1/workspaces/undefined/api-keys`, which
        // the server rejects with an opaque "400 bad form data".
        if (!workspaceId || !/^[a-f0-9]{24}$/.test(workspaceId)) {
          throw new Error(
            "No workspace selected. Pass --workspace <id> with a 24-character workspace ID you own " +
            "(or set workspaceId in your profile). API keys can only be created in a workspace you own."
          );
        }

        const body: Record<string, unknown> = { name: opts.name };
        if (permissions) body.permissions = permissions;
        if (opts.allowedOrigins) {
          body.allowedOrigins = opts.allowedOrigins
            .split(",")
            .map((o: string) => o.trim())
            .filter(Boolean);
        }
        if (opts.allowedTiers) {
          body.allowedTiers = opts.allowedTiers
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean);
        }
        if (opts.expires) {
          // The server expects expiresAt as epoch milliseconds (a number); an
          // ISO string would be rejected as "bad form data". Convert + validate.
          const expiresMs = Date.parse(opts.expires);
          if (Number.isNaN(expiresMs)) {
            throw new Error(
              `Invalid --expires date: "${opts.expires}". Use an ISO 8601 date, e.g. 2027-01-01.`
            );
          }
          body.expiresAt = expiresMs;
        }
        if (opts.linkedApikey) {
          if (!/^[a-f0-9]{24}$/.test(opts.linkedApikey)) {
            throw new Error(
              `Invalid --linked-apikey "${opts.linkedApikey}": expected a 24-character API key ID.`
            );
          }
          body.linkedApikeyId = opts.linkedApikey;
        }

        const key = await withSpinner("Creating API key...", () =>
          client.apiKeys.create({ workspaceId, ...(body as any) })
        );

        // --json: emit ONE JSON document that includes the secret. Printing the
        // secret as human text and then JSON without it (the old behaviour)
        // left a script with valid JSON and no way to get the key.
        if (isJsonMode()) {
          output(key);
          return;
        }
        console.log(colors.yellow("\n  Save this secret now — it will not be shown again:\n"));
        console.log(`  ${colors.bold(key.secret)}\n`);
        // Strip the secret before the keyValue render so it isn't printed twice.
        const { secret: _secret, ...safe } = key;
        output(safe, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
