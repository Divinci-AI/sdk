/**
 * Client SDK ↔ live API shape oracle — the chat path.
 *
 * This is the surface the docs homepage features (`chat.create()` →
 * `chat.send(thread.id, …)`), so it must work exactly as documented.
 * Assertions encode the SDK's DECLARED types; failures = drift evidence,
 * with actual shapes captured in shape-report.json (key names + types only).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DivinciClient } from "@divinci-ai/client";
import { shouldRunIntegration, integrationConfig } from "../src/env.js";
import { getAccessToken } from "../src/auth.js";
import { discoverFixtures } from "../src/discovery.js";
import { record, flushReport } from "../src/shape-report.js";

/** Read an identifier from a wire object regardless of id/_id naming. */
function anyId(obj: unknown): string | undefined {
  const rec = obj as Record<string, unknown> | null;
  const candidate = rec?.id ?? rec?._id;
  return typeof candidate === "string" ? candidate : undefined;
}

/** Render an SDK error's diagnostic fields (no secrets) for the report. */
function errInfo(err: unknown): string {
  const e = err as { message?: string; code?: string; status?: number };
  return `code=${e.code ?? "?"} status=${e.status ?? "?"} message=${e.message ?? "?"}`;
}

describe.skipIf(!shouldRunIntegration)("client SDK chat shapes (staging)", () => {
  let client: DivinciClient;
  let releaseId: string;
  let assistantId: string | undefined;
  let createdThread: unknown;
  let threadIdOnWire: string | undefined;

  beforeAll(async () => {
    const accessToken = await getAccessToken();

    // Discover a workspace + active release the test user can chat against,
    // via the same ux endpoints the production web client uses.
    const fixtures = await discoverFixtures(accessToken);
    releaseId = fixtures.releaseId;
    assistantId = fixtures.assistantId;

    client = new DivinciClient({
      releaseId,
      userToken: accessToken,
      baseUrl: integrationConfig.apiBaseUrl,
      timeout: 45_000,
    });
  });

  afterAll(async () => {
    // Cleanup: delete the thread we created, then flush the report.
    if (threadIdOnWire) {
      try {
        await client.chat.delete(threadIdOnWire);
        console.log(`[integration] cleaned up chat ${threadIdOnWire}`);
      } catch (err) {
        console.warn(`[integration] cleanup failed: ${(err as Error).message}`);
      }
    }
    console.log(`[integration] shape report: ${flushReport()}`);
  });

  it("getRelease() returns the release with declared id field", async () => {
    let release: Record<string, unknown>;
    try {
      release = (await client.getRelease()) as unknown as Record<string, unknown>;
    } catch (err) {
      record("client.getRelease#error", {}, errInfo(err));
      throw err;
    }
    record("client.getRelease", release);
    expect(release, "getRelease() returned nothing").toBeTruthy();
    expect(typeof release.id, "declared Release.id missing on wire").toBe("string");
  });

  it("chat.create() returns ChatThread with declared id field", async () => {
    createdThread = await client.chat.create({ title: "sdk-integration-shape-test" });
    record("client.chat.create", createdThread);

    threadIdOnWire = anyId(createdThread); // captured for send/cleanup either way
    expect(createdThread, "create() returned nothing").toBeTruthy();
    expect(threadIdOnWire, "thread has neither id nor _id").toBeTruthy();

    const declaredId = (createdThread as Record<string, unknown>).id;
    expect(typeof declaredId, "declared ChatThread.id missing on wire (got _id only?)").toBe(
      "string",
    );
  });

  it("chat.send() returns SendAck { status } (replies are async)", async () => {
    expect(threadIdOnWire, "no thread to send into (create failed)").toBeTruthy();

    let response: unknown;
    try {
      // First try without assistantName — some releases require it
      response = await client.chat.send(
        threadIdOnWire!,
        "Integration shape test — reply with one word.",
      );
    } catch (firstErr) {
      record("client.chat.send#error(no-assistant)", {}, errInfo(firstErr));
      try {
        response = await client.chat.send(
          threadIdOnWire!,
          "Integration shape test — reply with one word.",
          assistantId ? { assistantName: assistantId } : {},
        );
      } catch (secondErr) {
        record("client.chat.send#error(with-assistant)", {}, errInfo(secondErr));
        throw secondErr;
      }
    }
    record("client.chat.send", response);

    // send() now correctly declares SendAck — the wire sends { status: "sent" }
    const rec = response as Record<string, unknown>;
    expect(typeof rec.status, "SendAck.status missing on wire").toBe("string");
  });

  it(
    "chat.stream() resolves with the final assistant message",
    { timeout: 150_000 }, // staging inference latency is variable (up to ~90s observed)
    async () => {
      expect(threadIdOnWire, "no thread to stream into (create failed)").toBeTruthy();

      const chunks: string[] = [];
      let finalMessage: unknown;
      try {
        finalMessage = await client.chat.stream(
          threadIdOnWire!,
          "Reply with exactly the word: pong",
          {
            ...(assistantId ? { assistantName: assistantId } : {}),
            onChunk: (text) => chunks.push(text),
          },
        );
      } catch (err) {
        record("client.chat.stream#error", {}, errInfo(err));
        throw err;
      }
      // Chunk count and content length are recorded, not asserted: replies on
      // this platform are primarily delivered over the live WebSocket, and the
      // POST-SSE path delivers content variably on staging (observed both a
      // full reply and an empty envelope across runs). The envelope itself —
      // a ChatMessage with string content — is the stable contract.
      const message = finalMessage as Record<string, unknown>;
      record(
        "client.chat.stream",
        finalMessage,
        `chunks=${chunks.length} contentLength=${String(message.content ?? "").length}`,
      );

      expect(
        typeof message.content,
        "declared ChatMessage.content missing on stream result",
      ).toBe("string");
    },
  );

  it("chat.getTranscript() returns ChatMessage[] with declared fields", async () => {
    expect(threadIdOnWire, "no thread to read (create failed)").toBeTruthy();

    const messages = await client.chat.getTranscript(threadIdOnWire!);
    record("client.chat.getTranscript", messages);

    expect(Array.isArray(messages), "declared ChatMessage[] not an array").toBe(true);
    if (messages.length > 0) {
      const first = messages[0] as unknown as Record<string, unknown>;
      expect(typeof first.content, "declared ChatMessage.content missing").toBe("string");
      expect(typeof first.role, "declared ChatMessage.role missing").toBe("string");
    }
  });
});
