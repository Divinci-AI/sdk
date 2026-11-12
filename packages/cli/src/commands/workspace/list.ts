import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerWorkspaceListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List your workspaces")
    .option("--limit <number>", "Maximum results", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const workspaces = await withSpinner("Fetching workspaces...", () =>
          client.workspaces.list({
            limit: parseInt(opts.limit, 10),
          })
        );

        output(workspaces.data, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "name", header: "Name" },
              { key: "status", header: "Status" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
