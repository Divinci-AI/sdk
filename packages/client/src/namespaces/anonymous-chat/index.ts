import { BaseNamespace } from "../base.js";

/**
 * Anonymous chat against a release that has `allowAnonymousChat: true` — no
 * account, no email gate (unlike `homepageChat`, which is the homepage-specific
 * Turnstile+email flow, and `freeChatGate`, which is the configurable gate).
 * This is the generic "public release-backed chat" the embed/docs widgets need.
 *
 * Stateful: holds the running signed transcript + signature so a multi-turn
 * conversation works across calls (the server caps turns via the release's
 * maxAnonymousChatMessages). If the release sets requireSignedAnonymousChat,
 * the caller's proxy must add the HMAC headers (see the Cloudflare Workers
 * guide) — this namespace targets the unsigned public case.
 *
 *   const c = new DivinciClient({ apiUrl, releaseId });
 *   const { reply } = await c.anonymousChat.send("How do I install the SDK?");
 */
export interface AnonymousTranscriptMessage {
  msgPrefix?: string;
  prompt: string;
  promptTimestamp: number;
  response: string;
  responseTimestamp: number;
  context: Array<{ content: string }>;
  products?: unknown[];
  /**
   * Where the assistant text came from. `"local"` = generated on the visitor's
   * device (delegated inference) — the signature attests only that the release
   * ACCEPTED the text, not that it produced it. `"cloud"` / absent = release-
   * authored. Consumers should not present a `"local"` turn as release-authored.
   */
  provenance?: "cloud" | "local";
}

export interface AnonymousSendResult {
  reply: string;
  transcript: AnonymousTranscriptMessage[];
}

export class AnonymousChatNamespace extends BaseNamespace {
  private transcript: AnonymousTranscriptMessage[] = [];
  private signiture = "";

  /**
   * Send a message and get the assistant's reply. The release id comes from
   * the client/namespace context unless overridden via `opts.releaseId`.
   * Maintains transcript + signature continuity across calls.
   */
  async send(
    prompt: string,
    opts?: { releaseId?: string; signal?: AbortSignal },
  ): Promise<AnonymousSendResult> {
    const releaseId = this.getReleaseId(opts);
    const res = await this.httpClient.post<{
      transcript: AnonymousTranscriptMessage[];
      signiture: string;
    }>("/ai-chat/anonymous-chat", {
      releaseId,
      prevSigniture: this.signiture,
      newPrompt: prompt,
      transcript: this.transcript,
    }, { skipValidation: true, signal: opts?.signal });
    this.transcript = res.transcript || [];
    this.signiture = res.signiture || "";
    const last = this.transcript[this.transcript.length - 1];
    return { reply: last?.response ?? "", transcript: this.transcript };
  }

  /**
   * Delegated-inference turn: the release runs its full pipeline server-side
   * (RAG retrieval + persona + moderation, then post-gen style-rewrite + signed
   * transcript) and ONLY the LLM call is run by `generate` — e.g. the visitor's
   * on-device Gemma via the Divinci Local Inference extension. Same transcript
   * continuity as send(). Throws if the release is gated (use the cloud path
   * for gated releases).
   *
   *   await c.anonymousChat.sendDelegated(prompt, (messages) =>
   *     window.divinci.chat({ messages }).then((r) => r.fullText));
   */
  async sendDelegated(
    prompt: string,
    generate: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<string>,
    opts?: { releaseId?: string; signal?: AbortSignal },
  ): Promise<AnonymousSendResult> {
    const releaseId = this.getReleaseId(opts);
    // 1. PREPARE: release assembles the prompt (RAG + persona) + moderates input.
    const prep = await this.httpClient.post<{
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      context: Array<{ content: string }>;
    }>("/ai-chat/anonymous-chat/prepare", {
      releaseId,
      prevSigniture: this.signiture,
      newPrompt: prompt,
      transcript: this.transcript,
    }, { skipValidation: true, signal: opts?.signal });
    // 2. GENERATE locally (on-device).
    const response = await generate(prep.messages);
    // 3. COMPLETE: release post-gen loops + append + sign the turn.
    const res = await this.httpClient.post<{
      transcript: AnonymousTranscriptMessage[];
      signiture: string;
    }>("/ai-chat/anonymous-chat/complete", {
      releaseId,
      prevSigniture: this.signiture,
      newPrompt: prompt,
      response,
      context: prep.context,
      transcript: this.transcript,
    }, { skipValidation: true, signal: opts?.signal });
    this.transcript = res.transcript || [];
    this.signiture = res.signiture || "";
    const last = this.transcript[this.transcript.length - 1];
    return { reply: last?.response ?? "", transcript: this.transcript };
  }

  /** The running transcript (for rendering history). */
  getTranscript(): ReadonlyArray<AnonymousTranscriptMessage> {
    return this.transcript;
  }

  /**
   * Stash this conversation under a one-time handoff token so it can travel into
   * the full web app (chat.divinci.app) and be claimed via anonymous-to-owned.
   * Returns the token for the handoff URL (?divinciHandoff=<token>).
   */
  async createHandoff(opts?: { releaseId?: string }): Promise<{ token: string; expiresInSeconds: number }> {
    const releaseId = this.getReleaseId(opts);
    if (this.transcript.length === 0) {
      throw new Error("createHandoff() requires a sent message — call send() first.");
    }
    return this.httpClient.post<{ token: string; expiresInSeconds: number }>(
      "/ai-chat/handoff",
      { releaseId, prevSigniture: this.signiture, transcript: this.transcript },
      { skipValidation: true },
    );
  }

  /** Restore a prior conversation (e.g. from localStorage) so send() continues it. */
  hydrate(transcript: AnonymousTranscriptMessage[], signiture: string): void {
    this.transcript = Array.isArray(transcript) ? transcript : [];
    this.signiture = typeof signiture === "string" ? signiture : "";
  }

  /** The running signed transcript + signature (for persistence). */
  getState(): { transcript: AnonymousTranscriptMessage[]; signiture: string } {
    return { transcript: this.transcript, signiture: this.signiture };
  }

  /** Clear the conversation (e.g. "start over"). */
  reset(): void {
    this.transcript = [];
    this.signiture = "";
  }
}
