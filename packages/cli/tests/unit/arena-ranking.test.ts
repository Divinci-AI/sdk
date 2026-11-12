/**
 * `arena-run` splits multi-variant runs into one call per variant to stay under
 * Cloudflare's edge cutoff, then stitches the reports together. The stitch used
 * `perVariantReports[0]?.ranking` — and each per-variant call ranks only the
 * variant it ran, so the combined report always named variant 0 as both best
 * AND worst.
 *
 * Observed 2026-08-17 on a two-arm corpus comparison scoring 0.37 vs 0.863:
 * the report named the 0.37 arm best. `splitPerVariant` is true whenever there
 * is more than one variant, so this was every real arena run.
 *
 * It is not cosmetic: `promoteWinner` takes `variantIndex` from its request
 * body and does not recompute, so a human reading the summary and promoting it
 * applies the LOSING variant to the release.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRanking, formatVariantScores, parseReplicates, poolVariant, safeLabel, separation } from "../../src/commands/qa/arena-run";

const A = { variantIndex: 0, variantName: "A — community corpus", overallScore: 0.37 };
const B = { variantIndex: 1, variantName: "B2 — docs corpus", overallScore: 0.8633 };

describe("buildRanking", () => {
  it("names the HIGHEST scorer best, not the first variant", () => {
    const r = buildRanking([A, B]);
    expect(r.best.variantIndex).toBe(1);
    expect(r.worst.variantIndex).toBe(0);
  });

  it("is order-independent", () => {
    // The stitch order follows call order, which follows variant index — so a
    // ranking that merely preserved input order would look correct whenever
    // variant 0 happened to win.
    expect(buildRanking([B, A]).best.variantIndex).toBe(1);
    expect(buildRanking([A, B]).best.variantIndex).toBe(1);
  });

  it("ranks every variant, not just the first call's", () => {
    const r = buildRanking([A, B]);
    expect(r.byOverallScore).toHaveLength(2);
    expect(r.byOverallScore.map((x: any) => x.rank)).toEqual([1, 2]);
  });

  it("ranks a variant with NO score last rather than as zero", () => {
    // A variant that failed to produce a score is missing data. Treating it as
    // 0 would let one broken arm crown whichever arm merely ran.
    const dead = { variantIndex: 2, variantName: "C — errored", overallScore: null };
    const r = buildRanking([A, B, dead]);
    expect(r.byOverallScore).toHaveLength(2);
    expect(r.worst.variantIndex).toBe(0);
    expect(r.best.variantIndex).toBe(1);
  });

  it("omits best/worst entirely when nothing scored", () => {
    // Better than naming a winner from an empty set.
    const r = buildRanking([{ variantIndex: 0, variantName: "x", overallScore: null }]);
    expect(r.byOverallScore).toEqual([]);
    expect(r.best).toBeUndefined();
  });

  it("handles a single scored variant without calling it both best and worst incorrectly", () => {
    const r = buildRanking([A]);
    expect(r.best.variantIndex).toBe(0);
    expect(r.worst.variantIndex).toBe(0);
  });
});

describe("replicates — resolving small differences", () => {
  /**
   * arena-run scored each variant ONCE, so a 2-point gap read exactly like a
   * 50-point one. On this platform an UNCHANGED configuration has measured
   * 79/87/87 (sd ~3.8pp), so single-draw comparisons cannot separate a winner
   * from a draw — which is how a benchmark ends up promoting an arm that got a
   * good draw.
   */
  it("pools replicates with POPULATION sd", () => {
    // Bessel inflates ~22% at n=3, and this sd decides whether a gap counts as
    // resolved — an inflated one calls real differences unresolved.
    const p = poolVariant([0.79, 0.87, 0.87]);
    expect(p.n).toBe(3);
    expect(p.mean).toBeCloseTo(0.843, 3);
    expect(p.sd).toBeCloseTo(0.0377, 4);
  });

  it("leaves sd undefined for a single replicate rather than 0", () => {
    // sd=0 would make ANY gap look resolved — the exact failure this adds
    // replicates to prevent.
    expect(poolVariant([0.83]).sd).toBeUndefined();
  });

  it("calls a 50-point gap RESOLVED", () => {
    // The w&b corpus arms: 0.37 vs 0.863 with tight spreads.
    const s = separation([poolVariant([0.37, 0.368, 0.372]), poolVariant([0.863, 0.861, 0.865])]);
    expect(s.resolved).toBe(true);
    expect(s.reason).toMatch(/exceeds/);
  });

  it("calls a 2-point gap UNRESOLVED at realistic noise", () => {
    // BioRenew: 84.3% vs 84.0% was reported as a difference. At sd ~3.8pp it
    // is not one.
    const s = separation([poolVariant([0.79, 0.87, 0.87]), poolVariant([0.81, 0.86, 0.85])]);
    expect(s.resolved).toBe(false);
    expect(s.reason).toMatch(/indistinguishable, not tied/);
  });

  it("refuses to resolve anything at one replicate per variant", () => {
    // The honest answer when there is no spread to compare against.
    const s = separation([poolVariant([0.37]), poolVariant([0.86])]);
    expect(s.resolved).toBe(false);
    expect(s.reason).toMatch(/--replicates 3/);
  });

  it("needs two scored variants before it will compare anything", () => {
    expect(separation([poolVariant([0.5, 0.5, 0.5])]).resolved).toBe(false);
  });
});

describe("the --replicates flag is actually wired", () => {
  /**
   * The logic above is unit-tested; this covers the part that has burned me
   * repeatedly today — a correct function that nothing calls, or calls with the
   * wrong argument. Registration and defaults are read from commander itself
   * rather than grepped out of the source.
   */
  it("registers --replicates with a default of 1", async () => {
    const { Command } = await import("commander");
    const { registerQAArenaRunCommand } = await import("../../src/commands/qa/arena-run");
    const parent = new Command();
    registerQAArenaRunCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "arena-run");
    expect(cmd, "arena-run command not registered").toBeTruthy();
    const opt = cmd!.options.find((o) => o.long === "--replicates");
    expect(opt, "--replicates not registered").toBeTruthy();
    // Default 1 keeps every existing invocation byte-identical in cost.
    expect(opt!.defaultValue).toBe("1");
    expect(opt!.short).toBe("-r");
  });

  it("says in its help WHY one run per variant is not enough", async () => {
    // The flag is useless if nobody knows to reach for it; the measured
    // 79/87/87 is the argument.
    const { Command } = await import("commander");
    const { registerQAArenaRunCommand } = await import("../../src/commands/qa/arena-run");
    const parent = new Command();
    registerQAArenaRunCommand(parent);
    const cmd = parent.commands.find((c: any) => c.name() === "arena-run");
    const opt = cmd!.options.find((o: any) => o.long === "--replicates");
    expect(opt.description).toMatch(/79\/87\/87/);
  });
});

describe("pooled scores reach the report, not just the ranking", () => {
  /**
   * Regression for 2026-08-17: the pooled means were computed inside the
   * `buildRanking(...)` argument, on a mapped COPY. `perVariant` kept each
   * variant's FIRST replicate, so one report carried two different scores for
   * the same variant and the sd/replicate list appeared nowhere at all.
   *
   * Asserted as an INVARIANT between the two fields rather than against fixed
   * numbers: any future pooling change must keep them agreeing.
   */
  const pool = (pv: { variantIndex: number; variantName: string }, scores: number[]) => {
    const p = poolVariant(scores);
    return { ...pv, overallScore: p.mean, overallScoreReplicates: scores, overallScoreSd: p.sd, overallScoreN: p.n };
  };

  const pooled = [
    pool({ variantIndex: 0, variantName: "A" }, [0.34, 0.35, 0.36]),
    pool({ variantIndex: 1, variantName: "B" }, [0.86, 0.88, 0.88]),
  ];

  it("SOURCE: perVariant and buildRanking read one array, not two", () => {
    // The defect lived at the CALL SITE — two separate pooling expressions —
    // so no assertion over exported functions can reach it: buildRanking(x)
    // trivially agrees with x. Pin the structure instead.
    const src = readFileSync(join(__dirname, "../../src/commands/qa/arena-run.ts"), "utf8");
    expect(src).toContain("perVariant: pooledPerVariant");
    expect(src).toContain("buildRanking(pooledPerVariant)");
    // And exactly ONE place builds it. A second `.map(` that re-pools is how
    // the two fields drifted apart the first time.
    expect(src.match(/const pooledPerVariant/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/buildRanking\(\s*perVariantReports/);
  });

  it("ranking reads the SAME objects perVariant holds", () => {
    const r = buildRanking(pooled) as any;
    const best = pooled.find((p) => p.variantIndex === r.best.variantIndex)!;
    // The exact failure: best.overallScore was the mean while perVariant's was
    // the first draw (0.86). Compare the two fields, not a literal.
    expect(r.best.overallScore).toBe(best.overallScore);
    expect(r.worst.overallScore).toBe(
      pooled.find((p) => p.variantIndex === r.worst.variantIndex)!.overallScore,
    );
  });

  it("a pooled score is the mean, never the first replicate", () => {
    const b = pooled[1];
    expect(b.overallScore).toBeCloseTo((0.86 + 0.88 + 0.88) / 3, 12);
    expect(b.overallScore).not.toBe(0.86);
  });

  it("carries the spread, which is the reason to pay for replicates", () => {
    for (const p of pooled) {
      expect(typeof p.overallScoreSd).toBe("number");
      expect(p.overallScoreReplicates).toHaveLength(3);
      expect(p.overallScoreN).toBe(3);
    }
  });
});

describe("formatVariantScores", () => {
  it("renders mean ± sd with n", () => {
    const lines = formatVariantScores([
      { variantIndex: 0, variantName: "A", overallScore: 0.3456, overallScoreSd: 0.0082, overallScoreN: 3 },
    ]);
    expect(lines.join("\n")).toContain("A: 0.3456 ± 0.0082 (n=3)");
  });

  it("prints NOTHING for a single-replicate run", () => {
    // sd is undefined at n=1. A line reading "± undefined" — or a bare score
    // formatted like an estimate — invites reading one draw as a measurement.
    expect(formatVariantScores([{ variantIndex: 0, variantName: "A", overallScore: 0.5 }])).toEqual([]);
  });

  it("survives a missing or malformed report", () => {
    expect(formatVariantScores(undefined)).toEqual([]);
    expect(formatVariantScores(null)).toEqual([]);
    expect(formatVariantScores("nope")).toEqual([]);
  });
});

describe("parseReplicates — bounded, and loud about it", () => {
  it("accepts the ordinary range", () => {
    expect(parseReplicates("1")).toBe(1);
    expect(parseReplicates("3")).toBe(3);
    expect(parseReplicates("25")).toBe(25);
  });

  it("THROWS above the cap rather than silently clamping", () => {
    // A silent clamp would report a mean of 25 runs to someone who asked for
    // 100 and believes they got 100 — an unreproducible number.
    expect(() => parseReplicates("26")).toThrow(/exceeds the maximum of 25/);
    expect(() => parseReplicates("100000")).toThrow(/exceeds the maximum/);
  });

  it("floors junk and non-positive values at 1", () => {
    expect(parseReplicates(undefined)).toBe(1);
    expect(parseReplicates("abc")).toBe(1);
    expect(parseReplicates("0")).toBe(1);
    expect(parseReplicates("-5")).toBe(1);
  });

  it("SOURCE: the command parses through this function", () => {
    // The bound is worthless if the call site keeps its own parseInt.
    const src = readFileSync(join(__dirname, "../../src/commands/qa/arena-run.ts"), "utf8");
    expect(src).toContain("parseReplicates(opts.replicates)");
    expect(src).not.toMatch(/Math\.max\(1,\s*parseInt\(String\(opts\.replicates/);
  });
});

describe("safeLabel — server text goes to a raw terminal write", () => {
  it("strips ESC so a preset name cannot drive the terminal", () => {
    const evil = "A" + "\u001B" + "[2J[1;1Hfake: 0.9999";
    const out = safeLabel(evil);
    expect(out).not.toContain("\u001B");
    expect(out.codePointAt(1)).not.toBe(0x1b);
  });

  it("strips NUL and other C0 bytes", () => {
    expect(safeLabel("a" + "\u0000" + "b")).toBe("ab");
  });

  it("keeps ordinary text, including the em dash we actually use", () => {
    expect(safeLabel("B2 — docs.wandb.ai corpus")).toBe("B2 — docs.wandb.ai corpus");
  });

  it("caps length so the numbers stay on screen", () => {
    expect(safeLabel("x".repeat(500)).length).toBe(120);
  });

  it("is applied by formatVariantScores, not just available", () => {
    const line = formatVariantScores([
      { variantIndex: 0, variantName: "A" + "\u001B" + "[31m", overallScore: 0.5, overallScoreSd: 0.01, overallScoreN: 3 },
    ]).join("");
    expect(line).not.toContain("\u001B");
  });
});
