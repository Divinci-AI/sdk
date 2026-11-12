import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import { readAuthPayload } from "./create.js";

export function registerByokRotateCommand(parent: Command): void {
  parent
    .command("rotate <keyId>")
    .description("Rotate the encrypted credentials on an existing BYOK record (in place — RAG vectors keep their byok ref)")
    .option("--auth-file <path>", 'File holding the new auth payload as JSON, or "-" to read it from stdin (keeps the secret out of shell history and process listings)')
    .option("--auth <json>", "New auth payload as inline JSON. Visible in shell history and `ps`: prefer --auth-file.")
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

        const auth = readAuthPayload(opts);

        const updated = await withSpinner("Rotating BYOK credentials (validating against provider)…", () =>
          client.byok.rotate(workspaceId, keyId, { auth }),
        );

        output(updated, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
