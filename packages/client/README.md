# @divinci-ai/client

> Browser SDK for integrating Divinci AI chat capabilities into web applications

[![npm version](https://img.shields.io/npm/v/@divinci-ai/client.svg)](https://www.npmjs.com/package/@divinci-ai/client)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Installation

```bash
npm install @divinci-ai/client
# or
pnpm add @divinci-ai/client
# or
yarn add @divinci-ai/client
```

## Quick Start

```typescript
import { DivinciClient } from "@divinci-ai/client";

const client = new DivinciClient({
  releaseId: "rel_your-release-id",
  apiKey: "divinci_key_...",
});

// Send a message
const response = await client.chat.send("What is machine learning?");
console.log(response.content);
```

## Features

- **Headless Chat** - Full control over chat UI and UX
- **Streaming Responses** - Real-time token-by-token streaming via SSE
- **RAG Context** - Access retrieved document sources in responses
- **Token Management** - Automatic refresh with secure storage
- **TypeScript** - Full type safety with comprehensive type definitions
- **Error Handling** - Typed errors for graceful failure handling

## Usage

### Homepage free-chat (email-gated, keyless)

For a public, email-gated chat (e.g. a marketing-site homepage assistant) where
you can't embed an API key. A visitor verifies an email with a 6-digit OTP to
earn a short-lived token; the release is pinned server-side.

```typescript
const client = new DivinciClient({
  releaseId: "rel_homepage",            // public; release is pinned server-side anyway
  baseUrl: "https://api.divinci.app",
});

// 1. Send a code (gated by a Cloudflare Turnstile token from the widget)
await client.homepageChat.verifyEmail("visitor@example.com", turnstileToken);

// 2. Confirm the code — stores the verification token (in-memory + localStorage)
await client.homepageChat.confirmEmail("visitor@example.com", "123456");

// 3. Chat — transcript + per-email quota handled for you
const { reply, remaining } = await client.homepageChat.send("What is Divinci?");
console.log(reply, `(${remaining} free messages left)`);

// On later page loads, restore the token instead of re-verifying:
if (client.homepageChat.loadStoredToken()) {
  await client.homepageChat.send("...");
}
```

No API key is required for this namespace — the verified-email token is the
credential, so it's safe to run from a fully public static site.

### Streaming Responses

```typescript
for await (const chunk of client.chat.stream("Tell me a story")) {
  process.stdout.write(chunk.content);
}
```

### Chat with Context Bubbles (RAG)

```typescript
const response = await client.chat.send("What's your return policy?", {
  includeContext: true,
});

console.log("Answer:", response.content);
console.log("Sources:", response.context?.map(c => c.fileName));
```

### Message Feedback & Ratings

Capture thumbs up/down and free-text feedback on an assistant reply. Negative
feedback is routed to the white-label's configured notification channels — a
consolidated daily email digest plus real-time Slack/webhook.

```typescript
// Owned (authenticated) chat — thumbs vote (-1 = down, 1 = up, 0 = clear)
await client.chat.rateMessage(chatId, messageId, -1);

// Free-text feedback (the thumbs-down dropdown)
await client.chat.submitMessageFeedback(chatId, messageId, {
  feedback: "The answer missed the warranty terms.",
  sentiment: -1,
});

// Anonymous (landing-page) chat — authenticity is proven by the held signed transcript
await client.chat.submitAnonymousFeedback({
  releaseId,
  transcript,
  signiture,
  messageIndex: 0,
  sentiment: -1,
  feedback: "Not quite right",
});

// Free-Chat Gate consumers — uses the gate's internally-held signed transcript
await client.freeChatGate.submitFeedback(0, { sentiment: -1, feedback: "…" });
```

> Only negative or feedback-bearing submissions are recorded server-side; a
> positive-only vote is a no-op for anonymous/gate flows.

### Managing Chat Threads

```typescript
// Create a new chat thread
const chat = await client.chat.create({
  title: "Support Session",
  metadata: { ticketId: "TICKET-123" },
});

// Send messages in the thread
await chat.send("I need help with my order");
await chat.send("Order #12345");

// Get transcript
const messages = await chat.getMessages();
```

### External User Authentication

```typescript
const client = new DivinciClient({
  releaseId: "rel_abc123",
  apiKey: "divinci_key_...",
  externalUser: {
    id: "user_123",
    email: "user@example.com",
    name: "John Doe",
    tier: "premium",
  },
});
```

### Error Handling

```typescript
import {
  DivinciClient,
  RateLimitError,
  QuotaExceededError,
  AuthenticationError,
  NetworkError,
  TimeoutError,
  StreamError,
} from "@divinci-ai/client";

try {
  await client.chat.send("Hello!");
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof QuotaExceededError) {
    console.log(`Quota exceeded. Upgrade to ${error.suggestedTier}`);
  } else if (error instanceof AuthenticationError) {
    console.log("Invalid or expired credentials");
  } else if (error instanceof NetworkError || error instanceof TimeoutError) {
    // Transient — safe to retry with backoff, or fall through to a local provider
    console.warn("Transient upstream failure; retry recommended");
  } else if (error instanceof StreamError) {
    // SSE connection dropped mid-stream — partial content may already be rendered
    console.warn("Stream interrupted; reconnect or surface partial result to user");
  }
}
```

## Configuration

```typescript
const client = new DivinciClient({
  // Required
  releaseId: "rel_abc123",

  // Authentication (one of these)
  apiKey: "divinci_key_...",
  getToken: async () => fetchTokenFromBackend(),

  // Optional
  baseUrl: "https://api.divinci.app",
  timeout: 30000,
  maxRetries: 3,

  // External user context
  externalUser: {
    id: "user_123",
    email: "user@example.com",
  },

  // Token storage (for refresh tokens)
  tokenStorage: {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
  },
});
```

## API Reference

### DivinciClient

| Method | Description |
|--------|-------------|
| `chat.send(content, options?)` | Send a message and get response |
| `chat.stream(content, options?)` | Stream response tokens |
| `chat.create(options?)` | Create new chat thread |
| `chat.get(chatId)` | Get existing chat thread |
| `chat.list(options?)` | List user's chat threads |

### Errors

| Error | Status | Description |
|-------|--------|-------------|
| `AuthenticationError` | 401 | Invalid or expired credentials |
| `RateLimitError` | 429 | Too many requests |
| `QuotaExceededError` | 402 | Usage quota exceeded |
| `PaymentRequiredError` | 402 | x402 payment needed |
| `ValidationError` | 400 | Invalid request parameters |
| `NotFoundError` | 404 | Resource not found |
| `NetworkError` | - | Connection failure |
| `StreamError` | - | SSE stream error |
| `TimeoutError` | - | Request timeout |

## Runtime Support

**Browsers:**

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

**Server / edge runtimes:**

- Node.js 18+ (native `fetch`)
- Cloudflare Workers (V8 isolate, `fetch`-based; supply your own `tokenStorage` since `localStorage` is not available)
- Bun, Deno (any runtime with WHATWG `fetch` and `ReadableStream`)

The SDK has no DOM dependencies — it uses `fetch`, `ReadableStream`, and `TextDecoder` only. Pass a custom `tokenStorage` adapter when running outside the browser.

## Related Packages

- [`@divinci-ai/server`](../server) - Node.js SDK for server-side operations
- [`@divinci-ai/mcp`](../mcp) - MCP protocol SDK for AI assistants
- [`@divinci-ai/types`](../types) - Shared TypeScript type definitions

## Documentation

Full documentation available at [sdk.divinci.ai](https://sdk.divinci.ai)

## License

MIT
