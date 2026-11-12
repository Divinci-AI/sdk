/**
 * MCP Tools Module
 *
 * Handles tool discovery, invocation, and x402 payment handling
 */

import type {
  McpTool,
  McpToolProperty,
  McpToolCallParams,
  McpToolCallResult,
  McpPaymentDetails,
  McpPaymentReceipt,
  McpWallet,
  McpPaymentOptions,
} from "../types.js";
import type { McpTransport } from "../transport/types.js";

/**
 * Payment required error
 */
export class PaymentRequiredError extends Error {
  readonly paymentDetails: McpPaymentDetails;

  constructor(message: string, paymentDetails: McpPaymentDetails) {
    super(message);
    this.name = "PaymentRequiredError";
    this.paymentDetails = paymentDetails;
  }
}

/**
 * Tool invocation options
 */
export interface ToolInvokeOptions {
  /** Payment options for x402 */
  payment?: McpPaymentOptions;
  /** Timeout in ms */
  timeout?: number;
}

/**
 * Tool client for MCP
 */
export class ToolClient {
  private readonly transport: McpTransport;
  private tools: Map<string, McpTool> = new Map();
  private paymentOptions: McpPaymentOptions;

  constructor(transport: McpTransport, paymentOptions: McpPaymentOptions = {}) {
    this.transport = transport;
    this.paymentOptions = {
      autoPayment: false,
      maxPaymentUsd: 1.0,
      network: "base",
      ...paymentOptions,
    };
  }

  /**
   * Set payment options
   */
  setPaymentOptions(options: Partial<McpPaymentOptions>): void {
    this.paymentOptions = { ...this.paymentOptions, ...options };
  }

  /**
   * Set wallet for payments
   */
  setWallet(wallet: McpWallet): void {
    this.paymentOptions.wallet = wallet;
  }

  /**
   * List available tools
   */
  async listTools(): Promise<McpTool[]> {
    const result = await this.transport.request<{ tools: McpTool[] }>("tools/list");

    // Cache tools
    this.tools.clear();
    for (const tool of result.tools) {
      this.tools.set(tool.name, tool);
    }

    return result.tools;
  }

  /**
   * Get a specific tool
   */
  async getTool(name: string): Promise<McpTool | null> {
    // Check cache first
    if (this.tools.has(name)) {
      return this.tools.get(name)!;
    }

    // Refresh tool list
    await this.listTools();
    return this.tools.get(name) ?? null;
  }

  /**
   * Call a tool
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: ToolInvokeOptions
  ): Promise<McpToolCallResult> {
    const params: McpToolCallParams = {
      name,
      arguments: args,
    };

    try {
      return await this.transport.request<McpToolCallResult>("tools/call", params);
    } catch (error) {
      // Check if it's a payment required error
      if (this.isPaymentRequiredError(error)) {
        return this.handlePaymentRequired(name, args, error, options);
      }
      throw error;
    }
  }

  /**
   * Get tool pricing
   */
  async getPricing(): Promise<McpTool[]> {
    const tools = await this.listTools();
    return tools.filter((tool) => tool.pricing);
  }

  /**
   * Get price for a specific tool
   */
  async getToolPrice(name: string): Promise<McpTool["pricing"] | null> {
    const tool = await this.getTool(name);
    return tool?.pricing ?? null;
  }

  /**
   * Check if error is a payment required error
   */
  private isPaymentRequiredError(error: unknown): error is Error & { paymentDetails?: McpPaymentDetails } {
    if (!(error instanceof Error)) {
      return false;
    }

    // Check for HTTP 402 or specific error code
    const message = error.message.toLowerCase();
    return (
      message.includes("402") ||
      message.includes("payment required") ||
      message.includes("x402")
    );
  }

  /**
   * Handle payment required response
   */
  private async handlePaymentRequired(
    toolName: string,
    args: Record<string, unknown> | undefined,
    error: Error & { paymentDetails?: McpPaymentDetails },
    options?: ToolInvokeOptions
  ): Promise<McpToolCallResult> {
    const paymentOpts = { ...this.paymentOptions, ...options?.payment };

    // Get payment details from error or fetch from tool
    let paymentDetails = error.paymentDetails;
    if (!paymentDetails) {
      const tool = await this.getTool(toolName);
      if (!tool?.pricing) {
        throw new PaymentRequiredError("Tool requires payment but no pricing info available", {
          amountUsd: 0,
          amountMicro: 0,
          recipient: "",
          network: paymentOpts.network ?? "base",
          toolName,
          facilitatorUrl: "",
        });
      }

      paymentDetails = {
        amountUsd: tool.pricing.priceUsd,
        amountMicro: tool.pricing.priceMicro,
        recipient: tool.pricing.recipient,
        network: tool.pricing.network,
        toolName,
        facilitatorUrl: "", // Would come from server
      };
    }

    // Check if auto-payment is enabled
    if (!paymentOpts.autoPayment) {
      throw new PaymentRequiredError("Tool requires payment", paymentDetails);
    }

    // Check if wallet is configured
    if (!paymentOpts.wallet) {
      throw new PaymentRequiredError("No wallet configured for payment", paymentDetails);
    }

    // Check payment limits
    if (
      paymentOpts.maxPaymentUsd !== undefined &&
      paymentDetails.amountUsd > paymentOpts.maxPaymentUsd
    ) {
      throw new PaymentRequiredError(
        `Payment amount $${paymentDetails.amountUsd} exceeds max limit $${paymentOpts.maxPaymentUsd}`,
        paymentDetails
      );
    }

    // Execute payment
    const receipt = await paymentOpts.wallet.pay(paymentDetails);

    // Retry tool call with payment receipt
    return this.callToolWithPayment(toolName, args, receipt);
  }

  /**
   * Call tool with payment receipt
   */
  private async callToolWithPayment(
    name: string,
    args: Record<string, unknown> | undefined,
    receipt: McpPaymentReceipt
  ): Promise<McpToolCallResult> {
    const params = {
      name,
      arguments: args,
      _payment: {
        transactionHash: receipt.transactionHash,
        signature: receipt.signature,
      },
    };

    return this.transport.request<McpToolCallResult>("tools/call", params);
  }
}

/**
 * Tool builder for creating custom tools
 */
export class ToolBuilder {
  private name: string;
  private description?: string;
  private properties: Record<string, McpToolProperty> = {};
  private required: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Set tool description
   */
  describe(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Add string parameter
   */
  addString(name: string, options: { description?: string; required?: boolean; enum?: string[] } = {}): this {
    this.properties[name] = {
      type: "string",
      description: options.description,
      enum: options.enum,
    };
    if (options.required) {
      this.required.push(name);
    }
    return this;
  }

  /**
   * Add number parameter
   */
  addNumber(name: string, options: { description?: string; required?: boolean } = {}): this {
    this.properties[name] = {
      type: "number",
      description: options.description,
    };
    if (options.required) {
      this.required.push(name);
    }
    return this;
  }

  /**
   * Add boolean parameter
   */
  addBoolean(name: string, options: { description?: string; required?: boolean } = {}): this {
    this.properties[name] = {
      type: "boolean",
      description: options.description,
    };
    if (options.required) {
      this.required.push(name);
    }
    return this;
  }

  /**
   * Add array parameter
   */
  addArray(name: string, itemType: string, options: { description?: string; required?: boolean } = {}): this {
    this.properties[name] = {
      type: "array",
      items: { type: itemType },
      description: options.description,
    };
    if (options.required) {
      this.required.push(name);
    }
    return this;
  }

  /**
   * Build the tool definition
   */
  build(): McpTool {
    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: "object",
        properties: this.properties,
        required: this.required.length > 0 ? this.required : undefined,
      },
    };
  }
}
