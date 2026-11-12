/**
 * Site Control (v1.4d) — SDK same-origin executor. Turns the `divinci-action`
 * directives a deployed assistant emits into real navigation on the host page.
 *
 * Flow (same-origin): fetch descriptors (`loadDescriptors`, from the public
 * gate-config endpoint) → after each assistant reply call `process(reply)` →
 * the action block is stripped from the display text and navigation runs.
 *
 * v1.4d ships NAVIGATION ONLY. Mutations (forms) are recognized but DEFERRED
 * (status "deferred") until v1.5c adds the confirm + host-execute flow — so the
 * SDK never submits anything on the user's behalf yet.
 *
 * Cross-origin embeds use a separate host-responder bridge (not this class).
 */
import { BaseNamespace } from "../base.js";
import type { SiteActionDescriptor } from "../free-chat-gate/index.js";
import { prepareReply, isSafeNavRoute, type PreparedReply } from "./resolve.js";

export type { ParsedSiteAction, ResolvedSiteAction, PreparedReply } from "./resolve.js";

/**
 * A customer-defined action handler. Receives the validated params + the
 * descriptor. For navigation, omit a handler to use the default navigator.
 */
export type SiteActionHandler = (
  params: Record<string, unknown>,
  descriptor: SiteActionDescriptor,
) => void | string | Promise<void | string>;

/**
 * Confirmation gate for a mutation (v1.5c). Receives the action + the validated
 * params (show every value — the user is the final gate on model-supplied data).
 * Return true to proceed, false to cancel. Default is `window.confirm`.
 */
export type SiteActionConfirm = (action: {
  name: string;
  params: Record<string, unknown>;
  descriptor: SiteActionDescriptor;
}) => boolean | Promise<boolean>;

export interface SiteControlExecuteResult {
  /** The reply with `divinci-action` blocks removed — render this. */
  cleanedText: string;
  executed: Array<{
    name: string;
    status: "ok" | "rejected" | "deferred" | "error" | "cancelled";
    detail?: string;
  }>;
}

/**
 * Zero-config form auto-default (v1.5): fill DECLARED params into a real form on
 * the page + submit via the form's own machinery (CSRF/hidden/validation
 * honored — never fabricate a POST). Locates the form by its `action` attribute,
 * falling back to the first form. Same-origin (SDK runs in the host page).
 */
function autoSubmitForm(action: string | undefined, params: Record<string, unknown>): { ok: boolean; detail?: string } {
  if (typeof document === "undefined") return { ok: false, detail: "no document" };
  const forms = Array.from(document.querySelectorAll("form"));
  if (!forms.length) return { ok: false, detail: "no form on page" };
  let form: HTMLFormElement | null = null;
  if (action) {
    form = forms.find((f) => {
      const a = f.getAttribute("action") || "";
      return a === action || a.endsWith(action) || f.action === action;
    }) || null;
  }
  if (!form) form = forms[0];
  const esc = (s: string): string =>
    typeof (globalThis as { CSS?: { escape?(v: string): string } }).CSS?.escape === "function"
      ? (globalThis as { CSS: { escape(v: string): string } }).CSS.escape(s)
      : s.replace(/["\\]/g, "\\$&");
  for (const [k, v] of Object.entries(params)) {
    const field = form.querySelector(`[name="${esc(k)}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (field) field.value = String(v);
  }
  try {
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Default mutation confirmation — a window.confirm showing every param value
 * (the user is the final gate on model-supplied data). Customers should set a
 * styled in-app confirm via setConfirm(). Returns false when no DOM is present.
 */
const defaultConfirm: SiteActionConfirm = ({ descriptor, params }) => {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  const lines = Object.entries(params).map(([k, v]) => `  ${k}: ${String(v)}`);
  const body = lines.length ? `\n\n${lines.join("\n")}` : "";
  return window.confirm(`The assistant wants to: ${descriptor.description}${body}\n\nProceed?`);
};

export class SiteControlNamespace extends BaseNamespace {
  private descriptors: SiteActionDescriptor[] = [];
  private handlers = new Map<string, SiteActionHandler>();
  private navigator: ((route: string) => void) | null = null;
  private confirmFn: SiteActionConfirm | null = null;
  private autoSubmitEnabled = true;

  /** Set the known descriptors (e.g. from `freeChatGate.getConfig().siteActions`). */
  setDescriptors(descriptors: SiteActionDescriptor[] | undefined | null): this {
    this.descriptors = descriptors ?? [];
    return this;
  }

  getDescriptors(): SiteActionDescriptor[] {
    return this.descriptors;
  }

  /** Fetch + cache descriptors from the public gate-config endpoint. */
  async loadDescriptors(releaseId?: string): Promise<SiteActionDescriptor[]> {
    const id = this.getReleaseId({ releaseId });
    const qs = new URLSearchParams({ releaseId: id });
    const raw = await this.httpClient.get<{ siteActions?: SiteActionDescriptor[] }>(
      `/ai-chat/free-chat-gate/config?${qs}`,
      { skipValidation: true },
    );
    this.descriptors = raw.siteActions ?? [];
    return this.descriptors;
  }

  /** Register a custom handler for an action (overrides the default behavior). */
  registerHandler(name: string, handler: SiteActionHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  /**
   * Set the confirmation gate for mutations (v1.5c). Without one, mutations are
   * DEFERRED (never auto-run). The callback should show the user every param
   * value before returning true. Pass a custom UI, or omit to use window.confirm.
   */
  setConfirm(confirm: SiteActionConfirm): this {
    this.confirmFn = confirm;
    return this;
  }

  /**
   * Toggle the zero-config form auto-default (v1.5, default ON): when a
   * submitForm mutation has no registered handler, fill + submit the matching
   * form. Set false to require an explicit handler for every mutation.
   */
  setAutoSubmit(enabled: boolean): this {
    this.autoSubmitEnabled = enabled;
    return this;
  }

  /**
   * Override how navigation happens. Default is a full page load
   * (`location.assign`) — correct for MPA sites. SPA hosts should set their
   * router here so the chat survives navigation (no reload).
   */
  setNavigator(navigate: (route: string) => void): this {
    this.navigator = navigate;
    return this;
  }

  /** Pure: parse + resolve a reply against the descriptors WITHOUT executing. */
  prepare(reply: string | undefined | null): PreparedReply {
    return prepareReply(reply, this.descriptors);
  }

  /**
   * Parse a reply, strip the action blocks, and EXECUTE navigation actions.
   * Returns the display text + a per-action status. Never throws (per-action
   * errors are captured in `executed`).
   */
  async process(reply: string | undefined | null): Promise<SiteControlExecuteResult> {
    const { cleanedText, actions } = prepareReply(reply, this.descriptors);
    const executed: SiteControlExecuteResult["executed"] = [];

    for (const a of actions) {
      const name = a.descriptor.name;
      if (!a.valid) {
        executed.push({ name, status: "rejected", detail: a.reason });
        continue;
      }
      // Mutation (v1.5c): confirmation-gated. Executes via a registered handler
      // (the customer's own fill+submit), or — when none is registered — the
      // zero-config auto-default (v1.5: fill + submit the matching real form).
      // Either way the confirm gate must approve first. A submitForm action with
      // neither a handler nor auto-submit enabled is deferred (safe).
      if (a.descriptor.category === "mutation" || a.descriptor.requiresConfirmation) {
        const handler = this.handlers.get(name);
        const canAutoSubmit = !handler && a.descriptor.target.kind === "submitForm" && this.autoSubmitEnabled;
        if (!handler && !canAutoSubmit) {
          executed.push({ name, status: "deferred", detail: "no handler registered for mutation" });
          continue;
        }
        const confirm = this.confirmFn ?? defaultConfirm;
        let approved = false;
        try {
          approved = await confirm({ name, params: a.params, descriptor: a.descriptor });
        } catch {
          approved = false;
        }
        if (!approved) {
          executed.push({ name, status: "cancelled" });
          continue;
        }
        try {
          if (handler) {
            await handler(a.params, a.descriptor);
            executed.push({ name, status: "ok" });
          } else {
            const action = a.descriptor.target.kind === "submitForm" ? a.descriptor.target.action : undefined;
            const r = autoSubmitForm(action, a.params);
            executed.push(r.ok ? { name, status: "ok" } : { name, status: "error", detail: r.detail });
          }
        } catch (e) {
          executed.push({ name, status: "error", detail: e instanceof Error ? e.message : String(e) });
        }
        continue;
      }
      try {
        const handler = this.handlers.get(name);
        if (handler) {
          await handler(a.params, a.descriptor);
          executed.push({ name, status: "ok" });
        } else if (a.descriptor.target.kind === "navigate") {
          const route = typeof a.params.route === "string" ? a.params.route : "";
          if (!route) {
            executed.push({ name, status: "error", detail: "navigate action missing route param" });
            continue;
          }
          this.navigate(route);
          executed.push({ name, status: "ok" });
        } else {
          executed.push({ name, status: "deferred", detail: "no handler registered" });
        }
      } catch (e) {
        executed.push({ name, status: "error", detail: e instanceof Error ? e.message : String(e) });
      }
    }

    return { cleanedText, executed };
  }

  private navigate(route: string): void {
    // Pure backstop (covers BOTH the custom-navigator and default paths, no DOM
    // needed): refuse anything that isn't a same-origin root-relative path —
    // blocks javascript:/data:/vbscript: (XSS) + external/protocol-relative
    // hosts (open redirect), even if a route slipped past validateActionParams.
    if (!isSafeNavRoute(route)) return;
    if (this.navigator) {
      this.navigator(route);
      return;
    }
    if (typeof window === "undefined" || !window.location) return;
    // Default-path runtime backstop: resolve against origin + require http(s)
    // same-origin before a full navigation (MPA-correct; SPA hosts override).
    let url: URL;
    try {
      url = new URL(route, window.location.origin);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    window.location.assign(url.pathname + url.search + url.hash);
  }
}
