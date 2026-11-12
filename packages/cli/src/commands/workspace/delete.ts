import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { confirm } from "@inquirer/prompts";

export function registerWorkspaceDeleteCommand(parent: Command): void {
  parent
    .command("delete")
    .description("Delete the active workspace")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        if (!opts.force) {
          const confirmed = await confirm({
            message: `Are you sure you want to delete workspace ${workspaceId}? This cannot be undone.`,
            default: false,
          });
          if (!confirmed) {
            console.error("Deletion cancelled.");
            return;
          }
        }

        await withSpinner("Deleting workspace...", () =>
          client.workspaces.delete(workspaceId)
        );

        console.error(`Workspace ${workspaceId} deletion initiated.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
