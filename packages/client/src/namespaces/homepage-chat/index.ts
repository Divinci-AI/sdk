/**
 * Homepage free-chat namespace — the email-gated public chat (e.g. the
 * divinci.ai homepage assistant).
 *
 * Unlike the rest of the SDK this flow is **keyless**: instead of an API key it
 * uses a short-lived signed token earned by verifying an email with a 6-digit
 * OTP (so it's safe to run from a fully public static site without exposing any
 * secret). The release is PINNED server-side, so no releaseId is sent on
 * messages — the public endpoint can only ever drive the homepage assistant.
 *
 * Flow:
 *   await c.homepageChat.verifyEmail(email, turnstileToken); // emails a code
 *   await c.homepageChat.confirmEmail(email, code);          // stores the token
 *   const { reply, remaining } = await c.homepageChat.send("What is Divinci?");
 *
 * The namespace manages the running transcript + signature internally (the
 * server uses a signed-transcript anonymous protocol), so callers just call
 * send() repeatedly.
 */
import { BaseNamespace } from "../base.js";

const TOKEN_STORAGE_KEY = "divinci-homepage-chat-token";

/** One turn of the signed anonymous transcript (server shape). */
export interface HomepageTranscriptMessage {
  msgPrefix?: string;
  prompt: string;
  promptTimestamp: number;
  response: string;
  responseTimestamp: number;
  context: Array<{ content: string }>;
  products?: unknown[];
}

export interface HomepageVerifyResult { status: string }
export interface HomepageConfirmResult { status: string; token: string; expiresInMs: number }
export interface HomepageSendResult {
  reply: string;
  remaining: number;
  transcript: HomepageTranscriptMessage[];
}

export class HomepageChatNamespace extends BaseNamespace {
  private token: string | null = null;
  private transcript: HomepageTranscriptMessage[] = [];
  private signiture = "";

  /** Step 1: send a 6-digit OTP to `email` (gated by a Cloudflare Turnstile token). */
  async verifyEmail(email: string, turnstileToken: string): Promise<HomepageVerifyResult> {
    return this.httpClient.post<HomepageVerifyResult>("/ai-chat/homepage-chat/verify-email", {
      email,
      turnstileToken,
    }, { skipValidation: true });
  }

  /**
   * Step 2: confirm the OTP. On success the verification token is stored
   * in-memory (and in localStorage when available) and used automatically by
   * send().
   */
  async confirmEmail(email: string, code: string): Promise<HomepageConfirmResult> {
    const res = await this.httpClient.post<HomepageConfirmResult>("/ai-chat/homepage-chat/confirm-email", {
      email,
      code,
    }, { skipValidation: true });
    this.setToken(res.token);
    return res;
  }

  /**
   * Step 3: send a chat message. Requires a verified token (confirmEmail or
   * setToken). Maintains the transcript/signature across calls.
   *
   * @throws if no verification token is set, or the per-email/per-device quota
   *   is exhausted (the rejection carries the server's friendly "sign up" CTA).
   */
  async send(prompt: string): Promise<HomepageSendResult> {
    if (!this.token) {
      throw new Error("Email not verified. Call confirmEmail() (or setToken()) before send().");
    }
    const res = await this.httpClient.request<{
      transcript: HomepageTranscriptMessage[];
      signiture: string;
      remaining: number;
    }>("/ai-chat/homepage-chat/message", {
      method: "POST",
      headers: { "x-divinci-email-token": this.token },
      body: { prevSigniture: this.signiture, newPrompt: prompt, transcript: this.transcript },
      skipValidation: true,
    });
    this.transcript = res.transcript || [];
    this.signiture = res.signiture || "";
    const last = this.transcript[this.transcript.length - 1];
    return { reply: last?.response ?? "", remaining: res.remaining ?? 0, transcript: this.transcript };
  }

  /** True once an email has been verified (token present). */
  isVerified(): boolean {
    return this.token !== null;
  }

  /** Restore a previously-issued token (e.g. from localStorage on page load). */
  setToken(token: string): void {
    this.token = token;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch { /* storage may be unavailable / blocked */ }
  }

  /** Load a token from localStorage if present (browser). Returns whether one was found. */
  loadStoredToken(): boolean {
    try {
      if (typeof localStorage !== "undefined") {
        const t = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (t) { this.token = t; return true; }
      }
    } catch { /* ignore */ }
    return false;
  }

  /** The running transcript (for rendering history). */
  getTranscript(): ReadonlyArray<HomepageTranscriptMessage> {
    return this.transcript;
  }

  /** Clear token + conversation (e.g. on "start over" / sign-out). */
  reset(): void {
    this.token = null;
    this.transcript = [];
    this.signiture = "";
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch { /* ignore */ }
  }
}
