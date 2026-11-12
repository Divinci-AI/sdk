import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerPermissionsRevokeCommand(parent: Command): void {
  parent
    .command("revoke")
    .description("Revoke permissions from a user or group")
    .option("--user <email>", "User email to revoke permissions from")
    .option("--user-id <userId>", "User ID to revoke permissions from")
    .option("--group <slug>", "Group slug to revoke permissions from")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        if (opts.userId) {
          await withSpinner("Revoking user permissions...", () =>
            client.permissions.revokeFromUser({ userId: opts.userId })
          );
          console.error(`Permissions revoked for user ${opts.userId}.`);
        } else if (opts.user) {
          await withSpinner("Revoking user invitation...", () =>
            client.permissions.revokeFromUser({ email: opts.user })
          );
          console.error(`Invitation revoked for ${opts.user}.`);
        } else if (opts.group) {
          await withSpinner(`Revoking group permissions for ${opts.group}...`, () =>
            client.permissions.revokeFromGroup(opts.group)
          );
          console.error(`Permissions revoked for group ${opts.group}.`);
        } else {
          console.error("One of --user, --user-id, or --group is required.");
          process.exit(1);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
