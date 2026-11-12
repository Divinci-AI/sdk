/**
 * `divinci trust benchmarks update <bmId>` (PATCH /v1/trustbench/benchmarks/:id)
 * and `divinci trust outputs <runId> --private` (GET /v1/trustbench/runs/:id/outputs).
 * Both are API capabilities that had no CLI path until 2026-10-15.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock("../../../../src/commands/trust/_client.js", () => ({
  resolveTrustHttp: vi.fn(async () => ({ baseUrl: "https://api.divinci.app", authToken: "tok" })),
  trustGet: h.get,
  trustPatch: h.patch,
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn(), isJsonMode: vi.fn(() => true) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: h.handleError }));

import { registerTrustBenchmarksCommand } from "../../../../src/commands/trust/benchmarks";
import { registerTrustOutputsCommand } from "../../../../src/commands/trust/outputs";

const BM = "bm_01J9Z3XK4V5W6X7Y8Z9A0B1C2D";
const TR = "tr_01J9Z3XK4V5W6X7Y8Z9A0B1C2D";

async function run(args: string[]) {
  const program = new Command();
  registerTrustBenchmarksCommand(program);
  registerTrustOutputsCommand(program);
  await program.parseAsync(["node", "test", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.patch.mockResolvedValue({ benchmark: { bmId: BM, slug: "s", version: "1", name: "N" } });
  h.get.mockResolvedValue({ results: [] });
});

describe("divinci trust benchmarks update", () => {
  it("PATCHes only name and description of one exact version", async () => {
    await run(["benchmarks", "update", BM, "--name", "N", "--description", "D"]);
    expect(h.handleError).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledWith(expect.anything(), `/v1/trustbench/benchmarks/${BM}`, { name: "N", description: "D" });
  });

  it("refuses a slug, which can match several versions", async () => {
    await run(["benchmarks", "update", "scored-qa-suite-abc", "--name", "N"]);
    expect(h.patch).not.toHaveBeenCalled();
    expect(String(h.handleError.mock.calls[0][0])).toMatch(/bmId/);
  });

  it("refuses an edit that changes nothing", async () => {
    await run(["benchmarks", "update", BM]);
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.handleError).toHaveBeenCalled();
  });
});

describe("divinci trust outputs", () => {
  it("reads the public surface by default", async () => {
    await run(["outputs", TR]);
    expect(h.get).toHaveBeenCalledWith(expect.anything(), `/v1/trustbench/public/runs/${TR}/outputs`);
  });

  it("reads the signed-in surface with --private", async () => {
    await run(["outputs", TR, "--private"]);
    expect(h.get).toHaveBeenCalledWith(expect.anything(), `/v1/trustbench/runs/${TR}/outputs`);
  });
});
