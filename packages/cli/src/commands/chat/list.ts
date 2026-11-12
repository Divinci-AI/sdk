import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerChatListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List conversations")
    .option("--limit <number>", "Maximum results", "20")
    .option("--offset <number>", "Offset for pagination", "0")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const data = await withSpinner("Fetching conversations...", () =>
          httpClient.get<{ transcripts: Array<Record<string, unknown>>; total: number }>(
            `/white-label/${workspaceId}/transcript`,
            {
              limit: parseInt(opts.limit, 10),
              offset: parseInt(opts.offset, 10),
            }
          )
        );

        output(data.transcripts, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "messageCount", header: "Messages" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
