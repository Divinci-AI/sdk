# Divinci AI SDK

> Official SDKs for integrating Divinci AI into your applications

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@divinci-ai/cli`](./packages/cli) | Official CLI for managing workspaces, chat, RAG, and releases | [![npm](https://img.shields.io/npm/v/@divinci-ai/cli.svg)](https://www.npmjs.com/package/@divinci-ai/cli) |
| [`@divinci-ai/client`](./packages/client) | Browser SDK for headless chat integration | [![npm](https://img.shields.io/npm/v/@divinci-ai/client.svg)](https://www.npmjs.com/package/@divinci-ai/client) |
| [`@divinci-ai/server`](./packages/server) | Node.js SDK for full platform access | [![npm](https://img.shields.io/npm/v/@divinci-ai/server.svg)](https://www.npmjs.com/package/@divinci-ai/server) |
| [`@divinci-ai/mcp`](./packages/mcp) | MCP protocol SDK for AI assistants | [![npm](https://img.shields.io/npm/v/@divinci-ai/mcp.svg)](https://www.npmjs.com/package/@divinci-ai/mcp) |
| [`@divinci-ai/types`](./packages/types) | Shared TypeScript type definitions | [![npm](https://img.shields.io/npm/v/@divinci-ai/types.svg)](https://www.npmjs.com/package/@divinci-ai/types) |
| [`@divinci-ai/embed-chat-ui`](./packages/embed-chat-ui) | Framework-agnostic embeddable chat widget for a Divinci Release | [![npm](https://img.shields.io/npm/v/@divinci-ai/embed-chat-ui.svg)](https://www.npmjs.com/package/@divinci-ai/embed-chat-ui) |
| [`@divinci-ai/extension-bridge`](./packages/extension-bridge) | Talk to the Divinci Local Inference browser extension, with cloud fallback | [![npm](https://img.shields.io/npm/v/@divinci-ai/extension-bridge.svg)](https://www.npmjs.com/package/@divinci-ai/extension-bridge) |
| [`@divinci-ai/robot-avatar`](./packages/robot-avatar) | The Divinci robot mascot as a react-three-fiber component | [![npm](https://img.shields.io/npm/v/@divinci-ai/robot-avatar.svg)](https://www.npmjs.com/package/@divinci-ai/robot-avatar) |
| [`@divinci-ai/trustbench-verifier`](./packages/trustbench-verifier) | Verify signed TrustBench benchmark run manifests (browser, Node, Workers, Deno) | [![npm](https://img.shields.io/npm/v/@divinci-ai/trustbench-verifier.svg)](https://www.npmjs.com/package/@divinci-ai/trustbench-verifier) |

Also here: the [documentation site](./docs) behind [sdk.divinci.ai](https://sdk.divinci.ai), [examples](./examples), and the [`divinci` agent skill](./skills/divinci).

## Quick Start

### Browser Chat (Client SDK)

```typescript
import { DivinciClient } from "@divinci-ai/client";

const client = new DivinciClient({
  releaseId: "rel_your-release-id",
  apiKey: "divinci_key_...",
});

// Simple message
const response = await client.chat.send("What is machine learning?");
console.log(response.content);

// Streaming
for await (const chunk of client.chat.stream("Tell me a story")) {
  process.stdout.write(chunk.content);
}
```

### Server-Side Operations (Server SDK)

```typescript
import { DivinciServer } from "@divinci-ai/server";

const divinci = new DivinciServer({
  apiKey: process.env.DIVINCI_API_KEY,
});

// Manage workspaces
const workspace = await divinci.workspaces.create({
  name: "My AI Assistant",
});

// Upload documents to RAG
await divinci.rag.uploadDocument({
  workspaceId: workspace._id,
  ragVectorId: "rag_xyz",
  file: fs.createReadStream("./knowledge.pdf"),
});

// Create and publish a release
const release = await divinci.releases.create({
  workspaceId: workspace._id,
  name: "Support Bot v1",
  systemPrompt: "You are a helpful assistant...",
});
```

### MCP Integration (MCP SDK)

```typescript
import { McpClient } from "@divinci-ai/mcp";

const client = new McpClient({
  serverUrl: "https://mcp.divinci.app",
  apiKey: "divinci_key_...",
});

await client.connect();

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool("search_knowledge", {
  query: "return policy",
});
```

## Which SDK Do I Need?

| Use Case | SDK | Example |
|----------|-----|---------|
| Terminal chat & management | `@divinci-ai/cli` | `divinci chat`, `divinci rag search` |
| Chat widget in browser | `@divinci-ai/client` | React app, Vue app |
| Custom chat UI | `@divinci-ai/client` | Headless chat integration |
| Backend API integration | `@divinci-ai/server` | Express, Fastify, NestJS |
| RAG document management | `@divinci-ai/server` | Document upload, search |
| Workspace administration | `@divinci-ai/server` | Create workspaces, releases |
| Claude Desktop integration | `@divinci-ai/mcp` | MCP tool access |
| Cursor AI integration | `@divinci-ai/mcp` | MCP tool access |
| x402 payment handling | `@divinci-ai/mcp` or `@divinci-ai/server` | Premium tool payments |

## SDK Comparison

| Feature | CLI | Client | Server | MCP |
|---------|-----|--------|--------|-----|
| Environment | Terminal | Browser | Node.js | Both |
| Chat Messages | Yes | Yes | - | Yes |
| Streaming | Yes | Yes | Yes | - |
| Workspace Management | Yes | - | Yes | - |
| Release Management | Yes | - | Yes | - |
| RAG Operations | Yes | - | Yes | Yes |
| API Key Management | - | - | Yes | - |
| x402 Payments | - | - | Yes | Yes |
| Auth0 PKCE | - | Yes | - | Yes |
| MCP Protocol | - | - | - | Yes |
| Raw API Access | Yes | - | Yes | - |

## Installation

```bash
# CLI (global install)
npm install -g @divinci-ai/cli

# Browser SDK
npm install @divinci-ai/client

# Server SDK
npm install @divinci-ai/server

# MCP SDK
npm install @divinci-ai/mcp
```

## Authentication

### API Key (Recommended for Server)

```typescript
const divinci = new DivinciServer({
  apiKey: process.env.DIVINCI_API_KEY,
});
```

### API Key + External User (Embed)

```typescript
const client = new DivinciClient({
  releaseId: "rel_abc123",
  apiKey: "divinci_key_...",
  externalUser: {
    id: "user_123",
    email: "user@example.com",
    tier: "premium",
  },
});
```

### JWT Token (Browser with Backend)

```typescript
const client = new DivinciClient({
  releaseId: "rel_abc123",
  getToken: async () => {
    const res = await fetch("/api/divinci-token");
    return res.json().token;
  },
});
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

### Project Structure

```
├── packages/            # the nine @divinci-ai/* npm packages
├── docs/                # sdk.divinci.ai (Astro + Starlight)
├── examples/            # runnable examples
├── skills/divinci/      # agent skill for Claude Code and other agents
├── templates/           # starter templates
└── tests/integration/   # contract tests against a live API (needs credentials)
```

## Documentation

Full documentation available at [sdk.divinci.ai](https://sdk.divinci.ai)

- [Getting Started](https://sdk.divinci.ai/getting-started/)
- [Client SDK Guide](https://sdk.divinci.ai/client/)
- [Server SDK Guide](https://sdk.divinci.ai/server/)
- [MCP SDK Guide](https://sdk.divinci.ai/mcp/)
- [API Reference](https://sdk.divinci.ai/reference/)

## Examples

- [`examples/cloudflare-worker-embed-anonymous`](./examples/cloudflare-worker-embed-anonymous) — embed chat for anonymous visitors from a Cloudflare Worker
- [`examples/cloudflare-worker-embed-auth`](./examples/cloudflare-worker-embed-auth) — the same, for signed-in users
- [Landing-page template](https://github.com/Divinci-AI/divinci-landing-template) — Astro + Cloudflare Worker marketing page, re-skinnable via one `brand.config.ts`

More code samples live in the [documentation](https://sdk.divinci.ai).

## Related

- [Divinci Platform](https://divinci.app) - Main platform
- [Embed Script](https://sdk.divinci.ai/embed) - Drop-in chat widget
- [API Documentation](https://api.divinci.app/docs) - REST API reference

## Contributing

Issues and pull requests are welcome here. This repository is published from
Divinci's internal monorepo: a maintainer applies an accepted pull request
there, and the next sync brings it back here with your authorship credited.
See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT - see [LICENSE](./LICENSE) for details.
