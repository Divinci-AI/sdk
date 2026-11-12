# @divinci-ai/types

> TypeScript type definitions for the Divinci AI SDK

[![npm](https://img.shields.io/npm/v/@divinci-ai/types.svg)](https://www.npmjs.com/package/@divinci-ai/types)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)

## Installation

```bash
npm install @divinci-ai/types
```

> **Note:** This package is automatically installed as a dependency of `@divinci-ai/client`, `@divinci-ai/server`, and `@divinci-ai/mcp`. You typically don't need to install it directly.

## Usage

```typescript
import type {
  Message,
  ChatResponse,
  Workspace,
  Release,
  RagDocument,
} from "@divinci-ai/types";

// Use types in your code
const message: Message = {
  role: "user",
  content: "Hello!",
};
```

## Available Types

### Chat Types
- `Message` - Chat message structure
- `ChatResponse` - Response from chat API
- `StreamChunk` - Streaming response chunk

### Workspace Types
- `Workspace` - Workspace configuration
- `WorkspaceSettings` - Workspace settings

### Release Types
- `Release` - Published release
- `ReleaseConfig` - Release configuration

### RAG Types
- `RagDocument` - RAG document
- `RagVector` - Vector store configuration
- `SearchResult` - Search result

### API Types
- `ApiKey` - API key structure
- `ApiError` - Error response

## Zod Schemas

This package also exports Zod schemas for runtime validation:

```typescript
import { MessageSchema, ChatResponseSchema } from "@divinci-ai/types";

// Validate at runtime
const result = MessageSchema.safeParse(unknownData);
if (result.success) {
  const message = result.data;
}
```

## Documentation

Full documentation: [sdk.divinci.ai/reference/types](https://sdk.divinci.ai/reference/types)

## License

MIT - see [LICENSE](../../LICENSE) for details.
