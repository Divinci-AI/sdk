# Browser SDK reference (`@divinci-ai/client`)

Headless chat SDK for web apps — you own the UI, the SDK handles transport,
auth, streaming, and RAG context. ESM-only.

```bash
npm install @divinci-ai/client
```

## Basic chat

```typescript
import { DivinciClient } from "@divinci-ai/client";

const client = new DivinciClient({
  releaseId: "rel_your-release-id",
  apiKey: "divinci_key_…",        // omit for keyless flows (below)
  baseUrl: "https://api.divinci.app", // optional override
});

const response = await client.chat.send("What is machine learning?");
console.log(response.content);
console.log(response.sources);     // RAG documents used for the answer
```

## Streaming (SSE)

```typescript
for await (const chunk of client.chat.stream("Tell me a story")) {
  appendToUI(chunk.content);
}
```

Streaming is token-by-token; abort by breaking out of the loop or passing an
`AbortSignal` where supported.

## Keyless public flows

Never ship a server API key to the browser. For public sites:

**Email-gated homepage chat** — visitor verifies an email via 6-digit OTP;
the short-lived token is the credential and the release is pinned server-side:

```typescript
const client = new DivinciClient({ releaseId: "rel_homepage" });

await client.homepageChat.verifyEmail("visitor@example.com", turnstileToken);
await client.homepageChat.confirmEmail("visitor@example.com", "123456");
const { reply, remaining } = await client.homepageChat.send("What is Divinci?");

// On later page loads:
if (client.homepageChat.loadStoredToken()) { /* skip re-verification */ }
```

**Embeds** — for a drop-in widget instead of headless integration, use the
embed script from your release's Embed settings; it handles the free-chat
gate (Turnstile) and tokens for you.

## Namespaces

Beyond `chat` and `homepageChat`, the client exposes namespaces for
transcripts/history, RAG search, realtime (WebSocket) events, notifications,
analytics, and metrics. See https://sdk.divinci.ai/client/namespaces for the
current list; each mirrors the REST surface.

## Errors

SDK methods throw typed errors (auth, rate-limit, validation, network).
Catch and branch on the error class/`status` rather than parsing messages.
Rate-limited requests include retry information — back off and retry.
