type TranscriptHttpClient = {
  get: <T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ) => Promise<T>,
};

export type TranscriptMessageRow = {
  role: string,
  content: string,
  name?: string,
  timestamp?: number,
  /** Present on RAG-backed replies; see release-chat.ts extractCitations. */
  citedSources?: string[],
  sources?: string[],
  context?: Array<{ content?: string, metadata?: Record<string, unknown> }>,
};

type TranscriptPayload = {
  messages?: TranscriptMessageRow[],
};

/**
 * Poll until a new assistant message appears (add-message is async on the API).
 */
export async function waitForAssistantReply(args: {
  httpClient: TranscriptHttpClient,
  workspaceId: string,
  transcriptId: string,
  messageCountBefore: number,
  timeoutMs: number,
  pollIntervalMs?: number,
}): Promise<TranscriptMessageRow | null> {
  const { httpClient, workspaceId, transcriptId, messageCountBefore, timeoutMs } = args;
  const pollIntervalMs = args.pollIntervalMs ?? 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const data = await httpClient.get<TranscriptPayload>(
      `/white-label/${workspaceId}/transcript/${transcriptId}`,
    );
    const messages = data.messages ?? [];
    if (messages.length > messageCountBefore) {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant" && (last.content?.length ?? 0) > 0) {
        return last;
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return null;
}

export async function getTranscriptMessageCount(
  httpClient: TranscriptHttpClient,
  workspaceId: string,
  transcriptId: string,
): Promise<number> {
  const data = await httpClient.get<TranscriptPayload>(
    `/white-label/${workspaceId}/transcript/${transcriptId}`,
  );
  return data.messages?.length ?? 0;
}
