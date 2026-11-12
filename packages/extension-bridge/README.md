# @divinci-ai/extension-bridge

Talk to the **Divinci Local Inference** browser extension from any website — run
AI chat **on the user's device** (private, free, no server round-trip) — with an
automatic fallback to the Divinci cloud API when the extension isn't installed.

Pure TypeScript, zero Divinci-internal dependencies, works in any browser.

## Install

```bash
npm install @divinci-ai/extension-bridge
```

## Usage

```ts
import { createDivinciBridge } from "@divinci-ai/extension-bridge";

// cloudChat is your existing cloud path (e.g. wired to @divinci-ai/client).
// Omit it to require the extension.
const divinci = createDivinciBridge({ cloudChat });

const { fullText, source } = await divinci.chat(
  { messages: [{ role: "user", content: "Summarize this page." }] },
  { onToken: (delta) => append(delta) },
);
console.log(source); // "extension" (on-device) or "cloud"
```

The first time a site runs `chat()` through the extension, the user sees a
one-time in-page consent prompt ("Allow example.com to run AI chat on your
device?"). Grants are per-origin and revocable from the extension popup.

### Detect the extension

```ts
const { present, extensionVersion, supportedModels } = await divinci.detect();
if (present) showOnDeviceBadge();
```

### Advanced surfaces (extension only)

```ts
await divinci.requestAccess(["chat"]);   // pre-warm the consent prompt
const card = await divinci.agentCard();  // the local agent's A2A Agent Card
const task = await divinci.task("...");  // submit an A2A task to the local agent
```

`agentCard()` / `task()` reject when no extension is present; `requestAccess()`
returns `[]`. `hasExtension()` is a synchronous presence check.

## How it works

The extension injects `window.divinci` (a MAIN-world content script). This SDK is
a thin, dependency-injected dispatcher over it: extension-first, cloud-fallback.
All dispatch logic is pure (the `window` and `cloudChat` are options), so it's
fully testable without a browser. See the server repo's
`strategy/2026-06-28-extension-open-programmatic-api.md` for the full design.
