# @divinci-ai/server

> Node.js SDK for full Divinci AI platform access - workspaces, releases, RAG, and more

[![npm version](https://img.shields.io/npm/v/@divinci-ai/server.svg)](https://www.npmjs.com/package/@divinci-ai/server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Installation

```bash
npm install @divinci-ai/server
# or
pnpm add @divinci-ai/server
# or
yarn add @divinci-ai/server
```

## Quick Start

```typescript
import { DivinciServer } from "@divinci-ai/server";

const divinci = new DivinciServer({
  apiKey: process.env.DIVINCI_API_KEY,
});

// List workspaces
const workspaces = await divinci.workspaces.list();

// Create a release
const release = await divinci.releases.create({
  workspaceId: "ws_abc123",
  name: "Customer Support Bot",
  systemPrompt: "You are a helpful support agent...",
});
```

## Features

- **Workspace Management** - Create, configure, and monitor workspaces
- **Release Management** - Build and deploy AI releases
- **RAG Operations** - Upload documents, manage collections, search
- **API Key Management** - Create and manage API keys for integrations
- **x402 Payments** - Blockchain payment integration for premium features
- **TypeScript** - Full type safety with comprehensive type definitions

## Usage

### Workspace Management

```typescript
// Create a workspace
const workspace = await divinci.workspaces.create({
  name: "Customer Support",
  description: "AI-powered support assistant",
});

// Update settings
await divinci.workspaces.update(workspace._id, {
  settings: {
    defaultModel: "gpt-4o",
    maxTokens: 4096,
  },
});

// Get usage statistics
const usage = await divinci.workspaces.getUsage(workspace._id);
console.log(`Messages this month: ${usage.messagesThisMonth}`);
```

### Release Management

```typescript
// Create a release
const release = await divinci.releases.create({
  workspaceId: "ws_abc123",
  name: "Support Bot v1",
  systemPrompt: `You are a helpful support agent.
    Use the provided context to answer questions.
    If you don't know, say so.`,
  config: {
    model: "gpt-4o",
    temperature: 0.7,
    contextBubbles: true,
    helpRequests: true,
  },
});

// Get analytics
const analytics = await divinci.releases.getAnalytics(release._id, {
  startDate: new Date("2025-01-01"),
  endDate: new Date(),
});
console.log(`Total conversations: ${analytics.totalConversations}`);
```

### RAG Document Management

```typescript
import fs from "fs";

// Upload a document
const doc = await divinci.rag.uploadDocument({
  workspaceId: "ws_abc123",
  ragVectorId: "rag_xyz",
  file: fs.createReadStream("./knowledge-base.pdf"),
  metadata: { category: "support" },
});

// Wait for processing
const processed = await divinci.rag.waitForProcessing(doc._id, {
  timeout: 300000, // 5 minutes
  onProgress: (status) => console.log(`${status.progress}%`),
});

// Upload from URL
await divinci.rag.uploadDocument({
  workspaceId: "ws_abc123",
  ragVectorId: "rag_xyz",
  url: "https://docs.example.com/faq",
});

// Search the collection
const results = await divinci.rag.search({
  workspaceId: "ws_abc123",
  ragVectorId: "rag_xyz",
  query: "return policy",
  limit: 5,
});
```

### API Key Management

```typescript
// Create an API key
const apiKey = await divinci.apiKeys.create({
  workspaceId: "ws_abc123",
  name: "Production Key",
  permissions: ["chat:read", "chat:write", "rag:read"],
  allowedOrigins: ["https://myapp.com"],
  rateLimit: {
    requestsPerMinute: 100,
    requestsPerDay: 10000,
  },
});

console.log("API Key:", apiKey.secretKey); // Only shown once!

// Validate a key
const validation = await divinci.apiKeys.validate(apiKey.secretKey);
console.log(`Valid: ${validation.valid}`);
console.log(`Permissions: ${validation.permissions.join(", ")}`);
```

### x402 Payment Integration

```typescript
import { createX402Wallet } from "@divinci-ai/server";

// Create a wallet for payments
const wallet = createX402Wallet({
  privateKey: process.env.WALLET_PRIVATE_KEY,
  network: "base", // or "base-sepolia" for testing
});

// Configure x402 on the client
const divinci = new DivinciServer({
  apiKey: process.env.DIVINCI_API_KEY,
  x402: {
    wallet,
    autoPayment: true,
    maxPaymentUsd: 1.0,
  },
});

// Use x402 client for payment operations
const pricing = await divinci.x402.listPricing();
const history = await divinci.x402.getPaymentHistory({ limit: 10 });
const balance = await divinci.x402.getWalletBalance();
```

## Configuration

```typescript
const divinci = new DivinciServer({
  // Required
  apiKey: process.env.DIVINCI_API_KEY,

  // Optional
  baseUrl: "https://api.divinci.app",
  timeout: 30000,
  maxRetries: 3,

  // x402 Payment Configuration
  x402: {
    wallet: createX402Wallet({ privateKey: "0x..." }),
    autoPayment: true,
    maxPaymentUsd: 5.0,
    network: "base",
  },
});
```

## API Reference

### DivinciServer

| Property | Description |
|----------|-------------|
| `workspaces` | Workspace management client |
| `releases` | Release management client |
| `rag` | RAG document and search client |
| `apiKeys` | API key management client |
| `x402` | x402 payment client |

### WorkspaceClient

| Method | Description |
|--------|-------------|
| `create(options)` | Create a new workspace |
| `get(id)` | Get workspace by ID |
| `list(options?)` | List all workspaces |
| `update(id, options)` | Update workspace settings |
| `delete(id)` | Delete a workspace |
| `getUsage(id)` | Get usage statistics |

### ReleaseClient

| Method | Description |
|--------|-------------|
| `create(options)` | Create a new release |
| `get(id)` | Get release by ID |
| `list(options?)` | List releases for workspace |
| `update(id, options)` | Update release configuration |
| `publish(id)` | Publish a release |
| `getAnalytics(id, options?)` | Get release analytics |

### RagClient

| Method | Description |
|--------|-------------|
| `uploadDocument(options)` | Upload a document |
| `waitForProcessing(docId, options?)` | Wait for document processing |
| `listDocuments(options)` | List documents in collection |
| `deleteDocument(docId)` | Delete a document |
| `search(options)` | Search documents |
| `getDocument(docId)` | Get document details |

### ApiKeyClient

| Method | Description |
|--------|-------------|
| `create(options)` | Create a new API key |
| `get(id)` | Get API key by ID |
| `list(options?)` | List API keys |
| `update(id, options)` | Update API key settings |
| `revoke(id)` | Revoke an API key |
| `validate(secretKey)` | Validate an API key |
| `getUsage(id)` | Get API key usage stats |

### X402Client

| Method | Description |
|--------|-------------|
| `listPricing()` | Get tool pricing information |
| `getPaymentHistory(options?)` | Get payment history |
| `verifyPayment(txHash)` | Verify a payment transaction |
| `getWalletBalance()` | Get wallet balance |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DIVINCI_API_KEY` | API key for authentication | Yes |
| `WALLET_PRIVATE_KEY` | Wallet key for x402 payments | For x402 |

## Related Packages

- [`@divinci-ai/client`](../client) - Browser SDK for chat integration
- [`@divinci-ai/mcp`](../mcp) - MCP protocol SDK for AI assistants
- [`@divinci-ai/types`](../types) - Shared TypeScript type definitions

## Documentation

Full documentation available at [sdk.divinci.ai](https://sdk.divinci.ai)

## License

MIT
