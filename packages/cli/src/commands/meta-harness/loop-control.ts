import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerLoopPauseCommand(parent: Command): void {
  parent
    .command("pause")
    .description("Pause the loop (iterations rejected until resumed)")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const loop = await withSpinner("Pausing loop...", () =>
          client.metaHarness.loop.pause()
        );

        output(loop, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerLoopResumeCommand(parent: Command): void {
  parent
    .command("resume")
    .description("Resume a paused loop")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const loop = await withSpinner("Resuming loop...", () =>
          client.metaHarness.loop.resume()
        );

        output(loop, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerLoopCancelCommand(parent: Command): void {
  parent
    .command("cancel")
    .description("Cancel the loop (terminal state — requires meta-harness:admin)")
    .option("--confirm", "Confirm cancellation (required)")
    .action(async (opts, cmd) => {
      try {
        if (!opts.confirm) {
          throw new Error("Cancelling a loop is irreversible. Pass --confirm to proceed.");
        }

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const loop = await withSpinner("Cancelling loop...", () =>
          client.metaHarness.loop.cancel()
        );

        output(loop, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
