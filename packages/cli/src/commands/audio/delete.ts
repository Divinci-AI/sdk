import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerAudioDeleteCommand(parent: Command): void {
  parent
    .command("delete <audioId>")
    .alias("rm")
    .description("Delete an audio transcript")
    .action(async (audioId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        await withSpinner("Deleting audio transcript...", () =>
          client.audio.delete(audioId)
        );

        console.error(colors.green(`Audio transcript ${audioId} deleted successfully.`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
