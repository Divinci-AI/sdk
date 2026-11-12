import { Command } from "commander";
import * as readline from "node:readline";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { getTermsGateFromError, promptAndAcceptTerms } from "../../utils/terms.js";
import {
  printAssistantLabel,
  printStreamChunk,
  printStreamDone,
  printUserLabel,
  printSystemMessage,
} from "../../output/stream.js";
import { registerChatListCommand } from "./list.js";
import { registerChatHistoryCommand } from "./history.js";
import { registerChatSendCommand } from "./send.js";
import { registerChatNewCommand } from "./new.js";
import { registerChatAskCommand } from "./ask.js";

export function registerChatCommand(program: Command): void {
  const chat = program
    .command("chat")
    .description("Interactive AI chat or manage conversations")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        console.log(colors.cyanBold("Divinci AI Chat"));
        console.log(colors.dim("Type /help for commands, /exit to quit.\n"));

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const createTranscript = async (): Promise<string> => {
          const res = await httpClient.post<{ _id: string }>(
            `/white-label/${workspaceId}/transcript`,
            { title: "Chat session" },
          );
          return res._id;
        };

        let transcriptId = await createTranscript();

        const prompt = (): void => {
          printUserLabel();
          rl.once("line", async (line) => {
            const trimmed = line.trim();

            if (!trimmed) {
              prompt();
              return;
            }

            // Handle slash commands
            if (trimmed.startsWith("/")) {
              const handled = await handleSlashCommand(trimmed, rl);
              if (handled === "exit") return;
              if (handled === "new") {
                transcriptId = await createTranscript();
                printSystemMessage("Started new conversation.");
              }
              prompt();
              return;
            }

            const sendMessage = async (): Promise<void> => {
              const endpoint = `/white-label/${workspaceId}/transcript/${transcriptId}/message`;

              printAssistantLabel();

              const streamResponse = httpClient.stream(endpoint, {
                method: "POST",
                body: { content: trimmed },
              });

              for await (const chunk of streamResponse) {
                printStreamChunk(chunk);
              }

              printStreamDone();
              console.log("");
            };

            try {
              await sendMessage();
            } catch (error) {
              // Release-level Terms of Service gate: show the terms, record
              // acceptance, retry the message once.
              const gate = getTermsGateFromError(error);
              if (gate) {
                try {
                  const accepted = await promptAndAcceptTerms(httpClient, gate);
                  if (accepted) {
                    await sendMessage();
                  } else {
                    printSystemMessage("Terms of Service not accepted — message not sent.");
                  }
                } catch (acceptError) {
                  const msg = acceptError instanceof Error ? acceptError.message : String(acceptError);
                  printSystemMessage(`Error: ${msg}`);
                }
              } else {
                const msg = error instanceof Error ? error.message : String(error);
                printSystemMessage(`Error: ${msg}`);
              }
            }

            prompt();
          });
        };

        prompt();
      } catch (error) {
        handleCommandError(error);
      }
    });

  registerChatListCommand(chat);
  registerChatHistoryCommand(chat);
  registerChatSendCommand(chat);
  registerChatNewCommand(chat);
  registerChatAskCommand(chat);
}

async function handleSlashCommand(
  command: string,
  rl: readline.Interface
): Promise<"exit" | "new" | "handled"> {
  const parts = command.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "/exit":
    case "/quit":
      console.log(colors.dim("\nGoodbye!"));
      rl.close();
      return "exit";
    case "/new":
      return "new";
    case "/help":
      console.log("");
      console.log(colors.cyanBold("Chat Commands:"));
      console.log("  /help    Show this help");
      console.log("  /new     Start a new conversation");
      console.log("  /exit    Exit chat");
      console.log("");
      return "handled";
    default:
      printSystemMessage(`Unknown command: ${cmd}. Type /help for available commands.`);
      return "handled";
  }
}
