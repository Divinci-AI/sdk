import { describe, it, expect, vi } from "vitest";
import { createDivinciBridge, type DivinciExtensionApi, type CloudChat } from "../src/index";

function fakeExt(over: Partial<DivinciExtensionApi> = {}): DivinciExtensionApi {
  return {
    protocolVersion: 1,
    ping: async () => ({ extensionVersion: "1.0.0", supportedModels: ["gemma-4-e2b"] }),
    requestAccess: async (s) => s,
    chat: async () => ({ fullText: "from extension", tokensGenerated: 3, durationMs: 10 }),
    agentCard: async () => ({ name: "Divinci Local Agent" }),
    task: async () => ({ kind: "task", status: { state: "completed" } }),
    ...over,
  };
}

const cloudChat: CloudChat = async () => ({ fullText: "from cloud" });
const req = { messages: [{ role: "user" as const, content: "hi" }] };

describe("detect", () => {
  it("reports present + metadata when the extension answers ping", async () => {
    const b = createDivinciBridge({ win: { divinci: fakeExt() } });
    expect(await b.detect()).toEqual({ present: true, extensionVersion: "1.0.0", supportedModels: ["gemma-4-e2b"] });
  });

  it("reports absent when no extension", async () => {
    const b = createDivinciBridge({ win: {} });
    expect(await b.detect()).toEqual({ present: false });
  });

  it("reports absent when ping hangs past the timeout", async () => {
    const hang = fakeExt({ ping: () => new Promise(() => {}) });
    const b = createDivinciBridge({ win: { divinci: hang }, probeTimeoutMs: 20 });
    expect(await b.detect()).toEqual({ present: false });
  });

  it("hasExtension is a synchronous presence check", () => {
    expect(createDivinciBridge({ win: { divinci: fakeExt() } }).hasExtension()).toBe(true);
    expect(createDivinciBridge({ win: {} }).hasExtension()).toBe(false);
  });
});

describe("chat dispatch", () => {
  it("prefers the extension when present", async () => {
    const b = createDivinciBridge({ win: { divinci: fakeExt() }, cloudChat });
    expect(await b.chat(req)).toEqual({ fullText: "from extension", source: "extension" });
  });

  it("falls back to cloud when no extension", async () => {
    const b = createDivinciBridge({ win: {}, cloudChat });
    expect(await b.chat(req)).toEqual({ fullText: "from cloud", source: "cloud" });
  });

  it("throws when neither extension nor cloud is available", async () => {
    const b = createDivinciBridge({ win: {} });
    await expect(b.chat(req)).rejects.toThrow(/No Divinci extension/);
  });

  it("passes handlers through to the chosen backend", async () => {
    const onToken = vi.fn();
    const cloudSpy = vi.fn(cloudChat);
    const b = createDivinciBridge({ win: {}, cloudChat: cloudSpy });
    await b.chat(req, { onToken });
    expect(cloudSpy).toHaveBeenCalledWith(req, { onToken });
  });
});

describe("extension-only surfaces", () => {
  it("requestAccess returns [] without an extension (no throw)", async () => {
    const b = createDivinciBridge({ win: {} });
    expect(await b.requestAccess(["chat"])).toEqual([]);
  });

  it("requestAccess passes through to the extension", async () => {
    const b = createDivinciBridge({ win: { divinci: fakeExt() } });
    expect(await b.requestAccess(["chat", "a2a"])).toEqual(["chat", "a2a"]);
  });

  it("agentCard + task reject without an extension", async () => {
    const b = createDivinciBridge({ win: {} });
    await expect(b.agentCard()).rejects.toThrow(/No Divinci extension/);
    await expect(b.task("x")).rejects.toThrow(/No Divinci extension/);
  });

  it("agentCard + task pass through when present", async () => {
    const b = createDivinciBridge({ win: { divinci: fakeExt() } });
    expect(await b.agentCard()).toEqual({ name: "Divinci Local Agent" });
    expect(await b.task("hi")).toMatchObject({ kind: "task" });
  });
});
