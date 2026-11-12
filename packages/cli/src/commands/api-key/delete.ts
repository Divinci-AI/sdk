import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { colors } from "../../output/colors.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import { confirm } from "@inquirer/prompts";

export function registerApiKeyDeleteCommand(parent: Command): void {
  parent
    .command("delete <keyId>")
    .description("Delete an API key")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (keyId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);

        if (!opts.yes) {
          const ok = await confirm({
            message: `Delete API key ${keyId}? This cannot be undone.`,
            default: false,
          });
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }

        await withSpinner("Deleting API key...", () =>
          client.apiKeys.delete(workspaceId, keyId)
        );

        console.log(colors.green("API key deleted."));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
