/**
 * FreeChatGateNamespace tests — release-configurable keyless public
 * chat flow. Mirrors the homepage-chat namespace test shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FreeChatGateNamespace } from "../../src/namespaces/free-chat-gate/index.js";
import type { HttpClient } from "../../src/http-client.js";

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    postFormData: vi.fn(),
    getToken: vi.fn(),
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearTokens: vi.fn(),
  } as unknown as HttpClient;
}

describe("FreeChatGateNamespace", () => {
  let http: HttpClient;
  let ns: FreeChatGateNamespace;

  beforeEach(() => {
    http = createMockHttpClient();
    ns = new FreeChatGateNamespace(http, {});
  });

  describe("start()", () => {
    it("captcha-only returns + stores a token immediately", async () => {
      vi.mocked(http.post).mockResolvedValue({
        status: "ready",
        mode: "captcha-only",
        nextStep: "chat",
        token: "tok-1",
      });
      const result = await ns.start({
        releaseId: "rel-a",
        turnstileToken: "ts-1",
      });
      expect(result).toMatchObject({ status: "ready", token: "tok-1" });
      expect(ns.isVerified()).toBe(true);
    });

    it("OTP/magic-link returns sent status without setting a token", async () => {
      vi.mocked(http.post).mockResolvedValue({
        status: "sent",
        mode: "captcha+otp",
        nextStep: "otp",
      });
      const result = await ns.start({
        releaseId: "rel-a",
        turnstileToken: "ts-1",
        email: "u@example.com",
      });
      expect(result.status).toBe("sent");
      expect(ns.isVerified()).toBe(false);
    });

    it("posts to /free-chat-gate/start with the body the server expects", async () => {
      vi.mocked(http.post).mockResolvedValue({
        status: "sent",
        mode: "captcha+magic-link",
        nextStep: "link",
      });
      await ns.start({
        releaseId: "rel-a",
        turnstileToken: "ts-1",
        email: "u@example.com",
        redirectTo: "https://example.com/done",
      });
      expect(http.post).toHaveBeenCalledWith(
        "/ai-chat/free-chat-gate/start",
        {
          releaseId: "rel-a",
          turnstileToken: "ts-1",
          email: "u@example.com",
          redirectTo: "https://example.com/done",
        },
        { skipValidation: true },
      );
    });
  });

  describe("verifyOtp()", () => {
    it("uses the releaseId remembered from start() when one isn't passed", async () => {
      vi.mocked(http.post).mockImplementation(async (path: string) => {
        if (path === "/ai-chat/free-chat-gate/start") {
          return { status: "sent", mode: "captcha+otp", nextStep: "otp" };
        }
        return { token: "tok-2", mode: "captcha+otp" };
      });
      await ns.start({ releaseId: "rel-a", turnstileToken: "ts-1", email: "u@example.com" });
      const result = await ns.verifyOtp({
        email: "u@example.com",
        otpCode: "123456",
      });
      expect(result.token).toBe("tok-2");
      expect(ns.isVerified()).toBe(true);
      // The /verify post should include the rel-a release id
      expect(http.post).toHaveBeenLastCalledWith(
        "/ai-chat/free-chat-gate/verify",
        { releaseId: "rel-a", email: "u@example.com", otpCode: "123456" },
        { skipValidation: true },
      );
    });

    it("throws when neither passed nor remembered releaseId is available", async () => {
      await expect(
        ns.verifyOtp({ email: "u@example.com", otpCode: "123456" }),
      ).rejects.toThrow(/releaseId/);
    });
  });

  describe("send()", () => {
    it("throws when no verified token is held", async () => {
      await expect(ns.send("hi")).rejects.toThrow(/verified/i);
    });

    it("delegates to ChatModel + tracks transcript across calls", async () => {
      // Bootstrap token via captcha-only start.
      vi.mocked(http.post).mockResolvedValueOnce({
        status: "ready",
        mode: "captcha-only",
        nextStep: "chat",
        token: "tok-1",
      });
      await ns.start({ releaseId: "rel-a", turnstileToken: "ts-1" });

      // First send.
      vi.mocked(http.post).mockResolvedValueOnce({
        transcript: [
          {
            prompt: "hi",
            promptTimestamp: 1,
            response: "hello",
            responseTimestamp: 2,
            context: [],
          },
        ],
        signiture: "sig-1",
        remaining: 1,
      });
      const r1 = await ns.send("hi");
      expect(r1.reply).toBe("hello");
      expect(r1.remaining).toBe(1);

      // Second send — transcript carries forward.
      vi.mocked(http.post).mockResolvedValueOnce({
        transcript: [
          {
            prompt: "hi",
            promptTimestamp: 1,
            response: "hello",
            responseTimestamp: 2,
            context: [],
          },
          {
            prompt: "again",
            promptTimestamp: 3,
            response: "sure",
            responseTimestamp: 4,
            context: [],
          },
        ],
        signiture: "sig-2",
        remaining: 0,
      });
      const r2 = await ns.send("again");
      expect(r2.reply).toBe("sure");
      expect(r2.remaining).toBe(0);
      // The send post should carry the prior signiture + transcript.
      expect(http.post).toHaveBeenLastCalledWith(
        "/ai-chat/free-chat-gate/chat-send",
        expect.objectContaining({
          token: "tok-1",
          prevSigniture: "sig-1",
          newPrompt: "again",
        }),
        { skipValidation: true },
      );
    });
  });

  describe("speak()", () => {
    /** Get the namespace to a verified session with one signed exchange. */
    async function withOneExchange(): Promise<void> {
      vi.mocked(http.post).mockResolvedValueOnce({
        status: "ready",
        mode: "captcha-only",
        nextStep: "chat",
        token: "tok-1",
      });
      await ns.start({ releaseId: "rel-a", turnstileToken: "ts-1" });
      vi.mocked(http.post).mockResolvedValueOnce({
        transcript: [
          {
            prompt: "hi",
            promptTimestamp: 1,
            response: "hello",
            responseTimestamp: 2,
            context: [],
          },
        ],
        signiture: "sig-1",
        remaining: 1,
      });
      await ns.send("hi");
    }

    it("throws when no verified token is held", async () => {
      await expect(ns.speak(0)).rejects.toThrow(/verified/i);
    });

    it("throws when nothing has been sent yet (no signed transcript)", async () => {
      vi.mocked(http.post).mockResolvedValueOnce({
        status: "ready",
        mode: "captcha-only",
        nextStep: "chat",
        token: "tok-1",
      });
      await ns.start({ releaseId: "rel-a", turnstileToken: "ts-1" });
      await expect(ns.speak(0)).rejects.toThrow(/signed transcript/i);
    });

    it("rejects an out-of-range index locally, without a request", async () => {
      await withOneExchange();
      vi.mocked(http.post).mockClear();
      await expect(ns.speak(5)).rejects.toThrow(/out of range/i);
      await expect(ns.speak(-1)).rejects.toThrow(/out of range/i);
      expect(http.post).not.toHaveBeenCalled();
    });

    it("POSTs the token, signed transcript and index — never raw text", async () => {
      await withOneExchange();
      vi.mocked(http.post).mockResolvedValueOnce({
        url: "https://cdn.example.com/tts-audio/a.mp3",
        mimetype: "audio/mpeg",
        voice: "phoebe",
        encoding: "mp3",
        textLength: 5,
        cached: false,
      });

      const result = await ns.speak(0);
      expect(result.url).toBe("https://cdn.example.com/tts-audio/a.mp3");
      expect(result.voice).toBe("phoebe");
      expect(result.cached).toBe(false);

      const [path, body] = vi.mocked(http.post).mock.calls.at(-1)!;
      expect(path).toBe("/ai-chat/free-chat-gate/tts");
      expect(body).toMatchObject({
        token: "tok-1",
        signiture: "sig-1",
        messageIndex: 0,
      });
      // The whole point of the index-based design: the client cannot ask the
      // server to speak text of its own choosing.
      expect(body).not.toHaveProperty("text");
      expect(body).not.toHaveProperty("voice");
    });

    it("surfaces a cache hit so callers can tell free plays from billed ones", async () => {
      await withOneExchange();
      vi.mocked(http.post).mockResolvedValueOnce({
        url: "https://cdn.example.com/tts-audio/a.mp3",
        mimetype: "audio/mpeg",
        voice: "phoebe",
        encoding: "mp3",
        textLength: 5,
        cached: true,
      });
      expect((await ns.speak(0)).cached).toBe(true);
    });
  });

  describe("state()", () => {
    it("GETs /state with releaseId + token in the query string", async () => {
      vi.mocked(http.get).mockResolvedValue({
        mode: "captcha+otp",
        allowed: true,
        used: 1,
        limit: 2,
        remaining: 1,
        expiresAt: 1_700_000_000,
      });
      // Pre-load a token from a previous verify
      ns.setToken("rel-a", "tok-1");
      const s = await ns.state();
      expect(s.allowed).toBe(true);
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining("releaseId=rel-a"),
        { skipValidation: true },
      );
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining("token=tok-1"),
        { skipValidation: true },
      );
    });

    it("throws when no token / releaseId are known", async () => {
      await expect(ns.state()).rejects.toThrow(/state\(\) requires/);
    });
  });

  describe("reset()", () => {
    it("clears token, releaseId, and transcript", async () => {
      vi.mocked(http.post).mockResolvedValueOnce({
        status: "ready",
        mode: "captcha-only",
        nextStep: "chat",
        token: "tok-1",
      });
      await ns.start({ releaseId: "rel-a", turnstileToken: "ts-1" });
      expect(ns.isVerified()).toBe(true);
      ns.reset();
      expect(ns.isVerified()).toBe(false);
      await expect(ns.send("hi")).rejects.toThrow(/verified/i);
    });
  });

  describe("getSupportedLanguages()", () => {
    it("GETs /languages with releaseId and returns the resolved set", async () => {
      vi.mocked(http.get).mockResolvedValue({
        languages: [
          { code: "en", englishName: "English", autonym: "English", dir: "ltr" },
          { code: "es", englishName: "Spanish", autonym: "Español", dir: "ltr" },
        ],
        default: "en",
      });
      const res = await ns.getSupportedLanguages("rel-a");
      expect(res.default).toBe("en");
      expect(res.languages.map((l) => l.code)).toEqual(["en", "es"]);
      expect(http.get).toHaveBeenCalledWith(
        "/ai-chat/free-chat-gate/languages?releaseId=rel-a",
        { skipValidation: true },
      );
    });
  });

  describe("setLanguage() + language-aware send()", () => {
    async function bootstrapToken() {
      vi.mocked(http.post).mockResolvedValueOnce({
        status: "ready",
        mode: "captcha-only",
        nextStep: "chat",
        token: "tok-1",
      });
      await ns.start({ releaseId: "rel-a", turnstileToken: "ts-1" });
    }
    function mockSendReply() {
      vi.mocked(http.post).mockResolvedValueOnce({
        transcript: [
          { prompt: "hi", promptTimestamp: 1, response: "hola", responseTimestamp: 2, context: [] },
        ],
        signiture: "sig-1",
        remaining: 1,
      });
    }

    it("includes the language in the send body when set", async () => {
      await bootstrapToken();
      ns.setLanguage("Spanish");
      expect(ns.getLanguage()).toBe("Spanish");
      mockSendReply();
      await ns.send("hi");
      expect(http.post).toHaveBeenLastCalledWith(
        "/ai-chat/free-chat-gate/chat-send",
        expect.objectContaining({ language: "Spanish" }),
        { skipValidation: true },
      );
    });

    it("omits language from the body when default/unset", async () => {
      await bootstrapToken();
      mockSendReply();
      await ns.send("hi");
      const body = vi.mocked(http.post).mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("language");
    });

    it("treats English (the default) as no language directive", async () => {
      await bootstrapToken();
      ns.setLanguage("English");
      expect(ns.getLanguage()).toBeNull();
      mockSendReply();
      await ns.send("hi");
      const body = vi.mocked(http.post).mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("language");
    });

    it("clears the language on reset()", async () => {
      await bootstrapToken();
      ns.setLanguage("Spanish");
      ns.reset();
      expect(ns.getLanguage()).toBeNull();
    });
  });
});
