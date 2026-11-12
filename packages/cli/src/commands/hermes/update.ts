import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { UpdateHermesAgentBody } from "@divinci-ai/server";

/**
 * `divinci hermes update <agentId>` — partial update of a hosted agent.
 *
 * Server semantics this maps onto (hermes-agent/validate.ts):
 * - releaseId: 24-hex links a release for RAG grounding; empty string UNLINKS.
 * - providerApiKey: a value rotates the BYOK key (encrypted server-side); empty
 *   string clears BYOK entirely (provider + key) → back to platform billing.
 * - Everything else is plain partial-update: only flags you pass are touched.
 */
export function registerHermesUpdateCommand(parent: Command): void {
  parent
    .command("update <agentId>")
    .description("Update a hosted Hermes agent (model, persona, release link, BYOK, enable/disable)")
    .option("--title <title>", "New display name (1-200 chars)")
    .option("--description <text>", "New description")
    .option("--model <id>", "New model id — platform (vertex_ai/…, cloudflare/@cf/…) or BYOK (<provider>/<model>)")
    .option("--system-prompt <text>", "New persona / system prompt applied to every turn")
    .option("--enable", "Enable the agent (allow chat)")
    .option("--disable", "Disable the agent (reject chat with 403)")
    .option("--release <id>", "Link a White Label release (24-hex) for per-turn RAG grounding")
    .option("--clear-release", "Unlink the release (no more RAG grounding)")
    .option("--provider <id>", "BYOK provider (openai | anthropic | openrouter | gemini) — pair with --provider-api-key")
    .option("--provider-api-key <key>", "Rotate the BYOK key (encrypted server-side, never echoed back)")
    .option("--clear-provider-key", "Clear BYOK entirely — agent reverts to platform provider billing")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (agentId, opts, cmd) => {
      try {
        if (opts.enable && opts.disable) {
          throw new Error("--enable and --disable are mutually exclusive");
        }
        if (opts.release && opts.clearRelease) {
          throw new Error("--release and --clear-release are mutually exclusive");
        }
        if (opts.providerApiKey && opts.clearProviderKey) {
          throw new Error("--provider-api-key and --clear-provider-key are mutually exclusive");
        }

        const body: UpdateHermesAgentBody = {};
        if (opts.title !== undefined) body.title = opts.title;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.model !== undefined) body.hermesModel = opts.model;
        if (opts.systemPrompt !== undefined) body.systemPrompt = opts.systemPrompt;
        if (opts.enable) body.enabled = true;
        if (opts.disable) body.enabled = false;
        if (opts.release !== undefined) body.releaseId = opts.release;
        if (opts.clearRelease) body.releaseId = ""; // empty string = unlink (server contract)
        if (opts.provider !== undefined) body.provider = opts.provider;
        if (opts.providerApiKey !== undefined) body.providerApiKey = opts.providerApiKey;
        if (opts.clearProviderKey) body.providerApiKey = ""; // empty string = clear BYOK (server contract)

        if (Object.keys(body).length === 0) {
          throw new Error("Nothing to update — pass at least one field flag (see --help)");
        }

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const updated = await withSpinner("Updating agent…", () =>
          client.hermesAgents.update(workspaceId, agentId, body),
        );

        output(updated, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
