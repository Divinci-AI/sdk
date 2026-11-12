import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel } from "../../output/safe-text.js";

const COST_WARN_THRESHOLD_USD = 1.0;
const COST_HARD_CONFIRM_THRESHOLD_USD = 10.0;

/**
 * Upper bound on --replicates.
 *
 * Cost and wall-clock are LINEAR in this, while the precision it buys grows as
 * 1/sqrt(n): 3 -> 25 costs 8.3x for 2.9x tighter spread. Past ~25 the right
 * move is to reduce judge variance (pin the judge model, tighten the rubric),
 * not to buy more samples.
 *
 * It is a bound rather than a warning because of what sits downstream. The
 * judge is a shared production model with a per-minute quota (see the
 * embedding/judge rate-cap notes in CLAUDE.md), so a runaway arena run does not
 * just spend money — it competes for quota with live RAG traffic and shows up
 * there as 429s. `--yes` skips every cost prompt by design, for CI, so without
 * a bound `--yes --replicates 100000` is an unattended, unprompted,
 * multi-hour spend that degrades production while it runs.
 */
const MAX_REPLICATES = 25;

interface EstimateResponse {
  success: boolean;
  estimate: {
    variantCount: number;
    testsPerVariant: number;
    llmScorerCount: number;
    estimatedJudgeCalls: number;
    estimatedCostUsd: number;
    effectiveJudgeToolId: string | null;
    batchApiEligible: boolean;
    batchApiSavingsUsd: number | null;
    requiresConfirmation: boolean;
    requiresHardConfirmation: boolean;
    costEstimateSource: string;
    warnings: string[];
  };
}

async function fetchEstimate(
  baseUrl: string,
  workspaceId: string,
  suiteId: string,
  accessToken: string,
  body: object,
): Promise<EstimateResponse["estimate"]> {
  const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}/estimate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Estimate endpoint non-JSON response (status ${res.status}): ${text.substring(0, 200)}`);
  }
  if (!res.ok) throw new Error(`Estimate failed HTTP ${res.status}: ${text.substring(0, 400)}`);
  return parsed.estimate;
}

function printEstimate(est: EstimateResponse["estimate"], replicates = 1): void {
  // eslint-disable-next-line no-console
  console.log("\n── Cost Estimate ─────────────────────────────────────");
  // eslint-disable-next-line no-console
  console.log(`  Judge model : ${est.effectiveJudgeToolId ?? "default"}`);
  // eslint-disable-next-line no-console
  console.log(`  Variants    : ${est.variantCount}`);
  // eslint-disable-next-line no-console
  console.log(`  Tests/variant: ${est.testsPerVariant}`);
  // eslint-disable-next-line no-console
  console.log(`  LLM scorer calls: ${est.estimatedJudgeCalls}`);
  // eslint-disable-next-line no-console
  console.log(`  Est. cost   : $${est.estimatedCostUsd.toFixed(4)} (${est.costEstimateSource})`);
  if (replicates > 1) {
    // The server estimates ONE pass. Replicates multiply it, and an
    // estimate that silently understates by 3x is how a run gets
    // approved that nobody would have approved.
    console.log(`  Replicates  : ${replicates} -> $${(est.estimatedCostUsd * replicates).toFixed(4)} total`);
  }
  if (est.batchApiEligible && est.batchApiSavingsUsd !== null) {
    // eslint-disable-next-line no-console
    console.log(`  Batch API   : eligible — saves ~$${est.batchApiSavingsUsd.toFixed(4)}`);
  }
  if (est.warnings.length > 0) {
    for (const w of est.warnings) {
      // eslint-disable-next-line no-console
      console.log(`  ⚠  ${w}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log("──────────────────────────────────────────────────────\n");
}

/**
 * Arena preset QA: run a suite across every variant of an arena preset.
 *
 * Goes direct to the internal endpoint (not the SDK) because LLM runs are
 * long and we want the Markdown rendering inline.
 */

/**
 * Rank variants by overall score, highest first.
 *
 * Mirrors the server's report shape (arena-run-result/schema.ts:
 * `ranking.byOverallScore` + `best` + `worst`) so a split run and a single
 * call produce the same structure. Variants with no score are ranked last
 * rather than treated as zero — a variant that failed to produce a score is
 * missing data, and calling it the worst would let one broken arm crown
 * whichever arm merely ran.
 */
/**
 * Pool a variant's replicate scores.
 *
 * POPULATION sd: these are repeated measurements of ONE variant, not a sample
 * of a population. At n=3 the Bessel correction inflates the spread ~22%, and
 * this sd is what decides whether a difference is called resolved.
 *
 * sd is undefined below two replicates rather than 0 — one run has no spread,
 * and reporting 0 would let ANY gap read as resolved.
 */
export function poolVariant(scores: number[]): { mean?: number; sd?: number; n: number } {
  const xs = scores.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!xs.length) return { n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1
    ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
    : undefined;
  return { mean, sd, n: xs.length };
}

/**
 * One readable line per variant: `0.8733 ± 0.0141 (n=3)`.
 *
 * Exported so it can be tested without a live run, and so the ± convention has
 * exactly one definition. The sd here is the POPULATION sd from poolVariant —
 * `±` means "spread of the replicates", NOT a confidence interval. Do not
 * relabel it as one without also changing what poolVariant computes.
 *
 * Returns [] for a single-replicate run: printing `± undefined`, or a bare
 * score dressed up with a `(n=1)`, invites reading one draw as an estimate.
 */
export function formatVariantScores(perVariant: unknown): string[] {
  if (!Array.isArray(perVariant)) return [];
  const rows = perVariant
    .filter((pv: any) => typeof pv?.overallScoreSd === "number")
    .map((pv: any) => {
      const name = safeLabel(pv.variantName ?? `variant ${pv.variantIndex}`);
      return `  ${name}: ${Number(pv.overallScore).toFixed(4)} ± ${Number(pv.overallScoreSd).toFixed(4)} (n=${pv.overallScoreN ?? pv.overallScoreReplicates?.length ?? "?"})`;
    });
  return rows.length ? ["", "Pooled scores (mean ± sd of replicates):", ...rows] : [];
}

// safeLabel lives in ../../output/safe-text.js — the same escaping the table
// and key-value renderers use, so one definition covers every printed surface.
export { safeLabel };

/**
 * Parse --replicates into a bounded integer, THROWING on anything outside it.
 *
 * Deliberately not a silent clamp. Someone who typed 100 wants 100 samples;
 * quietly giving them 25 and printing a mean that reads like 100 replicates
 * produces a number nobody can reproduce. Refusing tells them what happened.
 *
 * Garbage still floors to 1 rather than throwing, because commander's default
 * is the string "1" and a non-numeric value is an operator typo with an
 * obvious safe reading — whereas an out-of-range NUMBER is a deliberate
 * request that must not be silently altered.
 */
export function parseReplicates(raw: unknown): number {
  const n = parseInt(String(raw ?? "1"), 10);
  if (!Number.isFinite(n)) return 1;
  if (n > MAX_REPLICATES) {
    throw new Error(
      `--replicates ${n} exceeds the maximum of ${MAX_REPLICATES}. Cost and runtime are linear in it while precision grows as 1/sqrt(n), and the judge shares a per-minute quota with production traffic. If you genuinely need a tighter estimate, reduce judge variance instead (pin --judge-model, tighten the rubric).`,
    );
  }
  return Math.max(1, n);
}

/**
 * Is the top-two gap bigger than this run's own noise?
 *
 * The whole point of replicates. Without this a 2-point gap reads exactly like
 * a 50-point one, which is how a benchmark ends up promoting a variant that
 * merely got a good draw. Uses 2*sd_pooled as the bar — the same "outside the
 * band" rule the QA triage path and saveWinningRoutes use.
 *
 * `resolved: false` is a RESULT, not a failure: it means run more replicates or
 * accept that the arms are indistinguishable. It must never be read as a tie
 * broken by rank order.
 */
export function separation(entries: { mean?: number; sd?: number; n: number }[]): any {
  const ranked = entries.filter((e) => typeof e.mean === "number").sort((a, b) => b.mean! - a.mean!);
  if (ranked.length < 2) return { resolved: false, reason: "fewer than two scored variants" };
  const [top, second] = ranked;
  const gap = top.mean! - second.mean!;
  const sds = ranked.map((e) => e.sd).filter((x): x is number => typeof x === "number");
  if (!sds.length) {
    return {
      gap,
      resolved: false,
      reason: "single replicate per variant — no spread to compare against; re-run with --replicates 3",
    };
  }
  const pooled = Math.sqrt(sds.reduce((a, b) => a + b * b, 0) / sds.length);
  const bar = 2 * pooled;
  return {
    gap,
    pooledSd: pooled,
    minResolvable: bar,
    resolved: gap > bar,
    reason: gap > bar
      ? `gap ${(gap * 100).toFixed(1)}pp exceeds 2*sd (${(bar * 100).toFixed(1)}pp)`
      : `gap ${(gap * 100).toFixed(1)}pp is INSIDE 2*sd (${(bar * 100).toFixed(1)}pp) — arms are indistinguishable, not tied`,
  };
}

export function buildRanking(perVariant: any[]): any {
  const scored = perVariant
    .filter((v) => typeof v?.overallScore === "number" && Number.isFinite(v.overallScore))
    .sort((a, b) => b.overallScore - a.overallScore);
  const byOverallScore = scored.map((v, i) => ({
    variantIndex: v.variantIndex,
    variantName: v.variantName,
    overallScore: v.overallScore,
    rank: i + 1,
  }));
  const pick = (v: any) =>
    v ? { variantIndex: v.variantIndex, variantName: v.variantName, overallScore: v.overallScore } : undefined;
  return {
    byOverallScore,
    ...(scored.length ? { best: pick(scored[0]), worst: pick(scored[scored.length - 1]) } : {}),
  };
}

export function registerQAArenaRunCommand(parent: Command): void {
  parent
    .command("arena-run <suiteId>")
    .description("Run a QA suite across every variant of an arena preset (release + RAG + workflow + assistant combinations)")
    .requiredOption("-p, --preset <id>", "Arena preset ID whose variants to run against")
    .option("-v, --variant <idx...>", "Variant indexes to include (omit for all)")
    .option("-m, --max-tests <n>", "Cap tests per variant (default: all suite tests up to 500)")
    .option("-c, --concurrency <n>", "Per-variant test concurrency", "3")
    .option("--per-test-timeout-ms <ms>", "Per-test timeout in ms", "180000")
    .option("--overall-timeout-ms <ms>", "Overall wall-clock budget per variant in ms", "600000")
    .option("--markdown", "Print the Markdown report instead of JSON")
    .option("--http-timeout-ms <ms>", "HTTP client timeout in ms (raise for large presets/suites)", "1800000")
    .option("--judge-model <id>", "Override judge model for all LLM scorers (e.g. gemini-2.5-flash for precision benchmarking)")
    .option("-r, --replicates <n>", "Score each variant N times and compare means (default 1). Required to resolve small differences: an UNCHANGED config on this platform has measured 79/87/87, so one run per variant cannot separate a real winner from a draw.", "1")
    .option("--yes", "Skip cost confirmation prompts (for CI/automation)")
    .option("--estimate-only", "Show cost estimate and exit without running")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const variantIndexes: number[] | undefined = Array.isArray(opts.variant)
          ? opts.variant.map((s: string) => parseInt(s, 10)).filter((n: number) => Number.isFinite(n))
          : opts.variant
            ? [parseInt(opts.variant, 10)]
            : undefined;

        const maxTestsPerVariant = opts.maxTests !== undefined ? parseInt(opts.maxTests, 10) : undefined;
        const replicates = parseReplicates(opts.replicates);
        const judgeModelOverride: string | undefined = opts.judgeModel || undefined;

        const baseUrl = config.apiUrl.replace(/\/+$/, "");

        // ── Cost estimate (always shown before running) ────────────────────
        const estimateBody: Record<string, unknown> = {
          arenaPresetId: opts.preset,
          ...(variantIndexes ? { variantIndexes } : {}),
          ...(maxTestsPerVariant !== undefined ? { maxTestsPerVariant } : {}),
          ...(judgeModelOverride ? { judgeModelOverride } : {}),
        };

        let estimate: EstimateResponse["estimate"];
        try {
          estimate = await withSpinner("Fetching cost estimate...", () =>
            fetchEstimate(baseUrl, workspaceId, suiteId, config.accessToken!, estimateBody),
          );
        } catch (estimateErr) {
          // Non-fatal: proceed with warning if estimate endpoint fails
          // eslint-disable-next-line no-console
          console.warn(`⚠  Could not fetch cost estimate: ${(estimateErr as Error).message}`);
          estimate = null as any;
        }

        if (estimate) {
          printEstimate(estimate, replicates);

          if (opts.estimateOnly) {
            return;
          }

          if (!opts.yes) {
            // Confirm against the TOTAL, not one pass. The server estimates a
            // single pass; with --replicates 3 the real spend is 3x, and
            // gating on the per-pass figure lets a run three times over the
            // threshold through without asking.
            const totalCostUsd = estimate.estimatedCostUsd * replicates;
            if (totalCostUsd >= COST_HARD_CONFIRM_THRESHOLD_USD) {
              const answer = await input({
                message: `Estimated cost $${totalCostUsd.toFixed(2)}${replicates > 1 ? ` (${replicates} replicates)` : ""} exceeds $${COST_HARD_CONFIRM_THRESHOLD_USD}. Type "yes" to confirm:`,
              });
              if (answer.trim().toLowerCase() !== "yes") {
                // eslint-disable-next-line no-console
                console.log("Run cancelled.");
                return;
              }
            } else if (totalCostUsd >= COST_WARN_THRESHOLD_USD) {
              const confirmed = await confirm({
                message: `Estimated cost $${totalCostUsd.toFixed(2)}${replicates > 1 ? ` (${replicates} replicates)` : ""}. Continue?`,
                default: false,
              });
              if (!confirmed) {
                // eslint-disable-next-line no-console
                console.log("Run cancelled.");
                return;
              }
            }
          }
        } else if (opts.estimateOnly) {
          return;
        }

        // ── Run ────────────────────────────────────────────────────────────
        // Cloudflare's edge cuts the HTTP roundtrip at 100s. Server-side
        // arena-run is synchronous (req.on('close') aborts processing
        // when the client disconnects), so any non-trivial multi-variant
        // run that exceeds 100s would die WITH the connection drop.
        //
        // Workaround: split the run into per-variant POSTs. Each variant
        // runs alone server-side and finishes well under 100s with
        // reasonable concurrency. Combine the per-variant reports
        // client-side at the end. Eliminates the 524 cliff for the
        // operator without needing a server-side async refactor.
        const httpTimeoutMs = parseInt(opts.httpTimeoutMs, 10);
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}/arena-run`;
        const allVariantIndexes = variantIndexes ?? estimate?.variantCount
          ? (variantIndexes ?? Array.from({ length: estimate?.variantCount ?? 0 }, (_, i) => i))
          : undefined;

        // If we don't know the variant set (no estimate, no --variant flag),
        // fall back to the legacy single-call behavior.
        const splitPerVariant = !!(allVariantIndexes && allVariantIndexes.length > 1);

        async function runOneCall(perCallVariants: number[] | undefined): Promise<any> {
          const body = {
            arenaPresetId: opts.preset,
            ...(perCallVariants ? { variantIndexes: perCallVariants } : {}),
            maxTestsPerVariant,
            concurrency: parseInt(opts.concurrency, 10),
            perTestTimeoutMs: parseInt(opts.perTestTimeoutMs, 10),
            overallTimeoutMs: parseInt(opts.overallTimeoutMs, 10),
            includeMarkdown: !!opts.markdown,
            ...(judgeModelOverride ? { judgeModelOverride } : {}),
          };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), httpTimeoutMs);
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.accessToken}`,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            const text = await res.text();
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
            }
            try {
              return JSON.parse(text) as any;
            } catch {
              throw new Error(`Non-JSON response (status ${res.status}): ${text.substring(0, 200)}`);
            }
          } finally {
            clearTimeout(timer);
          }
        }

        let data: any;
        if (splitPerVariant && allVariantIndexes) {
          // eslint-disable-next-line no-console
          console.log(`ℹ Running ${allVariantIndexes.length} variants as separate calls (bounds per-call wall-clock under Cloudflare's 100s edge cutoff on large runs).`);
          // NOTE for future debuggers: this split is a wall-clock bound for
          // LARGE multi-variant runs — it is NOT the failure mode of a variant.
          // A per-variant failure comes back as a structured `errorCount` +
          // `errorsSample` in that variant's report (deadlineReached=false), not
          // as a dropped connection. Don't assume "timeout" from this message;
          // read the variant's errorsSample for the real cause.
          // Each variant runs `replicates` times. Cost is linear in it, which
          // is why the default is 1 and the flag is explicit — but at 1 the
          // separation check below can only ever answer "unresolved", because
          // there is no spread to compare a gap against.
          const perVariantReports: any[] = [];
          const replicateScores = new Map<number, number[]>();
          for (const vIdx of allVariantIndexes) {
            for (let rep = 0; rep < replicates; rep++) {
              const label = replicates > 1
                ? `Running variant ${vIdx} (replicate ${rep + 1}/${replicates})...`
                : `Running variant ${vIdx}...`;
              const sub = await withSpinner(label, () => runOneCall([vIdx]));
              const rpt = sub?.report ?? sub;
              // Keep only the FIRST replicate's per-test detail: N copies of the
              // same tests would inflate perTest N-fold and make any downstream
              // count wrong. The replicate scores are kept in full.
              if (rep === 0) perVariantReports.push(rpt);
              for (const pv of (rpt?.perVariant ?? [])) {
                if (typeof pv?.overallScore === "number" && Number.isFinite(pv.overallScore)) {
                  const arr = replicateScores.get(pv.variantIndex) ?? [];
                  arr.push(pv.overallScore);
                  replicateScores.set(pv.variantIndex, arr);
                }
              }
            }
          }
          // Pool ONCE, and let both `perVariant` and the ranking read the same
          // objects.
          //
          // ⚠️ This used to be pooled only inside the `buildRanking(...)`
          // argument, on a mapped COPY. So `perVariant[i].overallScore` was the
          // variant's FIRST replicate while `ranking.best.overallScore` was the
          // mean of all of them — two different numbers for the same variant in
          // one report, with no indication which was which. Observed 2026-08-17:
          // a 3-replicate run reported best=0.8733 (mean) alongside a perVariant
          // entry of 0.863 (first draw), and `overallScoreSd` /
          // `overallScoreReplicates` appeared NOWHERE in the output, because the
          // copy carrying them was discarded after ranking.
          //
          // That is worse than it looks: the replicate spread is the entire
          // point of the flag, and a reader of `perVariant` — or any downstream
          // consumer of it — silently got an unpooled single sample back.
          const pooledPerVariant: any[] = perVariantReports
            .flatMap(r => r?.perVariant ?? [])
            .map((pv: any) => {
              const scores = replicateScores.get(pv?.variantIndex) ?? [];
              const pooled = poolVariant(scores);
              return pooled.mean !== undefined
                ? {
                    ...pv,
                    overallScore: pooled.mean,
                    overallScoreReplicates: scores,
                    overallScoreSd: pooled.sd,
                    overallScoreN: pooled.n,
                  }
                : pv;
            });

          // Combine: stitch perVariant arrays together.
          const combined: any = {
            presetId: opts.preset,
            suiteId,
            variantsRun: allVariantIndexes.length,
            testsPerVariant: maxTestsPerVariant,
            perVariant: pooledPerVariant,
            perTest: perVariantReports.flatMap(r => r?.perTest ?? []),
            // ⚠️ RECOMPUTE across every variant. This used to be
            // `perVariantReports[0]?.ranking`, and each per-variant call ranks
            // only the ONE variant it ran — so the combined report always named
            // variant 0 as both best and worst, whatever the scores were.
            //
            // Not an edge case: `splitPerVariant` is true whenever there is
            // more than one variant, i.e. for every real arena run. Observed
            // 2026-08-17 on a two-arm corpus comparison scoring 0.37 vs 0.863,
            // where the report named the 0.37 arm best.
            //
            // It matters beyond display: `promoteWinner` takes `variantIndex`
            // from its request body and does not recompute, so a human reading
            // this summary and promoting it applies the LOSING variant to the
            // release.
            // Ranks on the pooled means — the same objects `perVariant` holds,
            // so the two can never disagree.
            ranking: buildRanking(pooledPerVariant),
            replicates,
            // Whether the top-two gap survives this run's own noise. `resolved:
            // false` is a result — the arms are indistinguishable, NOT tied.
            separation: separation(
              [...replicateScores.values()].map((xs) => poolVariant(xs)),
            ),
            // Keep markdown from the last call if requested
            ...(opts.markdown ? { markdown: perVariantReports.map(r => r?.markdown ?? "").filter(Boolean).join("\n\n---\n\n") } : {}),
          };
          data = { report: combined, markdown: combined.markdown };
        } else {
          data = await withSpinner(
            `Running suite against arena preset ${opts.preset}...`,
            () => runOneCall(variantIndexes),
          );
        }

        if (opts.markdown && data?.markdown) {
          // eslint-disable-next-line no-console
          console.log(data.markdown);
        } else {
          output(data.report, { keyValue: true });
          // The key-value renderer prints `perVariant` as one JSON row and the
          // terminal truncates it, so the spread — the whole reason to pay for
          // replicates — is off the right-hand edge. Print it plainly.
          for (const line of formatVariantScores(data?.report?.perVariant)) {
            // eslint-disable-next-line no-console
            console.log(line);
          }
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
