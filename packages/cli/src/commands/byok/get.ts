import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerByokGetCommand(parent: Command): void {
  parent
    .command("get <keyId>")
    .description("Get a BYOK record by ID")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (keyId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const byok = await withSpinner("Fetching BYOK record…", () =>
          client.byok.get(workspaceId, keyId),
        );

        output(byok, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
