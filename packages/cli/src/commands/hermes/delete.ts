import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerHermesDeleteCommand(parent: Command): void {
  parent
    .command("delete <agentId>")
    .alias("rm")
    .description("Delete a hosted Hermes agent (stops its container)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (agentId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const res = await withSpinner("Deleting agent…", () =>
          client.hermesAgents.delete(workspaceId, agentId),
        );

        output(res, { keyValue: true });
        console.log(colors.green(`Deleted agent ${agentId}.`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
