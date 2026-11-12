import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { colors } from "../../output/colors.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerApiKeyRotateCommand(parent: Command): void {
  parent
    .command("rotate <keyId>")
    .description("Rotate an API key's secret (invalidates the old one)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (keyId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);

        const result = await withSpinner("Rotating API key...", () =>
          client.apiKeys.rotate(workspaceId, keyId)
        );

        // --json: the secret must be IN the JSON, or a script has no way to
        // capture it and the old secret is already dead.
        if (isJsonMode()) {
          output({ id: keyId, secret: result.secret });
          return;
        }
        console.log(colors.yellow("\n  Save this secret now — it will not be shown again:\n"));
        console.log(`  ${colors.bold(result.secret)}\n`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
