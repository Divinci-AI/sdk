import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerFineTuneCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a new fine-tuning job")
    .requiredOption("--name <name>", "Name for the fine-tuning job")
    .requiredOption("--base-model <model>", "Base model to fine-tune")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const data = await withSpinner("Creating fine-tuning job...", () =>
          client.fineTune.create({
            workspaceId,
            name: opts.name,
            baseModel: opts.baseModel,
            trainingData: undefined,
          })
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
