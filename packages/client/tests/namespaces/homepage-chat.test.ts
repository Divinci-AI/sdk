/**
 * HomepageChatNamespace tests — email-gated keyless public chat flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HomepageChatNamespace } from "../../src/namespaces/homepage-chat/index.js";
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

describe("HomepageChatNamespace", () => {
  let http: HttpClient;
  let ns: HomepageChatNamespace;

  beforeEach(() => {
    http = createMockHttpClient();
    ns = new HomepageChatNamespace(http, {});
    // localStorage isn't present in node test env → setToken's try/catch no-ops.
  });

  it("verifyEmail POSTs to the verify endpoint", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "sent" });
    const r = await ns.verifyEmail("a@b.com", "tt-token");
    expect(http.post).toHaveBeenCalledWith(
      "/ai-chat/homepage-chat/verify-email",
      { email: "a@b.com", turnstileToken: "tt-token" },
      { skipValidation: true },
    );
    expect(r.status).toBe("sent");
  });

  it("confirmEmail stores the token and flips isVerified()", async () => {
    expect(ns.isVerified()).toBe(false);
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "verified", token: "tok-123", expiresInMs: 86400000 });
    const r = await ns.confirmEmail("a@b.com", "123456");
    expect(r.token).toBe("tok-123");
    expect(ns.isVerified()).toBe(true);
  });

  it("send() throws before verification", async () => {
    await expect(ns.send("hi")).rejects.toThrow(/not verified/i);
  });

  it("send() passes the token header + threads transcript/signature across calls", async () => {
    ns.setToken("tok-xyz");
    const reqMock = http.request as ReturnType<typeof vi.fn>;

    reqMock.mockResolvedValueOnce({
      transcript: [{ prompt: "q1", response: "a1", promptTimestamp: 1, responseTimestamp: 2, context: [] }],
      signiture: "sig1",
      remaining: 1,
    });
    const r1 = await ns.send("q1");
    expect(r1.reply).toBe("a1");
    expect(r1.remaining).toBe(1);
    // First call: empty prior transcript + signature, token header present.
    expect(reqMock).toHaveBeenLastCalledWith("/ai-chat/homepage-chat/message", expect.objectContaining({
      method: "POST",
      headers: { "x-divinci-email-token": "tok-xyz" },
      body: { prevSigniture: "", newPrompt: "q1", transcript: [] },
      skipValidation: true,
    }));

    reqMock.mockResolvedValueOnce({
      transcript: [
        { prompt: "q1", response: "a1", promptTimestamp: 1, responseTimestamp: 2, context: [] },
        { prompt: "q2", response: "a2", promptTimestamp: 3, responseTimestamp: 4, context: [] },
      ],
      signiture: "sig2",
      remaining: 0,
    });
    const r2 = await ns.send("q2");
    expect(r2.reply).toBe("a2");
    expect(r2.remaining).toBe(0);
    // Second call carries the prior signature + the prior transcript.
    const secondArgs = reqMock.mock.calls[1][1];
    expect(secondArgs.body.prevSigniture).toBe("sig1");
    expect(secondArgs.body.transcript).toHaveLength(1);
    expect(secondArgs.body.newPrompt).toBe("q2");
  });

  it("reset() clears verification + conversation", async () => {
    ns.setToken("tok");
    expect(ns.isVerified()).toBe(true);
    ns.reset();
    expect(ns.isVerified()).toBe(false);
    expect(ns.getTranscript()).toHaveLength(0);
  });
});
