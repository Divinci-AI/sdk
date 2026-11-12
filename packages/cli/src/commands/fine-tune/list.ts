import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerFineTuneListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List fine-tuning jobs")
    .option("--limit <number>", "Maximum results", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const data = await withSpinner("Fetching fine-tuning jobs...", () =>
          client.fineTune.list(workspaceId, {
            limit: parseInt(opts.limit, 10),
          })
        );

        output(data.data, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "name", header: "Name" },
              { key: "baseModel", header: "Base Model" },
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
