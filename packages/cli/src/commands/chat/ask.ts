import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { getTermsGateFromError, promptAndAcceptTerms } from "../../utils/terms.js";
import { formatServedModelLabel } from "./model-label.js";
import { getTranscriptMessageCount, waitForAssistantReply } from "./wait-for-reply.js";
import {
  assertReleaseUsable,
  extractCitations,
  formatCitations,
  isStillGenerating,
  releaseEnvBody,
  replyRequestTimeoutMs,
  type ReleaseSummary,
} from "./release-chat.js";

/**
 * `divinci chat ask <question> --release <id>` — ask a release a question the
 * way an end user would, in one command.
 *
 * It creates a conversation tied to the release, sends the question with the
 * release pinned (`{ type: "release", releaseId }`, so the release's prompts,
 * RAG vectors and moderation all apply — draft or published), waits for the
 * reply, and prints the answer with the sources it cited.
 *
 * Reach for this to test a release's real behaviour. `chat send` on a bare
 * conversation answers with whatever environment that conversation resolves
 * to, which is not necessarily the release you are tuning.
 */
export function registerChatAskCommand(parent: Command): void {
  parent
    .command("ask <question>")
    .description("Ask a release a question as an end user would — answer plus cited sources, in one command")
    .requiredOption("--release <releaseId>", "The release to ask (its prompts, RAG vectors and moderation apply)")
    .option("--transcript <transcriptId>", "Continue an existing conversation instead of starting a new one")
    .option("--title <title>", "Title for the new conversation", "CLI question")
    .option("--wait <seconds>", "How long to wait for the reply", "120")
    .option(
      "--published-only",
      "Fail unless the release is published (status \"available\") — i.e. only if an end user could reach it",
    )
    .option("--assistant-name <name>", "Override the model; by default the release's own assistant answers")
    .action(async (
      question: string,
      opts: {
        release: string,
        transcript?: string,
        title: string,
        wait?: string,
        publishedOnly?: boolean,
        assistantName?: string,
      },
      cmd: Command,
    ) => {
      let httpClient: ReturnType<ReturnType<typeof createClient>["getHttpClient"]> | undefined;
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const waitSeconds = Math.max(1, parseInt(opts.wait ?? "120", 10) || 120);
        const client = createClient(config, { timeoutMs: replyRequestTimeoutMs(waitSeconds) });
        const http = client.getHttpClient();
        httpClient = http;

        // 1. The release has to exist, and we say plainly if an end user could not reach it.
        let release: ReleaseSummary | null = null;
        try {
          release = await http.get<ReleaseSummary>(`/white-label/${workspaceId}/release/${opts.release}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/404|not found|BAD_FORM|bad form/i.test(message)) throw error;
        }
        const usable = assertReleaseUsable(release, opts.release, { publishedOnly: Boolean(opts.publishedOnly) });
        if (usable.warning && !isJsonMode()) console.warn(colors.yellow(usable.warning));

        // 2. A conversation tied to the release (or the one we were told to continue).
        let transcriptId = opts.transcript;
        if (!transcriptId) {
          const created = await withSpinner("Creating conversation...", () =>
            http.post<{ _id: string }>(`/white-label/${workspaceId}/transcript`, {
              title: opts.title,
              releaseId: opts.release,
            }),
          );
          transcriptId = created._id;
        }

        // 3. Send with the release pinned, then wait for the reply to land.
        const messageCountBefore = await getTranscriptMessageCount(http, workspaceId, transcriptId);
        const endpoint = `/white-label/${workspaceId}/transcript/${transcriptId}/message`;
        try {
          await withSpinner("Asking...", () =>
            http.post(endpoint, {
              content: question,
              ...(opts.assistantName && { assistantName: opts.assistantName }),
              ...releaseEnvBody(opts.release),
            }),
          );
        } catch (error) {
          // The API holds the request open while the model answers; if we — or
          // Cloudflare's ~100s edge (502/504/524) — give up first, the answer
          // still lands in the transcript. Keep waiting for it.
          if (!isStillGenerating(error)) throw error;
          if (!isJsonMode()) {
            console.warn(colors.yellow(
              "The API is still generating (the request was cut off before the reply); waiting for it in the transcript...",
            ));
          }
        }

        const reply = await waitForAssistantReply({
          httpClient: http,
          workspaceId,
          transcriptId,
          messageCountBefore,
          timeoutMs: waitSeconds * 1000,
        });
        if (!reply) {
          throw new Error(
            `No assistant reply within ${waitSeconds}s. The message was accepted; it may still finish — ` +
            `check with: divinci chat history ${transcriptId}`,
          );
        }

        const citations = extractCitations(reply);
        if (isJsonMode()) {
          output({
            transcriptId,
            releaseId: opts.release,
            releaseStatus: usable.status,
            model: reply.name ?? null,
            answer: reply.content,
            citations,
          });
          return;
        }

        console.log(colors.cyanBold("Assistant: ") + reply.content);
        if (reply.name) console.log(colors.dim(`Model: ${formatServedModelLabel(reply.name)}`));
        if (citations.length > 0) {
          console.log(colors.dim("Sources:"));
          for (const line of formatCitations(citations)) console.log(colors.dim(line));
        } else {
          console.log(colors.dim("Sources: none cited"));
        }
        console.log(colors.dim(`Conversation: ${transcriptId}  (continue with --transcript ${transcriptId})`));
      } catch (error) {
        const gate = getTermsGateFromError(error);
        if (gate && httpClient) {
          const accepted = await promptAndAcceptTerms(httpClient, gate).catch(() => false);
          if (accepted) {
            console.log(colors.dim("Re-run the command to ask your question."));
            process.exit(0);
          }
          console.error(colors.red(
            "Terms of Service not accepted — question not sent. " +
            "Run the command in an interactive terminal to accept, or accept in the web app.",
          ));
          process.exit(1);
        }
        handleCommandError(error);
      }
    });
}
