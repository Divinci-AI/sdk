import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerGroupListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List your groups")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const { groups } = await withSpinner("Fetching groups...", () =>
          client.groups.list()
        );

        output(groups, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "name", header: "Name" },
              { key: "slug", header: "Slug" },
              { key: "ownerUser", header: "Owner" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
