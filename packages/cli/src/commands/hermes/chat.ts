import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerHermesChatCommand(parent: Command): void {
  parent
    .command("chat <agentId> <message>")
    .description("Send one message to a hosted Hermes agent and print its reply")
    .option("--max-tokens <n>", "Max tokens for the reply")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (agentId, message, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        // The turn cold-boots the container on first use; give it room.
        config = await ensureValidToken(config);
        const client = createClient(config, { timeoutMs: 180_000 });
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const sendTurn = () =>
          client.hermesAgents.chat(
            workspaceId,
            agentId,
            [{ role: "user", content: message }],
            opts.maxTokens ? { maxTokens: Number(opts.maxTokens) } : {},
          );

        let res;
        try {
          res = await withSpinner("Waiting for the agent…", sendTurn);
        } catch (err) {
          // Cold container: the API returns a retryable 503 agent_warming (and a
          // wedged boot can still surface as an edge 524). One automatic retry
          // after the warm-up window instead of failing the user's first turn.
          const msg = err instanceof Error ? err.message : String(err);
          const coldStart = msg.includes("agent_warming") || msg.includes("(503)") || msg.includes("(524)");
          if (!coldStart) throw err;
          res = await withSpinner(
            "Agent is cold-starting — retrying in 30s…",
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 30_000));
              return sendTurn();
            },
          );
        }

        if (isJsonMode()) {
          output(res);
          return;
        }

        const reply = res.choices?.[0]?.message?.content ?? "";
        console.log(reply || colors.dim("(no content in response)"));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
