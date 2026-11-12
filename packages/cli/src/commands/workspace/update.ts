import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerWorkspaceUpdateCommand(parent: Command): void {
  parent
    .command("update")
    .description("Update the active workspace")
    .option("--title <title>", "New workspace title")
    .option("--description <description>", "New workspace description")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        if (!opts.title && !opts.description) {
          console.error("At least one of --title or --description is required.");
          process.exit(1);
        }

        const updateOpts: Record<string, string> = {};
        if (opts.title) updateOpts.name = opts.title;
        if (opts.description) updateOpts.description = opts.description;

        const data = await withSpinner("Updating workspace...", () =>
          client.workspaces.update(workspaceId, updateOpts)
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
