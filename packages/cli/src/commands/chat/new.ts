import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci chat new` — create a new transcript on a Release.
 *
 * Pipes through the internal JWT-friendly endpoint
 *   POST /white-label/:wlId/transcript
 * Body shape: { title, releaseId?, parentTranscriptId?, parentMessageId? }
 *
 * Returns the new transcript id. Useful for scripting tests that need a
 * known-fresh transcript on a specific Release (e.g. validating Vertex
 * context caching toggles end-to-end without polluting an existing chat).
 */
export function registerChatNewCommand(parent: Command): void {
  parent
    .command("new")
    .description("Create a new conversation (transcript) on a Release")
    .requiredOption("--title <title>", "Title for the new transcript")
    .option("--release-id <releaseId>", "Tie the transcript to a specific Release")
    .option("--parent-transcript-id <id>", "Parent transcript id for sub-thread linkage")
    .option("--parent-message-id <id>", "Parent message id (required if --parent-transcript-id is set)")
    .action(async (opts: {
      title: string;
      releaseId?: string;
      parentTranscriptId?: string;
      parentMessageId?: string;
    }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const body: Record<string, string> = { title: opts.title };
        if (opts.releaseId) body.releaseId = opts.releaseId;
        if (opts.parentTranscriptId) body.parentTranscriptId = opts.parentTranscriptId;
        if (opts.parentMessageId) body.parentMessageId = opts.parentMessageId;

        const data = await withSpinner("Creating transcript...", () =>
          httpClient.post<{ _id: string; title?: string }>(
            `/white-label/${workspaceId}/transcript`,
            body,
          )
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        console.log(colors.green(`Created transcript ${colors.cyanBold(data._id)}`));
        if (data.title) console.log(colors.dim(`  title: ${data.title}`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
