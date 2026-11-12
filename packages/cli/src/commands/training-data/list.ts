import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerTrainingDataListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List training data generation jobs")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const jobs = await withSpinner("Fetching jobs...", () =>
          client.trainingData.list(workspaceId)
        );

        output(jobs, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "status", header: "Status" },
              { key: "progress.qaPairsGenerated", header: "Pairs" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
