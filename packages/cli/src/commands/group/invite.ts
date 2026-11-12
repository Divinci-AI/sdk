import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerGroupInviteCommand(parent: Command): void {
  parent
    .command("invite <groupId>")
    .description("Invite a user to a group")
    .requiredOption("--email <email>", "Email address to invite")
    .action(async (groupId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        await withSpinner("Sending invitation...", () =>
          client.groups.invite(groupId, opts.email)
        );

        console.error(`Invitation sent to ${opts.email}.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
