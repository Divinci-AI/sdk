/**
 * `divinci trust outputs` on an EMBEDDING-RETRIEVAL run (eval-harness
 * `divinci-retrieval-v1`, the signed embedding boards).
 *
 * A retrieval query has no `target` or `predicted`. Read as a label sample,
 * `predicted === target` is `undefined === undefined`, so every query would
 * "pass" — these pin that it is read as retrieval instead. The shape is the
 * harness's real output (retrieval_run.py), trimmed to three queries.
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
vi.mock("../../../../src/output/formatter.js", () => ({ output: h.mockOutput, isJsonMode: h.mockIsJson }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: (_l: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("../../../../src/output/colors.js", () => ({ colors: { bold: (s: string) => s, dim: (s: string) => s } }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: h.mockHandleError }));

import { registerTrustOutputsCommand, rowsFromOutputs } from "../../../../src/commands/trust/outputs";

const RETRIEVAL_OUTPUTS = {
  harness: "divinci-retrieval-v1",
  metric: "ndcg-at-10",
  sampleCount: 3,
  metrics: {
    ndcg10: 0.7416, recall10: 0.86, recall100: 0.9633, mrr10: 0.7051, queries: 3,
    ndcg10CI: { low: 0.7017, high: 0.7806, level: 0.95, n: 3, method: "bootstrap-percentile" },
  },
  samples: [
    { id: "1", ndcg10: 1.0, recall10: 1, recall100: 1, mrr10: 1, top10: ["31715818", "13734012"] },
    { id: "3", ndcg10: 0.0, recall10: 0, recall100: 1, mrr10: 0, top10: ["9", "8", "7"] },
    { id: "5", ndcg10: 0.6309, recall10: 1, recall100: 1, mrr10: 0.5, top10: ["x", "13734012"] },
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

describe("rowsFromOutputs on a retrieval run", () => {
  it("passes a query with anything relevant in its top 10, and only those", () => {
    const rows = rowsFromOutputs(RETRIEVAL_OUTPUTS);
    expect(rows.map((r) => [r.id, r.ok])).toEqual([["1", true], ["3", false], ["5", true]]);
    expect(rows[1].evidence).toBe("nDCG@10 0.000 · R@100 1.00");
    expect(rows[1].text).toBe("top 10: 9, 8, 7");
  });

  it("is recognised by its shape when the harness name is absent", () => {
    const { harness: _h, ...rest } = RETRIEVAL_OUTPUTS;
    expect(rowsFromOutputs(rest).map((r) => r.ok)).toEqual([true, false, true]);
  });

  it("leaves a label sample read as a label sample", () => {
    const rows = rowsFromOutputs({ samples: [{ id: "s", target: "Entailment", predicted: "Contradiction", score: 0 }] });
    expect(rows[0]).toMatchObject({ ok: false, group: "Entailment", evidence: "predicted Contradiction" });
  });
});

describe("trust outputs on a retrieval run", () => {
  it("prints the signed headline with its interval, not 'N correct'", async () => {
    h.mockTrustGet.mockResolvedValue(RETRIEVAL_OUTPUTS);
    await run(["tr_x", "--private"]);
    const text = printed.join("\n");
    expect(h.mockHandleError).not.toHaveBeenCalled();
    expect(text).toContain("2/3 queries with a relevant document in the top 10");
    expect(text).toContain("nDCG@10 0.7416 [0.7017, 0.7806] · R@100 0.963 · MRR@10 0.705");
    expect(text).not.toContain("correct");
  });

  it("--failures lists only the misses", async () => {
    h.mockTrustGet.mockResolvedValue(RETRIEVAL_OUTPUTS);
    await run(["tr_x", "--private", "--failures"]);
    const shown = h.mockOutput.mock.calls[0][0] as Array<{ id: string }>;
    expect(shown.map((r) => r.id)).toEqual(["3"]);
  });
});
