import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerIterationsListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List iteration history")
    .option("--limit <number>", "Maximum results", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const iterations = await withSpinner("Fetching iterations...", () =>
          client.metaHarness.iterations.list({ limit: parseInt(opts.limit, 10) })
        );

        output(iterations, {
          table: {
            columns: [
              { key: "iterationNumber", header: "#" },
              { key: "status", header: "Status" },
              { key: "report.headline", header: "Report" },
              { key: "proposalIds.length", header: "Proposals" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerIterationsShowCommand(parent: Command): void {
  parent
    .command("show <iterationId>")
    .description("Show iteration detail")
    .action(async (iterationId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const iteration = await withSpinner("Fetching iteration...", () =>
          client.metaHarness.iterations.get(iterationId)
        );

        output(iteration, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
