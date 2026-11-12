import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerLoopShowCommand(parent: Command): void {
  parent
    .command("show")
    .description("Show orchestration loop status and configuration")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const loop = await withSpinner("Fetching loop...", () =>
          client.metaHarness.loop.get()
        );

        output(loop, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
