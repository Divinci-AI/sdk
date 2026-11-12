import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerTrainingDataDeleteCommand(parent: Command): void {
  parent
    .command("delete <jobId>")
    .description("Cancel and delete a training data generation job")
    .action(async (jobId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        await withSpinner("Deleting job...", () =>
          client.trainingData.cancel(workspaceId, jobId)
        );

        console.warn(`Job ${jobId} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
