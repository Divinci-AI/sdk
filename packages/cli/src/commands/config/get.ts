import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerConfigGetCommand(parent: Command): void {
  parent
    .command("get")
    .description("Get workspace configuration")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const data = await withSpinner("Fetching workspace configuration...", () =>
          client.config.get(workspaceId)
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
