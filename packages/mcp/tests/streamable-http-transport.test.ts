/**
 * StreamableHttpTransport tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamableHttpTransport } from "../src/transport/streamable-http.js";

describe("StreamableHttpTransport", () => {
  const mcpUrl = "https://mcp.divinci.app/mcp";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connect marks the transport ready without a network call", async () => {
    const transport = new StreamableHttpTransport({ mcpUrl });
    await transport.connect();
    expect(transport.getState()).toBe("connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("request POSTs JSON-RPC to /mcp and returns result", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: { tools: [{ name: "ping" }] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const transport = new StreamableHttpTransport({ mcpUrl });
    transport.setAuthToken("divinci_test");
    await transport.connect();

    const result = await transport.request<{ tools: Array<{ name: string }> }>(
      "tools/list",
    );
    expect(result.tools[0].name).toBe("ping");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(mcpUrl);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer divinci_test");
    expect(headers.Accept).toContain("application/json");
    const body = JSON.parse(init.body as string) as {
      method: string;
      jsonrpc: string;
    };
    expect(body.method).toBe("tools/list");
    expect(body.jsonrpc).toBe("2.0");
  });

  it("throws a clear error on 410 Gone (retired SSE path)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "gone",
          error_description: "legacy SSE retired",
        }),
        { status: 410, headers: { "Content-Type": "application/json" } },
      ),
    );

    const transport = new StreamableHttpTransport({
      mcpUrl: "https://mcp.divinci.app/sse",
    });
    await transport.connect();
    await expect(transport.request("tools/list")).rejects.toThrow(/410 Gone/);
  });

  it("surfaces MCP error objects", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          error: { code: -32000, message: "Unauthorized" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const transport = new StreamableHttpTransport({ mcpUrl });
    await transport.connect();
    await expect(transport.request("tools/list")).rejects.toThrow("Unauthorized");
  });

  it("rejects requests when disconnected", async () => {
    const transport = new StreamableHttpTransport({ mcpUrl });
    await expect(transport.request("tools/list")).rejects.toThrow(
      /Cannot send request/,
    );
  });
});
