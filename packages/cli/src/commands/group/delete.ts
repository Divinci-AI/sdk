import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerGroupDeleteCommand(parent: Command): void {
  parent
    .command("delete <groupId>")
    .description("Delete a group")
    .action(async (groupId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        await withSpinner("Deleting group...", () =>
          client.groups.delete(groupId)
        );

        console.error(`Group ${groupId} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
