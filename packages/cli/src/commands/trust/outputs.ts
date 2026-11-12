import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustGet } from "./_client.js";

interface SampleResult {
  sampleId?: string;
  probeId?: string;
  check?: string;
  category?: string;
  passed?: boolean;
  attackSucceeded?: boolean;
  evidence?: string;
  output?: string;
}

/** A label-accuracy sample (eval-harness `divinci-label-v1`, e.g. the NLI boards). */
interface LabelSample {
  id?: string;
  target?: string;
  predicted?: string | null;
  invalid?: boolean;
  noText?: boolean;
  score?: number;
  output?: string | null;
}

/** An embedding-retrieval query (eval-harness `divinci-retrieval-v1`, the embedding boards). */
interface RetrievalSample {
  id?: string;
  ndcg10?: number;
  recall10?: number;
  recall100?: number;
  mrr10?: number;
  top10?: string[];
}

interface RetrievalMetrics {
  ndcg10?: number;
  recall100?: number;
  mrr10?: number;
  ndcg10CI?: { low?: number, high?: number };
}

type Outputs = {
  harness?: string;
  results?: SampleResult[];
  samples?: Array<LabelSample & RetrievalSample>;
};

function isRetrieval(data: Outputs): boolean {
  if (data.harness === "divinci-retrieval-v1") return true;
  const first = data.samples?.[0];
  return Boolean(first && typeof first.ndcg10 === "number" && !("target" in first));
}

interface Row {
  id: string;
  group: string;
  ok: boolean;
  evidence: string;
  text: string;
}

/**
 * Fold every harness's per-sample schema into one row shape.
 *
 * RAG grades `passed` and red team grades `attackSucceeded` (holding is good),
 * both under `results`. The label harness writes `samples` instead, with the
 * gold `target` and the parsed `predicted` label. Reading only `results`
 * printed "No results in this run." for every label run — found 2026-10-25 on
 * the ContractNLI / FEVER-NLI boards, where a 0.088 score was 88% invalid
 * outputs and the CLI could not show a single one.
 */
export function rowsFromOutputs(data: Outputs): Row[] {
  if (Array.isArray(data.results) && data.results.length > 0) {
    return data.results.map((r) => ({
      id: r.sampleId ?? r.probeId ?? "?",
      group: r.check ?? r.category ?? "",
      ok: "passed" in r ? Boolean(r.passed) : !r.attackSucceeded,
      evidence: r.evidence ?? "",
      text: r.output ?? "",
    }));
  }
  // A retrieval query has no target or prediction: read as a label sample,
  // `predicted === target` is `undefined === undefined` and every query would
  // pass. A MISS is a query with nothing relevant in its top 10.
  if (isRetrieval(data)) {
    return (data.samples ?? []).map((s) => ({
      id: s.id ?? "?",
      group: "",
      ok: (s.ndcg10 ?? 0) > 0,
      evidence: `nDCG@10 ${(s.ndcg10 ?? 0).toFixed(3)} · R@100 ${(s.recall100 ?? 0).toFixed(2)}`,
      text: (s.top10 ?? []).length ? `top 10: ${(s.top10 ?? []).join(", ")}` : "",
    }));
  }
  return (data.samples ?? []).map((s) => ({
    id: s.id ?? "?",
    group: s.target ?? "",
    ok: s.score === 1 || (s.predicted != null && s.predicted === s.target),
    evidence: s.noText
      ? "no answer text"
      : s.invalid
        ? "invalid output (no label parsed)"
        : `predicted ${s.predicted ?? "?"}`,
    text: s.output ?? "",
  }));
}

/**
 * `divinci trust outputs <runId>` — the PER-SAMPLE results behind a score.
 *
 * A score says a model got 15/16. It does not say which sample it missed, and
 * that is the only thing that tells you whether the benchmark still measures
 * anything or whether the grader mismarked a correct answer. Both have
 * happened here: nine of one board's apparent failures were correct refusals
 * that named the near-miss figure, and a reasoning model's `<think>` block was
 * being graded as its answer.
 *
 * The API has served this at /public/runs/:id/outputs the whole time. Without
 * a CLI path to it, answering "which sample?" meant reading the R2 bucket
 * directly with S3 credentials — which is how it was actually done, and is not
 * a reasonable ask of anyone outside the team.
 *
 * ⚠️ Public endpoint: the run must be `visibility: public` and complete. A
 * private run returns 404 by design — the public surface must not confirm that
 * someone else's private run exists.
 */
export function registerTrustOutputsCommand(parent: Command): void {
  parent
    .command("outputs <runId>")
    .description("Show the per-sample results behind a run's score (public runs, or --private)")
    .option("--failures", "Only show samples the model got wrong (retrieval: queries with nothing relevant in the top 10)", false)
    .option("--full", "Print each model output in full rather than truncated", false)
    .option(
      "--private",
      "Read a run you may view privately (your own, or your workspace's), e.g. before deciding to publish it",
      false
    )
    .action(async (runId: string, opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const id = encodeURIComponent(runId);
        // --private reads the signed-in route (run-access.ts decides who may);
        // the default stays the unauthenticated public surface.
        const path = opts.private
          ? `/v1/trustbench/runs/${id}/outputs`
          : `/v1/trustbench/public/runs/${id}/outputs`;
        const data = await withSpinner("Fetching outputs...", () =>
          trustGet<Outputs & Record<string, unknown>>(http, path)
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const rows = rowsFromOutputs(data);
        const shown = opts.failures ? rows.filter((r) => !r.ok) : rows;

        if (shown.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim(opts.failures ? "No failures." : "No results in this run."));
          return;
        }

        output(shown, {
          table: {
            columns: [
              { key: "id", header: "SAMPLE" },
              { key: "group", header: "GROUP" },
              { key: "ok", header: "RESULT", format: (v) => (v ? "pass" : "FAIL") },
              { key: "evidence", header: "EVIDENCE" },
            ],
          },
        });

        const failed = rows.filter((r) => !r.ok).length;
        if (isRetrieval(data)) {
          const m = (data as { metrics?: RetrievalMetrics }).metrics ?? {};
          const ci = m.ndcg10CI;
          // eslint-disable-next-line no-console
          console.log(colors.dim(
            `\n${rows.length - failed}/${rows.length} queries with a relevant document in the top 10` +
            `\nnDCG@10 ${m.ndcg10?.toFixed(4) ?? "?"}` +
            (ci && typeof ci.low === "number" && typeof ci.high === "number" ? ` [${ci.low.toFixed(4)}, ${ci.high.toFixed(4)}]` : "") +
            ` · R@100 ${m.recall100?.toFixed(3) ?? "?"} · MRR@10 ${m.mrr10?.toFixed(3) ?? "?"}`
          ));
        } else {
          // eslint-disable-next-line no-console
          console.log(
            colors.dim(`\n${rows.length - failed}/${rows.length} correct`)
          );
        }
        // Label runs carry their own metrics; the invalid rate is the number
        // that separates "wrong" from "did not answer in the format".
        const metrics = (data as { metrics?: { macroF1?: number, invalidRate?: number } }).metrics;
        if (metrics && typeof metrics.invalidRate === "number") {
          // eslint-disable-next-line no-console
          console.log(colors.dim(
            `macro-F1 ${metrics.macroF1?.toFixed(3) ?? "?"} · invalid ${(metrics.invalidRate * 100).toFixed(1)}%`
          ));
        }

        // Read the OUTPUT before believing a sample is hard — an apparent
        // discriminator is sometimes a mismarked correct answer.
        for (const r of shown.filter((x) => !x.ok)) {
          const body = opts.full ? r.text : r.text.slice(0, 400);
          // eslint-disable-next-line no-console
          console.log(
            `\n${colors.bold(r.id)} ${colors.dim(r.evidence)}\n  ${body.replace(/\n/g, "\n  ")}`
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
