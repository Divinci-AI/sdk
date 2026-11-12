import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerConfigSetTitleCommand(parent: Command): void {
  parent
    .command("set-title <title>")
    .description("Set workspace title")
    .action(async (title, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const data = await withSpinner("Updating workspace title...", () =>
          client.config.updateTitle(workspaceId, title)
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
