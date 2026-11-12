import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerLoopIterateCommand(parent: Command): void {
  parent
    .command("iterate")
    .description("Trigger a single iteration of the meta-harness loop")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const result = await withSpinner("Triggering iteration...", () =>
          client.metaHarness.loop.iterate()
        );

        output(result, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
