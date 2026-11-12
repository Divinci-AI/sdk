// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { SiteControlNamespace } from "../src/namespaces/site-control/index.js";
import type { SiteActionDescriptor } from "../src/namespaces/free-chat-gate/index.js";

const SUBMIT: SiteActionDescriptor = {
  name: "submit_contact",
  description: "Submit the Contact form",
  category: "mutation",
  requiresConfirmation: true,
  parameters: [{ name: "email", type: "string", description: "email", required: true }],
  target: { kind: "submitForm", route: "/contact", action: "/send" },
};

function setupForm() {
  document.body.innerHTML = `
    <form id="target" action="/send">
      <input name="email" />
      <input type="hidden" name="csrf" value="KEEP" />
    </form>`;
  const form = document.getElementById("target") as HTMLFormElement;
  form.requestSubmit = vi.fn();
  return form;
}

describe("SDK SiteControl auto-default form submit (v1.5, jsdom)", () => {
  const mkClient = () => new SiteControlNamespace({} as never, {});

  it("auto-fills + submits the matching form when no handler is registered (after confirm)", async () => {
    const form = setupForm();
    const sc = mkClient().setDescriptors([SUBMIT]).setConfirm(async () => true);
    const out = await sc.process('Sending.\n\n```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(out.cleanedText).toBe("Sending.");
    expect((form.querySelector('[name="email"]') as HTMLInputElement).value).toBe("a@b.c");
    expect((form.querySelector('[name="csrf"]') as HTMLInputElement).value).toBe("KEEP"); // hidden untouched
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    expect(out.executed[0].status).toBe("ok");
  });

  it("does NOT submit when the confirm gate declines", async () => {
    const form = setupForm();
    const sc = mkClient().setDescriptors([SUBMIT]).setConfirm(async () => false);
    const out = await sc.process('```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(form.requestSubmit).not.toHaveBeenCalled();
    expect(out.executed[0].status).toBe("cancelled");
  });

  it("setAutoSubmit(false) defers when no handler is registered", async () => {
    const form = setupForm();
    const sc = mkClient().setDescriptors([SUBMIT]).setConfirm(async () => true).setAutoSubmit(false);
    const out = await sc.process('```divinci-action\n{"name":"submit_contact","params":{"email":"a@b.c"}}\n```');
    expect(form.requestSubmit).not.toHaveBeenCalled();
    expect(out.executed[0].status).toBe("deferred");
  });
});
