import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerLoopUpdateCommand(parent: Command): void {
  parent
    .command("update")
    .description("Update loop configuration")
    .option("--autonomy-level <level>", "Autonomy level: manual, checkpoint-every-iteration, full-auto")
    .option("--min-signal <n>", "Minimum signal threshold (integer)")
    .option("--proposal-expiry-hours <n>", "Hours until proposals expire (integer)")
    .option("--interval-ms <n>", "Auto-trigger interval in ms (0 = disabled, min 300000)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const update: Record<string, unknown> = {};
        if (opts.autonomyLevel) update.autonomyLevel = opts.autonomyLevel;
        if (opts.minSignal) update.minSignalThreshold = parseInt(opts.minSignal, 10);
        if (opts.proposalExpiryHours) update.proposalExpiryHours = parseInt(opts.proposalExpiryHours, 10);
        if (opts.intervalMs) update.intervalMs = parseInt(opts.intervalMs, 10);

        if (Object.keys(update).length === 0) {
          throw new Error("No configuration options provided. Use --help to see available options.");
        }

        const loop = await withSpinner("Updating loop config...", () =>
          client.metaHarness.loop.update(update)
        );

        output(loop, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
