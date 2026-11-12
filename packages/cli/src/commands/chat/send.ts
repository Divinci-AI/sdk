import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import {
  printAssistantLabel,
  printStreamChunk,
  printStreamDone,
} from "../../output/stream.js";
import { handleCommandError } from "../../utils/errors.js";
import { getTermsGateFromError, promptAndAcceptTerms } from "../../utils/terms.js";
import { formatServedModelLabel } from "./model-label.js";
import { getTranscriptMessageCount, waitForAssistantReply } from "./wait-for-reply.js";
import type { TranscriptMessageRow } from "./wait-for-reply.js";
import {
  releaseEnvBody,
  extractCitations,
  formatCitations,
  isStillGenerating,
  replyRequestTimeoutMs,
} from "./release-chat.js";

function printAssistantReply(msg: TranscriptMessageRow, showCitations = false): void {
  console.log(colors.cyanBold("Assistant: ") + msg.content);
  if (msg.name) {
    console.log(colors.dim(`Model: ${formatServedModelLabel(msg.name)}`));
  }
  if (showCitations) {
    const citations = extractCitations(msg);
    if (citations.length > 0) {
      console.log(colors.dim("Sources:"));
      for (const line of formatCitations(citations)) console.log(colors.dim(line));
    }
  }
}

export function registerChatSendCommand(parent: Command): void {
  parent
    .command("send <transcriptId> <message>")
    .description("Send a message to a conversation")
    .option("--stream", "Stream the response token-by-token")
    .option(
      "--wait <seconds>",
      "After send, poll the transcript for the async assistant reply (default 30; 0 = skip)",
      "30",
    )
    .option(
      "--assistant-name <name>",
      "Assistant id (e.g. gemini-3-5-flash). Optional when the conversation is tied to a release (its assistant is used); otherwise the API returns BAD_FORM \"Assistant Name Not Provided\".",
    )
    .option(
      "--release <releaseId>",
      "Answer exactly as this release does — its prompts, RAG vectors and moderation all apply, whatever its status (draft or published). Also prints the cited sources. See `divinci chat ask` for the one-command form.",
    )
    .action(async (
      transcriptId: string,
      message: string,
      opts: { stream?: boolean, assistantName?: string, wait?: string, release?: string },
      cmd: Command,
    ) => {
      let httpClient: ReturnType<ReturnType<typeof createClient>["getHttpClient"]> | undefined;
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const waitSeconds = Math.max(0, parseInt(opts.wait ?? "30", 10) || 0);
        // The API holds the add-message request open while the model answers; the
        // SDK default (30s) failed the command on a perfectly normal slow answer.
        const client = createClient(config, { timeoutMs: replyRequestTimeoutMs(waitSeconds) });
        httpClient = client.getHttpClient();
        const releaseBody = opts.release ? releaseEnvBody(opts.release) : {};

        const endpoint = `/white-label/${workspaceId}/transcript/${transcriptId}/message`;
        const messageCountBefore = waitSeconds > 0
          ? await getTranscriptMessageCount(httpClient, workspaceId, transcriptId)
          : 0;

        if (opts.stream) {
          printAssistantLabel();

          const streamResponse = httpClient.stream(endpoint, {
            method: "POST",
            // The handler at this endpoint expects `content` per
            // add-message.ts:56 — sending `message` returned BAD_FORM.
            // assistantName is also required (handler throws BAD_FORM
            // "Assistant Name Not Provided" when missing).
            body: {
              content: message,
              stream: true,
              ...(opts.assistantName && { assistantName: opts.assistantName }),
              ...releaseBody,
            },
          });

          let fullResponse = "";
          for await (const chunk of streamResponse) {
            printStreamChunk(chunk);
            fullResponse += chunk;
          }

          printStreamDone();

          if (waitSeconds > 0 && fullResponse.trim().length === 0) {
            const reply = await waitForAssistantReply({
              httpClient,
              workspaceId,
              transcriptId,
              messageCountBefore,
              timeoutMs: waitSeconds * 1000,
            });
            if (reply) {
              printAssistantReply(reply, Boolean(opts.release));
            } else if (!isJsonMode()) {
              console.warn(colors.yellow(
                `No assistant reply within ${waitSeconds}s (API returns { status: "ok" } immediately; try --wait or chat.stage UI).`,
              ));
            }
          }

          if (isJsonMode()) {
            const meta = await streamResponse.metadata;
            output({
              response: fullResponse,
              transcriptId,
              ...meta,
            });
          }

          return;
        }

        // Non-streaming (default) path
        const http = httpClient;
        let data: { response?: string; messageId?: string; transcriptId?: string } | undefined;
        try {
          data = await withSpinner("Sending message...", () =>
            http.post<{ response: string; messageId: string; transcriptId: string }>(
              endpoint,
              // See streaming branch above for shape rationale.
              {
                content: message,
                ...(opts.assistantName && { assistantName: opts.assistantName }),
                ...releaseBody,
              }
            )
          );
        } catch (error) {
          // The API holds this request open while the model answers. If the
          // client — or Cloudflare's ~100s edge (502/504/524) — gives up first,
          // the message is still being processed and the reply lands in the
          // transcript, so when we were going to poll for it anyway, keep
          // polling rather than reporting a failure.
          if (!(waitSeconds > 0 && isStillGenerating(error))) throw error;
          if (!isJsonMode()) {
            console.warn(colors.yellow(
              "The API is still generating (the request was cut off before the reply); waiting for it in the transcript...",
            ));
          }
        }

        if (isJsonMode() && (!opts.release || waitSeconds === 0)) {
          output(data);
          return;
        }

        if (waitSeconds > 0) {
          const reply = await waitForAssistantReply({
            httpClient,
            workspaceId,
            transcriptId,
            messageCountBefore,
            timeoutMs: waitSeconds * 1000,
          });
          if (isJsonMode()) {
            // --release in JSON mode: the answer and its sources are the point.
            output({
              ...(data ?? {}),
              transcriptId,
              releaseId: opts.release,
              answer: reply?.content ?? null,
              model: reply?.name ?? null,
              citations: extractCitations(reply),
            });
            return;
          }
          if (reply) {
            printAssistantReply(reply, Boolean(opts.release));
            return;
          }
          console.warn(colors.yellow(
            `No assistant reply within ${waitSeconds}s (message accepted; check chat UI or increase --wait).`,
          ));
          return;
        }

        console.log(colors.dim("Message accepted (status: ok). Use --wait 30 to poll for the assistant reply."));
      } catch (error) {
        // Release-level Terms of Service gate: offer interactive acceptance,
        // then ask the user to re-run (the send is one-shot).
        const gate = getTermsGateFromError(error);
        if (gate && httpClient) {
          const accepted = await promptAndAcceptTerms(httpClient, gate).catch(() => false);
          if (accepted) {
            console.log(colors.dim("Re-run the command to send your message."));
            process.exit(0);
          }
          console.error(colors.red(
            "Terms of Service not accepted — message not sent. " +
            "Run the command in an interactive terminal to accept, or accept in the web app.",
          ));
          process.exit(1);
        }
        handleCommandError(error);
      }
    });
}
