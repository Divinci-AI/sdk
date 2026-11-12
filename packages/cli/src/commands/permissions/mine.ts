import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerPermissionsMineCommand(parent: Command): void {
  parent
    .command("mine")
    .description("Show your permissions on the active workspace")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const data = await withSpinner("Fetching your permissions...", () =>
          client.permissions.getMine()
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
