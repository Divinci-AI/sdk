/**
 * Command tests for `divinci trust get <runId>`.
 *
 * The route answers `{ run, benchmark, access }` (get-run.ts). Until
 * 2026-10-25 this command read `runId` / `status` off the top level and printed
 * `undefined  undefined` for every run, because nothing drove it with the real
 * response shape. These tests use that shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const h = vi.hoisted(() => ({
  mockTrustGet: vi.fn(),
  mockOutput: vi.fn(),
  mockIsJson: vi.fn(() => false),
  mockHandleError: vi.fn(),
}));

vi.mock("../../../../src/commands/trust/_client.js", () => ({
  resolveTrustHttp: vi.fn(async () => ({ baseUrl: "https://api.divinci.app", authToken: "tok" })),
  trustGet: h.mockTrustGet,
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: h.mockOutput,
  isJsonMode: h.mockIsJson,
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: (_label: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: { bold: (s: string) => s, dim: (s: string) => s },
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: h.mockHandleError,
}));

import { registerTrustGetCommand, runFromResponse } from "../../../../src/commands/trust/get";

const RUN_ID = "tr_5BMPN814N1V0KY259X442XC9NQ";

const RUN = {
  runId: RUN_ID,
  status: "complete",
  score: 0.7766666666666666,
  benchmarkId: "bm_PSQX7WTDH2Z4JEB5P5GSJ3M7HP",
  benchmarkVersion: "1.0.0",
  modelAssistantId: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  modelProviderId: "cloudflare-workers-ai",
  modelId: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  visibility: "private",
  signerKeyId: "tbp-staging-001",
};

const ENVELOPE = {
  run: RUN,
  benchmark: { bmId: RUN.benchmarkId, slug: "divinci-fever-nli-v1", name: "Divinci FEVER NLI v1", version: "1.0.0" },
  access: { canView: true },
};

let printed: string[] = [];

async function run(args: string[]) {
  const program = new Command();
  registerTrustGetCommand(program);
  await program.parseAsync(["node", "test", "get", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.mockIsJson.mockReturnValue(false);
  printed = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    printed.push(a.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trust get", () => {
  it("prints the run from the server's { run, benchmark } envelope", async () => {
    h.mockTrustGet.mockResolvedValue(ENVELOPE);
    await run([RUN_ID]);
    const text = printed.join("\n");
    expect(h.mockHandleError).not.toHaveBeenCalled();
    expect(text).toContain(`${RUN_ID}  complete`);
    expect(text).toContain("0.7766666666666666");
    expect(text).toContain("divinci-fever-nli-v1 v1.0.0");
    expect(text).toContain("Divinci FEVER NLI v1");
    expect(text).toContain("cloudflare-workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct");
    expect(text).toContain("tbp-staging-001");
    expect(text).not.toContain("undefined");
  });

  it("calls the run route with the id encoded", async () => {
    h.mockTrustGet.mockResolvedValue(ENVELOPE);
    await run([RUN_ID]);
    expect(h.mockTrustGet.mock.calls[0][1]).toBe(`/v1/trustbench/runs/${RUN_ID}`);
  });

  it("shows the failure reason from the run's metadata", async () => {
    h.mockTrustGet.mockResolvedValue({
      ...ENVELOPE,
      run: { ...RUN, status: "failed", metadata: { errorMessage: "endpoint unreachable", errorCode: "probe-failed" } },
    });
    await run([RUN_ID]);
    const text = printed.join("\n");
    expect(text).toContain(`${RUN_ID}  failed`);
    expect(text).toContain("endpoint unreachable");
    expect(text).toContain("code: probe-failed");
  });

  it("JSON mode prints the whole envelope, as MCP trust_get_run does", async () => {
    h.mockIsJson.mockReturnValue(true);
    h.mockTrustGet.mockResolvedValue(ENVELOPE);
    await run([RUN_ID]);
    expect(h.mockOutput).toHaveBeenCalledWith(ENVELOPE);
  });

  it("reports a body with no run as an error, never as undefined", async () => {
    h.mockTrustGet.mockResolvedValue({ access: { canView: true } });
    await run([RUN_ID]);
    expect(h.mockHandleError).toHaveBeenCalledOnce();
    expect(printed.join("\n")).not.toContain("undefined");
  });
});

describe("runFromResponse", () => {
  it("unwraps the envelope and accepts a bare run", () => {
    expect(runFromResponse(ENVELOPE)).toBe(RUN);
    expect(runFromResponse(RUN)).toBe(RUN);
    expect(() => runFromResponse({} as never)).toThrow(/no run/);
  });
});
