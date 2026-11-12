---
name: divinci
description: >-
  Build with the Divinci AI platform — the @divinci-ai/cli, @divinci-ai/client
  (browser), @divinci-ai/server (Node.js), and @divinci-ai/mcp SDKs, plus the
  raw REST API at api.divinci.app. Use when integrating Divinci chat, RAG
  knowledge bases, releases, workspaces, embeds, or MCP tools into an app, or
  when running `divinci` CLI commands.
---

# Divinci AI SDK & CLI

Divinci is a white-label AI assistant platform: you create a **workspace**,
attach **RAG knowledge** (files, sites, catalogs), and publish a **release**
(a configured assistant) that end users reach via web chat, embeds, phone,
or MCP. Everything is scriptable via CLI, SDKs, and REST.

## Picking the right surface

| You are... | Use | Reference |
|---|---|---|
| Scripting, CI/CD, terminal exploration | `@divinci-ai/cli` (`divinci` command) | [references/cli.md](references/cli.md) |
| Building a browser/web chat UI | `@divinci-ai/client` | [references/client-sdk.md](references/client-sdk.md) |
| Backend automation (workspaces, releases, RAG ingest, keys) | `@divinci-ai/server` | [references/server-sdk.md](references/server-sdk.md) |
| Connecting an AI assistant (Claude, Cursor) to Divinci | `@divinci-ai/mcp` or the hosted MCP server | [references/mcp.md](references/mcp.md) |
| An endpoint not covered by the SDKs | `divinci api <METHOD> <path>` or raw fetch against `https://api.divinci.app` | [references/cli.md](references/cli.md) |

All packages are MIT-licensed, TypeScript-first, and published on npm.
Docs: https://sdk.divinci.ai · Source: https://github.com/Divinci-AI/sdk

## Authentication (all surfaces)

- Get an API key from the Divinci dashboard (Workspace → API Keys).
- CLI: `divinci auth login` (stored in `~/.config/divinci/credentials.json`,
  mode 0600, supports named `--profile`s).
- SDKs: pass `apiKey` in the constructor; in CI use `DIVINCI_API_KEY` and
  `DIVINCI_WORKSPACE_ID` env vars.
- Never embed a server API key in browser code. For public pages use the
  client SDK's keyless flows (embed release tokens, or the email-gated
  `homepageChat` namespace) — see references/client-sdk.md.

Config resolution order (CLI): flags → env vars → `.divinci/config.json`
(project) → `~/.config/divinci/credentials.json` (user).

## Core concepts

- **Workspace** (`ws_…`) — the tenant container: members, keys, billing, RAG.
- **Release** (`rel_…`) — a published assistant: system prompt, model config,
  attached RAG vectors, theming, tools. What end users actually talk to.
- **RAG vector / target** — a knowledge collection. Standard chunking by
  default; advanced tools (`raptor`, `lightrag`) selectable at creation.
  RAPTOR build-time knobs (tree depth, cluster size, summary model) are
  immutable after creation — re-create the vector to change them.
- **Transcript** — a conversation. Messages can be sent interactively,
  streamed, or batch-ingested (for inference performed elsewhere).
- **MCP server** — every release can be exposed as an MCP server so external
  assistants can query its knowledge and tools.

## Quick starts

CLI:

```bash
npm install -g @divinci-ai/cli
divinci auth login
divinci workspace list
divinci workspace use ws_abc123
divinci rag search "refund policy" --json
```

Browser chat:

```typescript
import { DivinciClient } from "@divinci-ai/client";
const client = new DivinciClient({ releaseId: "rel_…", apiKey: "…" });
for await (const chunk of client.chat.stream("Hello")) {
  render(chunk.content);
}
```

Server automation:

```typescript
import { DivinciServer } from "@divinci-ai/server";
const divinci = new DivinciServer({ apiKey: process.env.DIVINCI_API_KEY });
const ws = await divinci.workspaces.create({ name: "Support" });
const release = await divinci.releases.create({
  workspaceId: ws._id,
  name: "Support Bot v1",
  systemPrompt: "You are a helpful support agent…",
});
```

## Conventions & gotchas

- Every CLI command supports `--json` for machine-readable output — always
  prefer it when scripting (`divinci workspace list --json | jq '.[].id'`).
- Large RAG file uploads: don't hold the request open (`awaitEmbedding`)
  for big files — upload fire-and-forget, then poll file status
  (`divinci rag status <fileId>` or the vector's
  `chunkSources[]`/`pendingChunkSources[]`/`failedChunkSources[]` arrays).
- Do not mix embedding models within one RAG vector; the vector's
  `embeddingModel` set at creation is the source of truth.
- Handle non-2xx and non-JSON responses defensively: read `response.text()`
  first, then `JSON.parse` in a try/catch (proxies can return HTML error
  pages). SDK methods throw typed errors — catch `DivinciError` subclasses.
- Node.js >= 22.14 for the CLI; SDKs support Node 18+.
