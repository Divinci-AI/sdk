import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerApiKeyListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List API keys for a workspace")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);

        const keys = await withSpinner("Fetching API keys...", () =>
          client.apiKeys.list(workspaceId)
        );

        output(keys, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "name", header: "Name" },
              { key: "prefix", header: "Prefix" },
              {
                key: "allowedOrigins",
                header: "Allowed origins",
                format: (v: unknown) =>
                  Array.isArray(v) && v.length ? (v as string[]).join(", ") : "—",
              },
              { key: "createdAt", header: "Created" },
              { key: "lastUsedAt", header: "Last used" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
