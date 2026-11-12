import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerFineTuneGetCommand(parent: Command): void {
  parent
    .command("get <jobId>")
    .description("Get fine-tuning job details")
    .action(async (jobId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const data = await withSpinner("Fetching fine-tuning job...", () =>
          client.fineTune.get(jobId)
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
