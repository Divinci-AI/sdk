/**
 * `divinci trust outputs` on a LABEL run (eval-harness `divinci-label-v1`).
 *
 * The label harness writes per-sample rows under `samples`, not `results`, so
 * until 2026-10-25 the command printed "No results in this run." for every
 * ContractNLI / FEVER-NLI run. The shape below is copied from a real staging
 * run's outputs (tr_28WAH9KGBGT4PP4JPBCVQSRWM5, trimmed to three samples).
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

import { registerTrustOutputsCommand, rowsFromOutputs } from "../../../../src/commands/trust/outputs";

const LABEL_OUTPUTS = {
  harness: "divinci-label-v1",
  metric: "label-accuracy",
  sampleCount: 3,
  labels: ["Entailment", "Contradiction", "NotMentioned"],
  metrics: { accuracy: 1 / 3, macroF1: 0.25, invalidRate: 1 / 3 },
  samples: [
    { id: "1-nda-1", target: "Contradiction", predicted: "Entailment", invalid: false, score: 0.0, output: "{\"label\": \"Entailment\"}" },
    { id: "1-nda-12", target: "Entailment", predicted: "Entailment", invalid: false, score: 1.0, output: "{\"label\": \"Entailment\"}" },
    { id: "1-nda-13", target: "Entailment", predicted: null, invalid: true, score: 0.0, output: "To accurately classify whether the document entails..." },
  ],
};

let printed: string[] = [];

async function run(args: string[]) {
  const program = new Command();
  registerTrustOutputsCommand(program);
  await program.parseAsync(["node", "test", "outputs", ...args]);
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

describe("rowsFromOutputs", () => {
  it("reads label samples, marking wrong and invalid answers as failures", () => {
    const rows = rowsFromOutputs(LABEL_OUTPUTS);
    expect(rows.map((r) => [r.id, r.ok])).toEqual([
      ["1-nda-1", false],
      ["1-nda-12", true],
      ["1-nda-13", false],
    ]);
    expect(rows[0].evidence).toBe("predicted Entailment");
    expect(rows[2].evidence).toMatch(/invalid output/);
    expect(rows[0].group).toBe("Contradiction");
  });

  it("names a no-text sample as such", () => {
    const rows = rowsFromOutputs({ samples: [{ id: "s", target: "Entailment", predicted: null, invalid: true, noText: true, score: 0, output: null }] });
    expect(rows[0]).toMatchObject({ ok: false, evidence: "no answer text", text: "" });
  });

  it("still reads the RAG / red-team `results` shape", () => {
    const rows = rowsFromOutputs({ results: [{ sampleId: "a", passed: true }, { probeId: "b", attackSucceeded: true }] });
    expect(rows.map((r) => [r.id, r.ok])).toEqual([["a", true], ["b", false]]);
  });
});

describe("trust outputs on a label run", () => {
  it("lists the samples instead of 'No results in this run.'", async () => {
    h.mockTrustGet.mockResolvedValue(LABEL_OUTPUTS);
    await run(["tr_28WAH9KGBGT4PP4JPBCVQSRWM5", "--private"]);
    const text = printed.join("\n");
    expect(h.mockHandleError).not.toHaveBeenCalled();
    expect(text).not.toContain("No results in this run.");
    expect(text).toContain("1/3 correct");
    expect(text).toContain("invalid 33.3%");
    expect(h.mockOutput).toHaveBeenCalledOnce();
    expect(h.mockTrustGet.mock.calls[0][1]).toBe("/v1/trustbench/runs/tr_28WAH9KGBGT4PP4JPBCVQSRWM5/outputs");
  });

  it("--failures shows only the wrong and invalid samples", async () => {
    h.mockTrustGet.mockResolvedValue(LABEL_OUTPUTS);
    await run(["tr_x", "--private", "--failures"]);
    const shown = h.mockOutput.mock.calls[0][0] as Array<{ id: string }>;
    expect(shown.map((r) => r.id)).toEqual(["1-nda-1", "1-nda-13"]);
  });
});
