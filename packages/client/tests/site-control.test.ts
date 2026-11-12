import { describe, it, expect, vi } from "vitest";
import { prepareReply, parseSiteActionDirectives, validateActionParams, isSafeNavRoute } from "../src/namespaces/site-control/resolve.js";
import { SiteControlNamespace } from "../src/namespaces/site-control/index.js";
import type { SiteActionDescriptor } from "../src/namespaces/free-chat-gate/index.js";

const NAV: SiteActionDescriptor = {
  name: "navigate_site",
  description: "Navigate",
  category: "navigation",
  requiresConfirmation: false,
  parameters: [{ name: "route", type: "string", description: "dest", required: true, enum: ["/", "/server/rag"] }],
  target: { kind: "navigate" },
};
const SUBMIT: SiteActionDescriptor = {
  name: "submit_contact",
  description: "Submit contact",
  category: "mutation",
  requiresConfirmation: true,
  parameters: [{ name: "email", type: "string", description: "email", required: true }],
  target: { kind: "submitForm", route: "/contact" },
};

describe("parseSiteActionDirectives (SDK)", () => {
  it("extracts the block and strips it from display text", () => {
    const r = parseSiteActionDirectives('go\n\n```divinci-action\n{"name":"navigate_site","params":{"route":"/server/rag"}}\n```');
    expect(r.actions).toEqual([{ name: "navigate_site", params: { route: "/server/rag" } }]);
    expect(r.cleanedText).toBe("go");
  });
  it("ignores malformed JSON", () => {
    const r = parseSiteActionDirectives("x\n```divinci-action\n{bad}\n```");
    expect(r.actions).toEqual([]);
    expect(r.cleanedText).toBe("x");
  });
});

describe("validateActionParams (SDK)", () => {
  it("rejects an enum value not in the allowlist (untrusted-output gate)", () => {
    const v = validateActionParams(NAV, { route: "/evil" });
    expect(v.valid).toBe(false);
  });
  it("accepts a listed enum value + drops undeclared params", () => {
    const v = validateActionParams(NAV, { route: "/server/rag", isAdmin: true });
    expect(v.valid).toBe(true);
    expect(v.params).toEqual({ route: "/server/rag" });
  });
  it("flags a missing required param", () => {
    const v = validateActionParams(SUBMIT, {});
    expect(v.valid).toBe(false);
  });
});

describe("isSafeNavRoute — XSS / open-redirect guard", () => {
  it("accepts same-origin root-relative paths", () => {
    expect(isSafeNavRoute("/")).toBe(true);
    expect(isSafeNavRoute("/server/rag")).toBe(true);
    expect(isSafeNavRoute("/a?b=1#c")).toBe(true);
  });
  it("rejects schemes, external hosts, protocol-relative + backslash tricks", () => {
    expect(isSafeNavRoute("javascript:alert(1)")).toBe(false);
    expect(isSafeNavRoute("data:text/html,x")).toBe(false);
    expect(isSafeNavRoute("https://evil.com")).toBe(false);
    expect(isSafeNavRoute("//evil.com")).toBe(false);
    expect(isSafeNavRoute("/\\evil.com")).toBe(false);
    expect(isSafeNavRoute("relative")).toBe(false);
    expect(isSafeNavRoute(123)).toBe(false);
  });
});

describe("validateActionParams — navigate route safety", () => {
  it("rejects a javascript: route even if it somehow lacks an enum", () => {
    const noEnum: SiteActionDescriptor = {
      ...NAV,
      parameters: [{ name: "route", type: "string", description: "dest", required: true }], // no enum
    };
    const v = validateActionParams(noEnum, { route: "javascript:alert(document.cookie)" });
    expect(v.valid).toBe(false);
  });
});

describe("prepareReply (SDK)", () => {
  it("drops directives whose name is unknown to the client", () => {
    const r = prepareReply('```divinci-action\n{"name":"delete_all","params":{}}\n```', [NAV]);
    expect(r.actions).toEqual([]);
  });
  it("resolves a known directive against its descriptor", () => {
    const r = prepareReply('```divinci-action\n{"name":"navigate_site","params":{"route":"/server/rag"}}\n```', [NAV]);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].valid).toBe(true);
    expect(r.actions[0].params).toEqual({ route: "/server/rag" });
  });
});

describe("SiteControlNamespace.process", () => {
  const mkClient = () => new SiteControlNamespace({} as never, {});

  it("navigates via the injected navigator and returns cleaned text", async () => {
    const nav = vi.fn();
    const sc = mkClient().setDescriptors([NAV]).setNavigator(nav);
    const out = await sc.process('Sure.\n\n```divinci-action\n{"name":"navigate_site","params":{"route":"/server/rag"}}\n```');
    expect(out.cleanedText).toBe("Sure.");
    expect(nav).toHaveBeenCalledWith("/server/rag");
    expect(out.executed).toEqual([{ name: "navigate_site", status: "ok" }]);
  });

  it("does not navigate for a mutation directive (navigation path is separate)", async () => {
    const nav = vi.fn();
    // auto-submit off + no handler → deferred (no DOM touched); proves the
    // mutation never goes through the navigation path.
    const sc = mkClient().setDescriptors([SUBMIT]).setNavigator(nav).setAutoSubmit(false);
    const out = await sc.process('```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(nav).not.toHaveBeenCalled();
    expect(out.executed[0].status).toBe("deferred");
  });

  it("rejects an off-allowlist route without navigating", async () => {
    const nav = vi.fn();
    const sc = mkClient().setDescriptors([NAV]).setNavigator(nav);
    const out = await sc.process('```divinci-action\n{"name":"navigate_site","params":{"route":"/evil"}}\n```');
    expect(nav).not.toHaveBeenCalled();
    expect(out.executed[0].status).toBe("rejected");
  });

  it("prefers a registered custom handler over the default navigator", async () => {
    const nav = vi.fn();
    const handler = vi.fn();
    const sc = mkClient().setDescriptors([NAV]).setNavigator(nav).registerHandler("navigate_site", handler);
    await sc.process('```divinci-action\n{"name":"navigate_site","params":{"route":"/server/rag"}}\n```');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(nav).not.toHaveBeenCalled();
  });

  it("v1.5c: runs a mutation only after the confirm gate approves + a handler exists", async () => {
    const handler = vi.fn();
    const confirm = vi.fn(async () => true);
    const sc = mkClient().setDescriptors([SUBMIT]).registerHandler("submit_contact", handler).setConfirm(confirm);
    const out = await sc.process('```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ email: "a@b.c" }, SUBMIT);
    expect(out.executed[0].status).toBe("ok");
  });

  it("v1.5c: cancels the mutation when the confirm gate declines", async () => {
    const handler = vi.fn();
    const sc = mkClient().setDescriptors([SUBMIT]).registerHandler("submit_contact", handler).setConfirm(async () => false);
    const out = await sc.process('```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(handler).not.toHaveBeenCalled();
    expect(out.executed[0].status).toBe("cancelled");
  });

  it("v1.5c: defers a no-handler mutation when auto-submit is disabled (SDK never fabricates a submit)", async () => {
    const sc = mkClient().setDescriptors([SUBMIT]).setConfirm(async () => true).setAutoSubmit(false);
    const out = await sc.process('```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(out.executed[0].status).toBe("deferred");
  });

  it("is a no-op for a plain reply", async () => {
    const nav = vi.fn();
    const sc = mkClient().setDescriptors([NAV]).setNavigator(nav);
    const out = await sc.process("Just an answer.");
    expect(out).toEqual({ cleanedText: "Just an answer.", executed: [] });
    expect(nav).not.toHaveBeenCalled();
  });
});
