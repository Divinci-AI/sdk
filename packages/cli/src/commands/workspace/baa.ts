import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { printAgreement } from "./hipaa-flow.js";

export function registerWorkspaceBaaCommand(parent: Command): void {
  parent
    .command("baa")
    .description(
      "Show the Business Associate Agreement a HIPAA workspace accepts at creation " +
        "(`workspace create --hipaa`), with its version hash",
    )
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const agreement = await withSpinner("Fetching agreement...", () =>
          client.workspaces.getBaaAgreement(),
        );

        if (isJsonMode()) {
          output(agreement);
          return;
        }
        printAgreement(agreement);
        if (!agreement.available) {
          console.warn(
            "This agreement is not yet available for acceptance: creating a HIPAA workspace " +
              "is refused until it is.",
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
