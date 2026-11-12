import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerByokDeleteCommand(parent: Command): void {
  parent
    .command("delete <keyId>")
    .alias("rm")
    .description("Delete a BYOK record")
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

        const deleted = await withSpinner("Deleting BYOK record…", () =>
          client.byok.delete(workspaceId, keyId),
        );

        output(deleted, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
