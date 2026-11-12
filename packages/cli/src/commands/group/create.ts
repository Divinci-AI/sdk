import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerGroupCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a new user group")
    .requiredOption("--name <name>", "Group name")
    .requiredOption("--slug <slug>", "URL-safe group slug")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const data = await withSpinner("Creating group...", () =>
          client.groups.create({ name: opts.name, slug: opts.slug })
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
