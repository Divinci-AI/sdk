import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerGroupRemoveUserCommand(parent: Command): void {
  parent
    .command("remove-user <groupId>")
    .description("Remove a user from a group")
    .requiredOption("--user-id <userId>", "User ID to remove")
    .action(async (groupId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        await withSpinner("Removing user...", () =>
          client.groups.removeMember(groupId, opts.userId)
        );

        console.error(`User ${opts.userId} removed from group.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
