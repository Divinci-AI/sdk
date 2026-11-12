import { createHash } from "node:crypto";
import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";

/**
 * `divinci hermes get <agentId>` — full client-safe view of one hosted agent:
 * model, status/lastActiveAt (provisioned → active → stopped lifecycle), linked
 * releaseId for RAG grounding, BYOK provider + hasProviderApiKey (the encrypted
 * key itself is stripped server-side and never returned).
 *
 * The `hsk-` proxy key is REDACTED here to a fingerprint. `hermes get` is the
 * routine read — fleet verification, scripts, agents — and every log of its
 * output used to be a live spend credential in plaintext; that is how five keys
 * reached agent transcripts. Printing the key is now a deliberate act:
 * `hermes key <id>`, or `hermes get <id> --show-proxy-key`.
 */

/** `hsk-abcd…` + sha256[:12] — enough to identify and compare, useless to spend. */
export function redactProxyKey(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `${key.slice(0, 8)}… (sha256:${digest}) — redacted; use \`divinci hermes key\``;
}

export function registerHermesGetCommand(parent: Command): void {
  parent
    .command("get <agentId>")
    .description("Get one hosted Hermes agent (model, status, linked release; proxy key redacted)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--show-proxy-key", "Print the live hsk- proxy key instead of a fingerprint")
    .action(async (agentId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const agent = await withSpinner("Fetching agent…", () =>
          client.hermesAgents.get(workspaceId, agentId),
        );

        const view: Record<string, unknown> = { ...agent };
        if (!opts.showProxyKey && typeof view.proxyApiKey === "string") {
          view.proxyApiKey = redactProxyKey(view.proxyApiKey);
        }
        output(view, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
