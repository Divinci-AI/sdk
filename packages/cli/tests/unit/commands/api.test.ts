import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key",
    apiUrl: "https://api.divinci.app",
    profile: "default",
    source: "env",
  }),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));

const mockRequest = vi.fn();
vi.mock("../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({
      request: mockRequest,
    }),
  }),
}));

vi.mock("../../../src/output/formatter.js", () => ({
  output: vi.fn(),
}));

vi.mock("../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../src/output/colors.js", () => ({
  colors: {},
}));

vi.mock("../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
}));

import { Command } from "commander";
import { registerApiCommand } from "../../../src/commands/api.js";
import { output } from "../../../src/output/formatter.js";
import { handleCommandError } from "../../../src/utils/errors.js";

function createProgram(): Command {
  const program = new Command();
  registerApiCommand(program);
  return program;
}

describe("api command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should make GET request", async () => {
    mockRequest.mockResolvedValue({ data: "result" });

    const program = createProgram();
    await program.parseAsync(["api", "get", "/users"], { from: "user" });

    expect(mockRequest).toHaveBeenCalledWith("/users", {
      method: "GET",
      body: undefined,
      params: undefined,
    });
    expect(output).toHaveBeenCalledWith({ data: "result" });
  });

  it("should normalize method to uppercase", async () => {
    mockRequest.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(["api", "post", "/items"], { from: "user" });

    expect(mockRequest).toHaveBeenCalledWith("/items", expect.objectContaining({
      method: "POST",
    }));
  });

  it("should parse --body JSON", async () => {
    mockRequest.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(
      ["api", "post", "/items", "--body", '{"name":"test"}'],
      { from: "user" }
    );

    expect(mockRequest).toHaveBeenCalledWith("/items", expect.objectContaining({
      body: { name: "test" },
    }));
  });

  it("should handle --param key=value pairs", async () => {
    mockRequest.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(
      ["api", "get", "/search", "--param", "q=hello", "--param", "limit=10"],
      { from: "user" }
    );

    expect(mockRequest).toHaveBeenCalledWith("/search", expect.objectContaining({
      params: { q: "hello", limit: "10" },
    }));
  });

  it("should error on invalid JSON body", async () => {
    const program = createProgram();
    await program.parseAsync(
      ["api", "post", "/items", "--body", "not-json"],
      { from: "user" }
    );

    expect(handleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Invalid JSON body") })
    );
  });

  it("should call handleCommandError on API failure", async () => {
    const err = new Error("Network error");
    mockRequest.mockRejectedValue(err);

    const program = createProgram();
    await program.parseAsync(["api", "get", "/test"], { from: "user" });

    expect(handleCommandError).toHaveBeenCalledWith(err);
  });
});
