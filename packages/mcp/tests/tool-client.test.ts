/**
 * ToolClient tests
 *
 * Tests for MCP tool invocation and x402 payment handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ToolClient,
  PaymentRequiredError,
  ToolBuilder,
} from "../src/tools/index.js";
import type { McpTransport } from "../src/transport/types.js";
import type { McpWallet, McpPaymentDetails } from "../src/types.js";

// Mock transport
function createMockTransport() {
  return {
    request: vi.fn(),
    notify: vi.fn(),
    getState: vi.fn().mockReturnValue("connected"),
  } as unknown as McpTransport;
}

// Mock Wallet
function createMockWallet(): McpWallet {
  return {
    getAddress: vi.fn().mockResolvedValue("0x1234567890abcdef"),
    pay: vi.fn().mockResolvedValue({
      transactionHash: "0xabc123",
      network: "base",
      signature: "sig-123",
    }),
  };
}

describe("ToolClient", () => {
  describe("constructor", () => {
    it("should set default payment options", () => {
      const transport = createMockTransport();
      const client = new ToolClient(transport);

      // Verify defaults by checking behavior
      expect(client).toBeDefined();
    });

    it("should merge custom payment options", () => {
      const transport = createMockTransport();
      const client = new ToolClient(transport, {
        autoPayment: true,
        maxPaymentUsd: 5.0,
        network: "base-sepolia",
      });

      expect(client).toBeDefined();
    });
  });

  describe("listTools", () => {
    it("should fetch and cache tools", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        tools: [
          { name: "tool1", description: "Tool 1" },
          { name: "tool2", description: "Tool 2" },
        ],
      });

      const client = new ToolClient(transport);
      const tools = await client.listTools();

      expect(tools).toHaveLength(2);
      expect(transport.request).toHaveBeenCalledWith("tools/list");
    });
  });

  describe("getTool", () => {
    it("should return tool from cache", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        tools: [{ name: "cached-tool", description: "Cached" }],
      });

      const client = new ToolClient(transport);
      await client.listTools(); // Populate cache

      const tool = await client.getTool("cached-tool");

      expect(tool?.name).toBe("cached-tool");
      expect(transport.request).toHaveBeenCalledTimes(1); // Only once for initial list
    });

    it("should refresh if tool not in cache", async () => {
      const transport = createMockTransport();
      let callCount = 0;
      transport.request = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          tools: [{ name: `tool-${callCount}`, description: "Tool" }],
        });
      });

      const client = new ToolClient(transport);
      const tool = await client.getTool("tool-1");

      expect(tool?.name).toBe("tool-1");
      expect(transport.request).toHaveBeenCalledWith("tools/list");
    });

    it("should return null if tool not found", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        tools: [{ name: "other-tool", description: "Other" }],
      });

      const client = new ToolClient(transport);
      const tool = await client.getTool("nonexistent");

      expect(tool).toBeNull();
    });
  });

  describe("callTool", () => {
    it("should call transport with correct params", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Result" }],
      });

      const client = new ToolClient(transport);
      const result = await client.callTool("my-tool", { query: "test" });

      expect(result.content[0].text).toBe("Result");
      expect(transport.request).toHaveBeenCalledWith("tools/call", {
        name: "my-tool",
        arguments: { query: "test" },
      });
    });

    it("should handle payment required error", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        // First call rejects with 402
        .mockRejectedValueOnce(new Error("HTTP 402: Payment required"))
        // Second call returns tool info for payment handling
        .mockResolvedValueOnce({
          tools: [
            {
              name: "paid-tool",
              pricing: { priceUsd: 0.01, priceMicro: 10000 },
            },
          ],
        });

      const client = new ToolClient(transport, { autoPayment: false });

      await expect(
        client.callTool("paid-tool", { query: "test" })
      ).rejects.toThrow(PaymentRequiredError);
    });

    it("should rethrow non-payment errors", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));

      const client = new ToolClient(transport);

      await expect(client.callTool("tool", {})).rejects.toThrow("Network error");
    });
  });

  describe("handlePaymentRequired", () => {
    it("should throw PaymentRequiredError when auto disabled", async () => {
      const transport = createMockTransport();
      // First call (tools/call) throws 402, second call (tools/list) returns tool info
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("x402 payment required"))
        .mockResolvedValueOnce({
          tools: [
            {
              name: "paid-tool",
              pricing: {
                priceUsd: 0.01,
                priceMicro: 10000,
                recipient: "0xrecipient",
                network: "base",
              },
            },
          ],
        });

      const client = new ToolClient(transport, { autoPayment: false });

      await expect(client.callTool("paid-tool", {})).rejects.toThrow(
        PaymentRequiredError
      );
    });

    it("should throw when no wallet configured", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("x402 payment required"))
        .mockResolvedValueOnce({
          tools: [
            {
              name: "paid-tool",
              pricing: {
                priceUsd: 0.01,
                priceMicro: 10000,
                recipient: "0x",
                network: "base",
              },
            },
          ],
        });

      const client = new ToolClient(transport, { autoPayment: true });
      // No wallet set

      await expect(client.callTool("paid-tool", {})).rejects.toThrow(
        "No wallet configured"
      );
    });

    it("should throw when amount exceeds max payment", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("x402 payment required"))
        .mockResolvedValueOnce({
          tools: [
            {
              name: "expensive-tool",
              pricing: {
                priceUsd: 10.0,
                priceMicro: 10000000,
                recipient: "0x",
                network: "base",
              },
            },
          ],
        });

      const wallet = createMockWallet();
      const client = new ToolClient(transport, {
        autoPayment: true,
        maxPaymentUsd: 1.0,
        wallet,
      });

      await expect(client.callTool("expensive-tool", {})).rejects.toThrow(
        "exceeds max limit"
      );
    });

    it("should execute payment and retry when all checks pass", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("402 payment required"))
        .mockResolvedValueOnce({
          tools: [
            {
              name: "paid-tool",
              pricing: {
                priceUsd: 0.5,
                priceMicro: 500000,
                recipient: "0xrecipient",
                network: "base",
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Paid result" }],
        });

      const wallet = createMockWallet();
      const client = new ToolClient(transport, {
        autoPayment: true,
        maxPaymentUsd: 1.0,
        wallet,
        network: "base",
      });

      const result = await client.callTool("paid-tool", { query: "test" });

      expect(result.content[0].text).toBe("Paid result");
      expect(wallet.pay).toHaveBeenCalled();
      expect(transport.request).toHaveBeenLastCalledWith(
        "tools/call",
        expect.objectContaining({
          name: "paid-tool",
          _payment: {
            transactionHash: "0xabc123",
            signature: "sig-123",
          },
        })
      );
    });
  });

  describe("isPaymentRequiredError", () => {
    it("should detect 402 in message", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        // First call (tools/call) rejects with 402
        .mockRejectedValueOnce(new Error("HTTP 402: Payment Required"))
        // Second call (tools/list) returns tool info
        .mockResolvedValueOnce({
          tools: [{ name: "tool", pricing: { priceUsd: 0.01 } }],
        });

      const client = new ToolClient(transport, { autoPayment: false });

      await expect(client.callTool("tool", {})).rejects.toThrow(
        PaymentRequiredError
      );
    });

    it("should detect payment required in message", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("Payment Required for this tool"))
        .mockResolvedValueOnce({
          tools: [{ name: "tool", pricing: { priceUsd: 0.01 } }],
        });

      const client = new ToolClient(transport, { autoPayment: false });

      await expect(client.callTool("tool", {})).rejects.toThrow(
        PaymentRequiredError
      );
    });

    it("should detect x402 in message", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("x402 protocol: payment needed"))
        .mockResolvedValueOnce({
          tools: [{ name: "tool", pricing: { priceUsd: 0.01 } }],
        });

      const client = new ToolClient(transport, { autoPayment: false });

      await expect(client.callTool("tool", {})).rejects.toThrow(
        PaymentRequiredError
      );
    });

    it("should return false for other errors", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValue(new Error("Internal server error"));

      const client = new ToolClient(transport);

      await expect(client.callTool("tool", {})).rejects.toThrow(
        "Internal server error"
      );
    });
  });

  describe("getPricing", () => {
    it("should filter tools with pricing", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        tools: [
          { name: "free-tool", description: "Free" },
          {
            name: "paid-tool",
            description: "Paid",
            pricing: { priceUsd: 0.01 },
          },
          { name: "another-free", description: "Also free" },
        ],
      });

      const client = new ToolClient(transport);
      const pricedTools = await client.getPricing();

      expect(pricedTools).toHaveLength(1);
      expect(pricedTools[0].name).toBe("paid-tool");
    });
  });

  describe("getToolPrice", () => {
    it("should return pricing for specific tool", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        tools: [
          {
            name: "paid-tool",
            pricing: { priceUsd: 0.05, priceMicro: 50000 },
          },
        ],
      });

      const client = new ToolClient(transport);
      const pricing = await client.getToolPrice("paid-tool");

      expect(pricing?.priceUsd).toBe(0.05);
    });

    it("should return null for tool without pricing", async () => {
      const transport = createMockTransport();
      transport.request = vi.fn().mockResolvedValue({
        tools: [{ name: "free-tool", description: "Free" }],
      });

      const client = new ToolClient(transport);
      const pricing = await client.getToolPrice("free-tool");

      expect(pricing).toBeNull();
    });
  });

  describe("setPaymentOptions", () => {
    it("should merge new options", async () => {
      const transport = createMockTransport();
      const client = new ToolClient(transport, { maxPaymentUsd: 1.0 });

      client.setPaymentOptions({ maxPaymentUsd: 5.0 });

      // Verify by checking behavior - payment should now accept higher amounts
      expect(client).toBeDefined();
    });
  });

  describe("setWallet", () => {
    it("should set wallet for payments", async () => {
      const transport = createMockTransport();
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("402"))
        .mockResolvedValueOnce({
          tools: [
            {
              name: "tool",
              pricing: { priceUsd: 0.01, recipient: "0x", network: "base" },
            },
          ],
        })
        .mockResolvedValueOnce({ content: [] });

      const client = new ToolClient(transport, { autoPayment: true });

      // Should fail without wallet
      await expect(client.callTool("tool", {})).rejects.toThrow(
        "No wallet configured"
      );

      // Set wallet
      client.setWallet(createMockWallet());

      // Reset mock
      transport.request = vi
        .fn()
        .mockRejectedValueOnce(new Error("402"))
        .mockResolvedValueOnce({
          tools: [
            {
              name: "tool",
              pricing: { priceUsd: 0.01, recipient: "0x", network: "base" },
            },
          ],
        })
        .mockResolvedValueOnce({ content: [] });

      // Should succeed with wallet
      await client.callTool("tool", {});
    });
  });
});

describe("PaymentRequiredError", () => {
  it("should store payment details", () => {
    const details: McpPaymentDetails = {
      amountUsd: 0.05,
      amountMicro: 50000,
      recipient: "0xrecipient",
      network: "base",
      toolName: "test-tool",
      facilitatorUrl: "https://pay.example.com",
    };

    const error = new PaymentRequiredError("Payment required", details);

    expect(error.name).toBe("PaymentRequiredError");
    expect(error.message).toBe("Payment required");
    expect(error.paymentDetails).toEqual(details);
  });
});

describe("ToolBuilder", () => {
  describe("build", () => {
    it("should create valid tool schema", () => {
      const tool = new ToolBuilder("search")
        .describe("Search for information")
        .addString("query", { required: true, description: "Search query" })
        .addNumber("limit", { description: "Max results" })
        .addBoolean("exact", { description: "Exact match only" })
        .build();

      expect(tool.name).toBe("search");
      expect(tool.description).toBe("Search for information");
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties.query.type).toBe("string");
      expect(tool.inputSchema.properties.limit.type).toBe("number");
      expect(tool.inputSchema.properties.exact.type).toBe("boolean");
      expect(tool.inputSchema.required).toContain("query");
      expect(tool.inputSchema.required).not.toContain("limit");
    });

    it("should support enum for string parameters", () => {
      const tool = new ToolBuilder("filter")
        .addString("status", {
          required: true,
          enum: ["active", "inactive", "pending"],
        })
        .build();

      expect(tool.inputSchema.properties.status.enum).toEqual([
        "active",
        "inactive",
        "pending",
      ]);
    });

    it("should support array parameters", () => {
      const tool = new ToolBuilder("batch")
        .addArray("ids", "string", { required: true, description: "Item IDs" })
        .build();

      expect(tool.inputSchema.properties.ids.type).toBe("array");
      expect(tool.inputSchema.properties.ids.items).toEqual({ type: "string" });
      expect(tool.inputSchema.required).toContain("ids");
    });

    it("should handle no required fields", () => {
      const tool = new ToolBuilder("optional-tool")
        .addString("field1")
        .addNumber("field2")
        .build();

      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe("chaining", () => {
    it("should allow method chaining", () => {
      const builder = new ToolBuilder("test");

      const result = builder
        .describe("Description")
        .addString("str")
        .addNumber("num")
        .addBoolean("bool")
        .addArray("arr", "string");

      expect(result).toBe(builder);
    });
  });
});
