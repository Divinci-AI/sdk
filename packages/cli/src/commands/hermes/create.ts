import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

export function registerHermesCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a hosted Hermes agent (isolated Cloudflare Sandbox container)")
    .requiredOption("--title <title>", "Display name for the agent (1-200 chars)")
    .option(
      "--model <id>",
      "Model id. Platform (Divinci-paid, no key): vertex_ai/gemini-2.5-flash (default), " +
        "vertex_ai/gemini-2.5-pro, cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast. " +
        "Or BYOK: anthropic/claude-sonnet-4-5, openai/gpt-4.1, etc.",
    )
    .option("--system-prompt <text>", "Persona / system prompt applied to every turn")
    .option("--description <text>", "What this agent is for")
    .option(
      "--release <id>",
      "Link a White Label release (24-hex id) for per-turn RAG grounding — the agent " +
        "retrieves context from that release's knowledge base and injects it into each turn",
    )
    .option(
      "--provider <id>",
      "BYOK provider (openai | anthropic | openrouter | gemini) — only for a bring-your-own-key model",
    )
    .option(
      "--provider-api-key <key>",
      "BYOK provider key (encrypted server-side; never echoed back). Only for a BYOK model.",
    )
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

        const created = await withSpinner("Creating Hermes agent…", () =>
          client.hermesAgents.create(workspaceId, {
            title: opts.title,
            ...(opts.model ? { hermesModel: opts.model } : {}),
            ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
            ...(opts.description ? { description: opts.description } : {}),
            ...(opts.release ? { releaseId: opts.release } : {}),
            ...(opts.provider ? { provider: opts.provider } : {}),
            ...(opts.providerApiKey ? { providerApiKey: opts.providerApiKey } : {}),
          }),
        );

        output(created, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
