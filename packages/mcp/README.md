# @divinci-ai/mcp

> MCP (Model Context Protocol) SDK for integrating with AI assistants like Claude Desktop and Cursor

[![npm version](https://img.shields.io/npm/v/@divinci-ai/mcp.svg)](https://www.npmjs.com/package/@divinci-ai/mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Installation

```bash
npm install @divinci-ai/mcp
# or
pnpm add @divinci-ai/mcp
# or
yarn add @divinci-ai/mcp
```

## Quick Start

```typescript
import { McpClient } from "@divinci-ai/mcp";

const client = new McpClient({
  serverUrl: "https://mcp.divinci.app",
  apiKey: "divinci_key_...",
});

// Connect to the MCP server
await client.connect();

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool("search_knowledge", {
  query: "return policy",
});
```

## Features

- **SSE Transport** - Real-time server-sent events for MCP communication
- **Auth0 Integration** - PKCE OAuth flow for browser authentication
- **Tool Invocation** - Call MCP tools with typed arguments
- **x402 Payments** - Automatic payment handling for premium tools
- **Reconnection** - Automatic reconnection with exponential backoff
- **TypeScript** - Full type safety with comprehensive type definitions

## Usage

### Connecting to MCP Server

```typescript
const client = new McpClient({
  serverUrl: "https://mcp.divinci.app",
  apiKey: "divinci_key_...",
});

// Listen for connection events
client.on("connected", () => console.log("Connected!"));
client.on("disconnected", () => console.log("Disconnected"));
client.on("error", (error) => console.error("Error:", error));

await client.connect();
```

### Tool Operations

```typescript
// List all available tools
const tools = await client.listTools();
for (const tool of tools) {
  console.log(`${tool.name}: ${tool.description}`);
  if (tool.pricing) {
    console.log(`  Price: $${tool.pricing.priceUsd}`);
  }
}

// Call a tool
const result = await client.callTool("search_knowledge", {
  query: "How do I reset my password?",
  limit: 5,
});
console.log(result.content);

// Get a specific tool's details
const tool = await client.getTool("send_message");
```

### Building Custom Tools

```typescript
import { ToolBuilder } from "@divinci-ai/mcp";

const searchTool = new ToolBuilder("advanced_search")
  .describe("Search with advanced filters")
  .addString("query", { required: true, description: "Search query" })
  .addNumber("limit", { description: "Max results", default: 10 })
  .addBoolean("exact", { description: "Exact match only" })
  .addArray("categories", "string", { description: "Filter categories" })
  .build();

console.log(searchTool.inputSchema);
```

### x402 Payment Handling

```typescript
import { McpClient, PaymentRequiredError } from "@divinci-ai/mcp";

const client = new McpClient({
  serverUrl: "https://mcp.divinci.app",
  apiKey: "divinci_key_...",
  x402: {
    autoPayment: true,
    maxPaymentUsd: 1.0,
    wallet: {
      getAddress: async () => "0x...",
      pay: async (details) => {
        // Execute payment
        return { transactionHash: "0x...", signature: "..." };
      },
    },
  },
});

// Tool calls automatically handle payment
const result = await client.callTool("premium_search", { query: "test" });
```

### Manual Payment Flow

```typescript
try {
  await client.callTool("premium_search", { query: "test" });
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    console.log(`Payment required: $${error.paymentDetails.amountUsd}`);
    console.log(`Recipient: ${error.paymentDetails.recipient}`);
    console.log(`Network: ${error.paymentDetails.network}`);

    // Handle payment manually
    const receipt = await processPayment(error.paymentDetails);

    // Retry with payment proof
    const result = await client.callTool("premium_search", {
      query: "test",
      _payment: receipt,
    });
  }
}
```

### Auth0 Browser Authentication

```typescript
import { Auth0Handler } from "@divinci-ai/mcp";

const auth = new Auth0Handler({
  domain: "auth.divinci.app",
  clientId: "your-client-id",
  redirectUri: window.location.origin + "/callback",
  audience: "https://api.divinci.app",
});

// Start login flow
await auth.login();

// Handle callback (on redirect URI)
const tokens = await auth.handleCallback();

// Use tokens with MCP client
const client = new McpClient({
  serverUrl: "https://mcp.divinci.app",
  getToken: () => auth.getAccessToken(),
});
```

### Streamable HTTP Transport (default)

`McpClient` uses Streamable HTTP at `{serverUrl}/mcp`. Divinci retired the
legacy HTTP+SSE transport (`/sse` + `/message`) on 2026-08-07 — those paths
return HTTP 410.

```typescript
import { StreamableHttpTransport } from "@divinci-ai/mcp";

const transport = new StreamableHttpTransport({
  mcpUrl: "https://mcp.divinci.app/mcp",
});
transport.setAuthToken(apiKey);
await transport.connect();
const tools = await transport.request("tools/list");
```

`SseTransport` remains exported for third-party MCP servers that still speak
HTTP+SSE, but it will not connect to `mcp.divinci.app` / `mcp.stage.divinci.app`.

## Configuration

```typescript
const client = new McpClient({
  // Required
  serverUrl: "https://mcp.divinci.app",

  // Authentication (one of these)
  apiKey: "divinci_key_...",
  getToken: async () => await fetchAccessToken(),

  // Optional
  timeout: 30000,
  reconnect: true,
  maxReconnectAttempts: 5,

  // x402 Payment Configuration
  x402: {
    autoPayment: false,
    maxPaymentUsd: 1.0,
    network: "base",
    wallet: myWallet,
  },
});
```

## API Reference

### McpClient

| Method | Description |
|--------|-------------|
| `connect()` | Connect to MCP server |
| `disconnect()` | Disconnect from server |
| `listTools()` | List available tools |
| `getTool(name)` | Get tool by name |
| `callTool(name, args)` | Call a tool |
| `on(event, handler)` | Listen for events |
| `off(event, handler)` | Remove event listener |

### McpClient Events

| Event | Description |
|-------|-------------|
| `connected` | Connected to server |
| `disconnected` | Disconnected from server |
| `reconnecting` | Attempting reconnection |
| `error` | Error occurred |
| `message` | Message received |

### StreamableHttpTransport

| Method | Description |
|--------|-------------|
| `connect()` | Mark ready (stateless; no long-lived socket) |
| `disconnect()` | Mark disconnected |
| `request(method, params?)` | POST JSON-RPC to `/mcp` |
| `notify(method, params?)` | POST notification |
| `setAuthToken(token)` | Bearer token for subsequent requests |
| `getState()` | Get connection state |

### Auth0Handler

| Method | Description |
|--------|-------------|
| `login()` | Start login flow |
| `logout()` | Clear tokens and logout |
| `handleCallback()` | Handle OAuth callback |
| `getAccessToken()` | Get current access token |
| `refreshToken()` | Refresh access token |
| `getUserInfo()` | Get authenticated user info |

### ToolBuilder

| Method | Description |
|--------|-------------|
| `describe(description)` | Set tool description |
| `addString(name, options?)` | Add string parameter |
| `addNumber(name, options?)` | Add number parameter |
| `addBoolean(name, options?)` | Add boolean parameter |
| `addArray(name, itemType, options?)` | Add array parameter |
| `build()` | Build tool schema |

### Error Types

| Error | Description |
|-------|-------------|
| `PaymentRequiredError` | x402 payment required for tool |

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "divinci": {
      "url": "https://mcp.divinci.app/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

### Cursor

Add to Cursor settings:

```json
{
  "mcp.servers": {
    "divinci": {
      "url": "https://mcp.divinci.app/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

## What is MCP?

The Model Context Protocol (MCP) is an open standard introduced by Anthropic that standardizes how AI systems integrate with external tools and data sources. It enables AI assistants to:

- Call external tools with structured arguments
- Access resources and data from external systems
- Maintain context across conversations
- Support payment for premium tools via x402

Learn more at [modelcontextprotocol.io](https://modelcontextprotocol.io)

## Related Packages

- [`@divinci-ai/client`](../client) - Browser SDK for chat integration
- [`@divinci-ai/server`](../server) - Node.js SDK for server-side operations
- [`@divinci-ai/types`](../types) - Shared TypeScript type definitions

## Documentation

Full documentation available at [sdk.divinci.ai](https://sdk.divinci.ai)

## License

MIT
