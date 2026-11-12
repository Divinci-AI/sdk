import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerTrainingDataStatusCommand(parent: Command): void {
  parent
    .command("status <jobId>")
    .description("Get training data job status")
    .action(async (jobId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const job = await withSpinner("Fetching job status...", () =>
          client.trainingData.get(workspaceId, jobId)
        );

        output(job, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
