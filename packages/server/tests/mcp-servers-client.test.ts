import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServersClient } from "../src/mcp-servers/index.js";
import { ServerHttpClient } from "../src/http-client.js";

function mockHttp() {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({ id: "m1" }),
    put: vi.fn(),
    patch: vi.fn().mockResolvedValue({ id: "m1" }),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

describe("McpServersClient", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: McpServersClient;
  beforeEach(() => { http = mockHttp(); client = new McpServersClient(http); });
  afterEach(() => vi.clearAllMocks());

  it("list → GET /api/v1/mcp-servers", async () => {
    await client.list();
    expect(http.get).toHaveBeenCalledWith("/api/v1/mcp-servers");
  });
  it("create → POST with the input body", async () => {
    await client.create({ name: "Acme", transport: "http", url: "https://x/mcp", authType: "bearer", authToken: "t" });
    expect(http.post).toHaveBeenCalledWith("/api/v1/mcp-servers", {
      name: "Acme", transport: "http", url: "https://x/mcp", authType: "bearer", authToken: "t",
    });
  });
  it("update/get/remove hit the encoded id path", async () => {
    await client.get("m 1");
    expect(http.get).toHaveBeenLastCalledWith("/api/v1/mcp-servers/m%201");
    await client.update("m 1", { enabled: false });
    expect(http.patch).toHaveBeenCalledWith("/api/v1/mcp-servers/m%201", { enabled: false });
    await client.remove("m 1");
    expect(http.delete).toHaveBeenCalledWith("/api/v1/mcp-servers/m%201");
  });
});
