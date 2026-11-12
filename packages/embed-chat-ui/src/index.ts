/**
 * @divinci-ai/embed-chat-ui — the open-source, framework-agnostic "Ask Divinci"
 * chat widget for a Divinci AI Release. Extracted from the sdk.divinci.ai docs
 * assistant so any docs site (Starlight, plain HTML, any framework) can embed it
 * with one `mount()` call.
 *
 *   import { mount } from "@divinci-ai/embed-chat-ui";
 *   mount(document.body, { releaseId, apiUrl });
 *
 * The pure render/classify/reaction helpers are exported too — they're DOM-free
 * and unit-tested, and are the extraction boundary this package grew from.
 */
export * from "./pure.js";
export * from "./session.js";
export { mount } from "./widget.js";
export type { MountOptions, WidgetController } from "./widget.js";
