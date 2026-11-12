import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerWorkspaceGetCommand(parent: Command): void {
  parent
    .command("get <workspaceId>")
    .description("Get workspace details")
    .action(async (workspaceId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const workspace = await withSpinner("Fetching workspace...", () =>
          client.workspaces.get(workspaceId)
        );

        output(workspace, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
