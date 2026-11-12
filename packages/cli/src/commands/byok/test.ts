import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

/**
 * `divinci byok test <keyId>`: probe an openai-compatible key's endpoint with
 * one fixed request, through the same path a TrustBench run uses. Prints the
 * outcome only (ok, latency, failure kind and status), never the reply.
 * Exits 1 when the endpoint did not answer correctly, so it can gate a script.
 */
export function registerByokTestCommand(parent: Command): void {
  parent
    .command("test <keyId>")
    .description("Probe an openai-compatible BYOK endpoint (one fixed request; outcome only)")
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

        const result = await withSpinner("Probing endpoint…", () =>
          client.byok.test(workspaceId, keyId),
        );

        output(result, { keyValue: true });
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        handleCommandError(error);
      }
    });
}
