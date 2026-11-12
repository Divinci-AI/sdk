# Divinci AI SDK Examples

Example projects demonstrating how to use the Divinci AI SDK.

## Available Examples

| Example | What it shows |
|---------|---------------|
| [`cloudflare-worker-embed-anonymous`](./cloudflare-worker-embed-anonymous) | Embed client on a Cloudflare Worker against an **anonymous** release — tabbed playground of every feature flag, optional Cloudflare Access gate |
| [`cloudflare-worker-embed-auth`](./cloudflare-worker-embed-auth) | Embed client on a Cloudflare Worker against an **auth-required** release — Divinci login flow + external-user (bring-your-own-auth) mode |

Each example is self-contained (`wrangler.toml` + `src/index.ts`): copy the
directory, set your `RELEASE_ID`, and `wrangler deploy`. Annotated
walkthrough: https://sdk.divinci.ai/embed/examples/

## Coming Soon

- **Basic Chat** - Minimal headless chat integration with `@divinci-ai/client`
- **React Integration** - Full React implementation with hooks
- **Next.js App** - Complete Next.js application with SSR
- **RAG Pipeline** - Document ingestion and search workflow
- **MCP Tool Server** - Custom MCP server implementation

## In the Meantime

Check out our documentation for code samples:
- [Getting Started](https://sdk.divinci.ai/getting-started/)
- [Client SDK Guide](https://sdk.divinci.ai/client/)
- [Server SDK Guide](https://sdk.divinci.ai/server/)
- [Embed Client Guide](https://sdk.divinci.ai/embed/)
- [MCP SDK Guide](https://sdk.divinci.ai/mcp/)

## Contributing

Want to contribute an example? See our [Contributing Guide](../CONTRIBUTING.md).
