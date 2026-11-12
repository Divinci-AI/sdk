// `divinci byok create --endpoint --model`: registering a customer's own
// OpenAI-compatible endpoint for TrustBench (byok-openai/<byokId>).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({ apiKey: "test-key", apiUrl: "https://api.divinci.app", workspaceId: "ws-123", profile: "default", source: "env" }),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}));
const mockCreate = vi.fn();
vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({ byok: { create: (...a: unknown[]) => mockCreate(...a) } }),
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn() }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn((e: unknown) => { throw e; }), requireOAuthAuth: vi.fn() }));

import { Command } from "commander";
import { registerByokCreateCommand } from "../../../../src/commands/byok/create.js";

function cli(): Command {
  const program = new Command();
  registerByokCreateCommand(program.command("byok"));
  return program;
}

beforeEach(() => { mockCreate.mockReset(); mockCreate.mockResolvedValue({ _id: "k1" }); });

describe("byok create for an openai-compatible endpoint", () => {
  it("sends --endpoint and --model as customEndpoint and customModel", async () => {
    await cli().parseAsync([
      "node", "divinci", "byok", "create", "--name", "nli", "--provider", "openai-compatible",
      "--auth", '{"apiKey":"tok-12345678"}',
      "--endpoint", "https://gpu3.example.com/v1/chat/completions", "--model", "example-nli-v1",
    ]);
    expect(mockCreate).toHaveBeenCalledWith("ws-123", {
      name: "nli",
      providerId: "openai-compatible",
      auth: { apiKey: "tok-12345678" },
      customEndpoint: "https://gpu3.example.com/v1/chat/completions",
      customModel: "example-nli-v1",
    });
  });

  it("sends neither field for other providers when the flags are absent", async () => {
    await cli().parseAsync(["node", "divinci", "byok", "create", "--name", "t", "--provider", "TOGETHER", "--auth", '{"apiKey":"x"}']);
    expect(mockCreate.mock.calls[0][1]).toEqual({ name: "t", providerId: "TOGETHER", auth: { apiKey: "x" } });
  });
});
