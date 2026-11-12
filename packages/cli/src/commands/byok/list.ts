import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerByokListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List BYOK records for a workspace")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--provider <id>", "Filter by provider id (e.g. NEO4J_HYBRID)")
    .option("--available <bool>", "Filter by available flag (true|false)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const filters: { providerId?: string; available?: boolean } = {};
        if (opts.provider) filters.providerId = opts.provider;
        if (opts.available !== undefined) filters.available = opts.available === "true";

        const result = await withSpinner("Fetching BYOK records…", () =>
          client.byok.list(workspaceId, filters),
        );

        output(result.page, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "name", header: "Name" },
              { key: "providerId", header: "Provider" },
              { key: "available", header: "Available" },
              { key: "keyPreview", header: "Preview" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
