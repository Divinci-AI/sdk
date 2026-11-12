/**
 * send() and stream() must post to the contract the transcript accepts.
 *
 * There are two, and they are not interchangeable:
 *
 *   POST /ai-chat/:id/message         tree-capable; REFUSES a linear
 *                                     transcript with 403
 *   POST /ai-chat/:id/linear-message  linear
 *
 * The SDK always used the first, so every chat create() made was unsendable:
 * new transcripts are linear. Reproduced against a local stack on 2026-09-20 —
 * a release-bound chat from this exact create() reports transcript.isLinear
 * true, /message returns
 *
 *   403 {"message":"forbidden","context":"addChatMessage cannot write to a
 *        linear transcript yet — it does not maintain the linear chain or take
 *        part in the linear concurrency guard."}
 *
 * and /linear-message returns {"status":"ok"}. It surfaced as sdk/chat
 * chat-crud and sdk/websocket chat-websocket failing with a bare
 * "DivinciError: forbidden", which names nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatClient } from "../src/chat/index.js";
import { HttpClient } from "../src/http-client.js";

function mockHttp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ status: "ok" }),
    getToken: vi.fn().mockResolvedValue("test-token"),
    getBaseUrl: vi.fn().mockReturnValue("https://api.divinci.app"),
    ...overrides,
  } as unknown as HttpClient;
}

/** GET /ai-chat/:id answering with a given linearity. */
function getReturning(isLinear: boolean | undefined) {
  return vi.fn().mockResolvedValue({
    chat: { _id: "chat-1", title: "t" },
    ...(isLinear === undefined ? {} : { transcript: { _id: "tr-1", isLinear } }),
  });
}

describe("send() routes by transcript linearity", () => {
  let http: HttpClient;

  beforeEach(() => {
    http = mockHttp({ get: getReturning(true) });
  });

  afterEach(() => vi.restoreAllMocks());

  it("posts a LINEAR transcript to /linear-message", async () => {
    const chat = new ChatClient(http, "release-1");
    await chat.send("chat-1", "hello", { assistantName: "gpt-4o-mini" });
    expect(http.post).toHaveBeenCalledWith(
      "/ai-chat/chat-1/linear-message",
      expect.objectContaining({ content: "hello", stream: false }),
    );
  });

  it("posts a TREE transcript to /message", async () => {
    const tree = mockHttp({ get: getReturning(false) });
    const chat = new ChatClient(tree, "release-1");
    await chat.send("chat-1", "hello", { assistantName: "gpt-4o-mini" });
    expect(tree.post).toHaveBeenCalledWith(
      "/ai-chat/chat-1/message",
      expect.anything(),
    );
  });

  it("falls back to /message when linearity cannot be determined", async () => {
    // A server that does not report it, and one that errors outright: both
    // must behave exactly as callers did before routing existed, rather than
    // guessing "linear" and 400ing a tree transcript.
    for (const get of [getReturning(undefined), vi.fn().mockRejectedValue(new Error("boom"))]) {
      const h = mockHttp({ get });
      await new ChatClient(h, "r").send("chat-1", "hi", { assistantName: "a" });
      expect(h.post).toHaveBeenCalledWith("/ai-chat/chat-1/message", expect.anything());
    }
  });

  it("learns linearity ONCE per chat, not on every send", async () => {
    const chat = new ChatClient(http, "release-1");
    await chat.send("chat-1", "one", { assistantName: "a" });
    await chat.send("chat-1", "two", { assistantName: "a" });
    await chat.send("chat-1", "three", { assistantName: "a" });
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(3);
  });

  it("asks separately for a DIFFERENT chat — linearity is per transcript", async () => {
    const chat = new ChatClient(http, "release-1");
    await chat.send("chat-1", "a", { assistantName: "a" });
    await chat.send("chat-2", "b", { assistantName: "a" });
    expect(http.get).toHaveBeenCalledTimes(2);
  });
});

describe("the cache is primed, so the common path costs no extra round trip", () => {
  afterEach(() => vi.restoreAllMocks());

  it("create() then send() issues NO GET when create reported linearity", async () => {
    const http = mockHttp({
      get: vi.fn(),
      post: vi
        .fn()
        .mockResolvedValueOnce({
          chat: { _id: "chat-9", title: "t" },
          transcript: { isLinear: true },
        })
        .mockResolvedValue({ status: "ok" }),
    });
    const chat = new ChatClient(http, "release-1");
    const created = await chat.create({ title: "t" });
    await chat.send(created.id, "hello", { assistantName: "a" });

    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).toHaveBeenLastCalledWith(
      "/ai-chat/chat-9/linear-message",
      expect.anything(),
    );
  });

  it("get() primes it too", async () => {
    const http = mockHttp({ get: getReturning(true) });
    const chat = new ChatClient(http, "release-1");
    await chat.get("chat-1");
    await chat.send("chat-1", "hello", { assistantName: "a" });
    // The one GET is the caller's own get(), not a second lookup.
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      "/ai-chat/chat-1/linear-message",
      expect.anything(),
    );
  });
});

describe("stream() uses the same contract as send()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams a linear transcript to /linear-message", async () => {
    const http = mockHttp({ get: getReturning(true) });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({ start: (c) => c.close() }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // The stream terminates with no "done" event; what is asserted is the URL
    // it opened, so a rejection here is not a failure of this test.
    await new ChatClient(http, "r").stream("chat-1", "hi", { assistantName: "a" }).catch(() => {});

    expect(fetchMock).toHaveBeenCalled();
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/ai-chat/chat-1/linear-message");
    expect(url).not.toContain("/ai-chat/chat-1/message");
  });
});
