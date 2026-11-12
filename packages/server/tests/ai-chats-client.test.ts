/**
 * AiChatsClient tests (Server SDK)
 *
 * Message emoji reactions on the user-owned AIChat (OAuth) surface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiChatsClient } from "../src/ai-chats/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ status: "ok" }),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

describe("AiChatsClient", () => {
  let http: ReturnType<typeof createMockHttpClient>;
  let client: AiChatsClient;

  beforeEach(() => {
    http = createMockHttpClient();
    client = new AiChatsClient(http);
  });
  afterEach(() => vi.clearAllMocks());

  const PATH = "/ai-chat/chat%201/message/msg%202/emoji-reaction";

  it("addEmojiReaction posts { emoji, add } to the (encoded) message route", async () => {
    const r = await client.addEmojiReaction("chat 1", "msg 2", "👍");
    expect(r).toEqual({ status: "ok" });
    expect(http.post).toHaveBeenCalledWith(PATH, { emoji: "👍", add: true });
  });

  it("removeEmojiReaction posts { emoji, remove }", async () => {
    await client.removeEmojiReaction("chat 1", "msg 2", "❤️");
    expect(http.post).toHaveBeenCalledWith(PATH, { emoji: "❤️", remove: true });
  });

  it("setEmojiReaction adds when reacted=true, removes when false", async () => {
    await client.setEmojiReaction("chat 1", "msg 2", "🎉", true);
    expect(http.post).toHaveBeenLastCalledWith(PATH, { emoji: "🎉", add: true });
    await client.setEmojiReaction("chat 1", "msg 2", "🎉", false);
    expect(http.post).toHaveBeenLastCalledWith(PATH, { emoji: "🎉", remove: true });
  });
});
