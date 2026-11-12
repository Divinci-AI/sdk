import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { formatServedModelLabel } from "./model-label.js";

interface Message {
  role: string;
  content: string;
  name?: string;
  timestamp?: number;
}

export function registerChatHistoryCommand(parent: Command): void {
  parent
    .command("history <transcriptId>")
    .description("Get conversation history")
    .option("--limit <number>", "Maximum messages to return", "50")
    .action(async (transcriptId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const data = await withSpinner("Fetching history...", () =>
          httpClient.get<{ messages: Message[]; title?: string }>(
            `/white-label/${workspaceId}/transcript/${transcriptId}`,
            { limit: parseInt(opts.limit, 10) }
          )
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        if (data.title) {
          console.log(colors.cyanBold(data.title));
          console.log("");
        }

        for (const msg of data.messages) {
          const label =
            msg.role === "user"
              ? colors.greenBold("You: ")
              : msg.role === "assistant"
                ? colors.cyanBold("Assistant: ")
                : colors.dim("System: ");
          console.log(`${label}${msg.content}`);
          if (msg.role === "assistant" && msg.name) {
            console.log(colors.dim(`  Model: ${formatServedModelLabel(msg.name)}`));
          }
          console.log("");
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
