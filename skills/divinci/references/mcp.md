# MCP reference — Divinci over Model Context Protocol

Two distinct things:

1. **The hosted Divinci MCP server** (`https://mcp.divinci.app`) — connect
   Claude Desktop / Claude Code / Cursor / any MCP client to your Divinci
   account. Tools cover chat, RAG search + upload, releases, workspaces, QA,
   analytics, TrustBench, and more.
2. **`@divinci-ai/mcp`** — a TypeScript client SDK for programmatically
   connecting to Divinci MCP servers from your own apps/agents.

## Connecting an assistant (hosted server)

Streamable HTTP endpoint: `https://mcp.divinci.app/mcp`. Auth is OAuth
(browser flow) or a Divinci API key depending on the client.

The legacy HTTP+SSE paths (`/sse`, `/message`) return **HTTP 410 Gone** as of
2026-08-07. Use `/mcp` only. Dynamic Client Registration (`POST /register`) is
also retired — clients should use CIMD (URL-shaped `client_id`) or a
pre-registered first-party client.

Claude Code:

```bash
claude mcp add divinci --transport http https://mcp.divinci.app/mcp
```

Full tool catalog and per-client setup: https://sdk.divinci.ai/mcp/connect-assistant

User-owned skills (e.g. `email-user`) are managed over MCP too — see the
`user_skills_*` tools and [Email tool](./email.md).

### Releases as MCP servers

Every Divinci release can be exposed as its own scoped MCP server, so an
external assistant can search that release's knowledge and call its tools
without full-account access. See https://sdk.divinci.ai/mcp/whitelabel-servers

## Programmatic client (`@divinci-ai/mcp`)

```bash
npm install @divinci-ai/mcp
```

```typescript
import { McpClient } from "@divinci-ai/mcp";

const client = new McpClient({
  serverUrl: "https://mcp.divinci.app",
  apiKey: "divinci_key_…",
});

await client.connect();                 // Streamable HTTP POST /mcp
const tools = await client.listTools();
const result = await client.callTool("search_knowledge", {
  query: "return policy",
});
```

Features: Streamable HTTP transport (default), Auth0 PKCE OAuth for browser
auth, typed tool invocation, and automatic x402 payment handling for premium
tools.

## Tool families on the hosted server

chat/threads · rag (search, upload, files) · releases · workspace ·
audio-transcripts · qa · fine-tune/training-data · analytics/metrics ·
feedback · notifications · phone-usage · style-pattern ·
skills catalog · terms · trust (TrustBench: `trust_run`, `trust_verify`,
`trust_list_runs`, `trust_list_benchmarks`, …) · red-team (`red_team_plan`,
`red_team_run` — one category per call against a deployed release) ·
hermes agents · connectors · memory · export · tts/voiceprints

Tools are permission-scoped by your API key/OAuth grant; a tool you lack
permission for returns a structured permission error rather than appearing
absent.
