# @divinci-ai/embed-chat-ui

The open-source, framework-agnostic **"Ask Divinci"** chat widget for a Divinci
AI Release. It's the same headless implementation that powers
[sdk.divinci.ai](https://sdk.divinci.ai) — extracted so any documentation site
(Starlight, plain HTML, or any framework) can embed it with one call.

> Part of **Divinci Docs**: drop the assistant onto your existing docs, or
> generate a whole docs site with it built in.

## Install

```bash
npm install @divinci-ai/embed-chat-ui @divinci-ai/client
```

## Use

```ts
import { mount } from "@divinci-ai/embed-chat-ui";

const widget = mount(document.body, {
  releaseId: "your-divinci-release-id",
  apiUrl: "https://api.divinci.app",
});
// widget.open() / widget.close() / widget.reset() / widget.destroy()
```

No account or API key is needed in the browser — the widget talks to a Divinci
**Release** through public anonymous-chat endpoints, with an optional Cloudflare
Turnstile bot gate resolved from the Release config at runtime.

## Theming

The widget styles itself with `--divinci-*` CSS custom properties (with neutral
fallbacks). On a Starlight site, map them to the theme tokens:

```css
#divinci-docs-assistant {
  --divinci-accent: var(--sl-color-accent);
  --divinci-bg: var(--sl-color-bg);
  /* … */
}
```

## What you get

Anonymous RAG chat with grouped citations + a sources panel, a full-height
collapsible dock (with center-expand), per-message copy / read-aloud / emoji
reactions, conversation persistence, "continue in the app" + coding-agent
handoff (with live-docs MCP snippets), and a Stop control — all driven by your
Release's content and config.

## License

MIT © Divinci AI. Published only after Divinci's security review (see the
repository's open-source readiness notes).
