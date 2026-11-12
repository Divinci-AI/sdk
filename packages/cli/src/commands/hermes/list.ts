import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerHermesListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List the workspace's hosted Hermes agents")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const agents = await withSpinner("Fetching agents…", () =>
          client.hermesAgents.list(workspaceId),
        );

        if (isJsonMode()) {
          output(agents);
          return;
        }

        if (!agents || agents.length === 0) {
          console.log(colors.dim("No Hermes agents yet. Create one with `divinci hermes create`."));
          return;
        }

        for (const a of agents) {
          const flags = [a.enabled ? "enabled" : "disabled", a.status].join(", ");
          console.log(
            `${colors.bold(a.title)} ${colors.dim(`(${a.hermesModel})`)} — ${flags} — ${colors.dim(`id ${a._id}`)}`,
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
