import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

/**
 * `divinci hermes key <agentId>` — show the agent's `hsk-` proxy key (to
 * configure a local Hermes / OpenAI-compatible client), or rotate it with
 * `--rotate` (revokes the old one).
 */
export function registerHermesKeyCommand(parent: Command): void {
  parent
    .command("key <agentId>")
    .description("Show or rotate the agent's hsk- proxy key")
    .option("--rotate", "Regenerate the proxy key, revoking the old one", false)
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (agentId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const agent = opts.rotate
          ? await withSpinner("Rotating proxy key…", () =>
              client.hermesAgents.regenerateKey(workspaceId, agentId),
            )
          : await withSpinner("Fetching agent…", () =>
              client.hermesAgents.get(workspaceId, agentId),
            );

        if (isJsonMode()) {
          output({ proxyApiKey: agent.proxyApiKey });
          return;
        }

        console.log(agent.proxyApiKey);
        console.log(
          colors.dim(
            "Point any OpenAI-compatible client at " +
              `${config.apiUrl.replace(/\/+$/, "")}/api/v1/hermes-proxy with this key.`,
          ),
        );
      } catch (error) {
        handleCommandError(error);
      }
    });
}
