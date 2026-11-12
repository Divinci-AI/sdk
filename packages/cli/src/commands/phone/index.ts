/**
 * `divinci phone` command group
 *
 * Unbilled voice-call (LiveKit) and SMS/MMS (Twilio) usage for a workspace
 * — what the next scheduled billing sweep will charge, at cost. See the
 * "Phone Billing" guide on the docs site for the full billing model (number
 * rental, per-minute call rates, per-segment SMS/MMS rates).
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { DivinciServer } from "@divinci-ai/server";

async function buildContext(
  opts: { workspace?: string },
  cmd: Command
): Promise<{ client: DivinciServer; workspaceId: string }> {
  const globalOpts = cmd.optsWithGlobals();
  let config = requireConfig(globalOpts);
  requireOAuthAuth(config);
  config = await ensureValidToken(config);
  const client = createClient(config);
  const workspaceId = opts.workspace || config.workspaceId;
  if (!workspaceId) throw new Error("--workspace required (no active workspace set)");
  return { client, workspaceId };
}

export function registerPhoneCommands(parent: Command): void {
  const usage = parent
    .command("usage")
    .description("Unbilled voice-call and SMS/MMS usage (what the next billing sweep will charge)");

  usage
    .command("voice")
    .description("Unbilled LiveKit voice-call usage (calls, cost, oldest unbilled call)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching voice usage…", () =>
          client.phoneUsage.voice(workspaceId)
        );
        output(result, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  usage
    .command("sms")
    .description("Unbilled Twilio SMS/MMS usage (messages, cost)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching SMS usage…", () =>
          client.phoneUsage.sms(workspaceId)
        );
        output(result, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
