import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerFineTuneDeleteCommand(parent: Command): void {
  parent
    .command("delete <jobId>")
    .alias("rm")
    .description("Delete a fine-tuning job")
    .action(async (jobId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        await withSpinner("Deleting fine-tuning job...", () =>
          client.fineTune.delete(jobId)
        );

        console.error(colors.green(`Fine-tuning job ${jobId} deleted successfully.`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
