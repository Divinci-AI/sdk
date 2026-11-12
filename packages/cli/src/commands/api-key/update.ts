import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerApiKeyUpdateCommand(parent: Command): void {
  parent
    .command("update <keyId>")
    .description(
      "Update an existing API key's name, permissions, allowed origins, or allowed tiers. " +
      "Only the flags you pass are changed. Use --allowed-origins to authorize a new embedding " +
      "site for the embed widget's external-login without rotating the key's secret."
    )
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--name <name>", "New API key name")
    .option("--permissions <perms>", "Comma-separated permissions (replaces the current set)")
    .option(
      "--allowed-origins <origins>",
      "Comma-separated origins authorized for embed/external-login (replaces the current set). " +
      "Pass an empty string to clear."
    )
    .option("--allowed-tiers <tiers>", "Comma-separated membership tiers allowed (replaces the current set)")
    .action(async (keyId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);

        const splitList = (v: string): string[] =>
          v.split(",").map((s: string) => s.trim()).filter(Boolean);

        const updates: Record<string, unknown> = {};
        if (opts.name !== undefined) updates.name = opts.name;
        if (opts.permissions !== undefined) updates.permissions = splitList(opts.permissions);
        if (opts.allowedOrigins !== undefined) updates.allowedOrigins = splitList(opts.allowedOrigins);
        if (opts.allowedTiers !== undefined) updates.allowedTiers = splitList(opts.allowedTiers);

        if (Object.keys(updates).length === 0) {
          throw new Error(
            "Nothing to update. Pass at least one of --name, --permissions, --allowed-origins, --allowed-tiers."
          );
        }

        const key = await withSpinner("Updating API key...", () =>
          client.apiKeys.update(workspaceId, keyId, updates as any)
        );

        output(key, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
