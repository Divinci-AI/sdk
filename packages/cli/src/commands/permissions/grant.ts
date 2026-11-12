import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerPermissionsGrantCommand(parent: Command): void {
  parent
    .command("grant")
    .description("Grant permissions to a user or group")
    .option("--user <email>", "User email to grant permissions to")
    .option("--group <slug>", "Group slug to grant permissions to")
    .requiredOption("--permissions <permissions>", "Comma-separated permission list (e.g. rag,config,permission)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const permissions = opts.permissions.split(",").map((p: string) => p.trim()).filter(Boolean);

        if (opts.user) {
          await withSpinner(`Granting permissions to ${opts.user}...`, () =>
            client.permissions.grantToUser(opts.user, permissions)
          );
          console.error(`Permissions granted to ${opts.user}: ${permissions.join(", ")}`);
        } else if (opts.group) {
          await withSpinner(`Granting permissions to group ${opts.group}...`, () =>
            client.permissions.grantToGroup(opts.group, permissions)
          );
          console.error(`Permissions granted to group ${opts.group}: ${permissions.join(", ")}`);
        } else {
          console.error("Either --user <email> or --group <slug> is required.");
          process.exit(1);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
