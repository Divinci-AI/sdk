import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel } from "../../output/safe-text.js";

/**
 * `divinci qa estimate-run` — dry-run cost estimate for a QA suite sweep.
 *
 * Dual-mode: either `--arena-preset <id>` (legacy judge-only estimate for
 * arena-preset runs) OR `--releases <id...>` (NEW per-variant itemized
 * estimate matching what multi-release-run will execute).
 *
 * In release mode, the response includes per-variant breakdown showing
 * release-inference cost vs. judge cost, with the dominant-cost callout +
 * a hard-confirm flag when total >= $10. The same threshold gates the
 * multi-release-run kick.
 *
 * Usage:
 *   # Multi-release-run estimate (NEW)
 *   divinci qa estimate-run --suite <id> --releases r1,r2,r3 \
 *     [--rag-groups g1,g2] [--max-tests 50] [--judge gemini-3.5-flash] \
 *     [--batch-mode auto|force|never] [--batch-threshold 500] [--json]
 *
 *   # Arena-preset estimate (legacy)
 *   divinci qa estimate-run --suite <id> --arena-preset <id>
 *
 * Default judge model is `gemini-3.5-flash` (Google I/O 2026 launch) —
 * batch-eligible at $1.50/M input + $9.00/M output, 50% off under batch.
 * Override with `--judge gemini-2.5-flash` for the cheaper legacy tier,
 * or `--judge gemini-3.1-pro-preview` for the highest-accuracy non-batch
 * tier.
 */
export function registerQAEstimateRunCommand(parent: Command): void {
  parent
    .command("estimate-run")
    .description("Dry-run cost estimate for a QA suite sweep (release-mode itemizes per-variant)")
    .requiredOption("--suite <id>", "QA suite ID")
    .option("--arena-preset <id>", "Arena preset ID (legacy mode — judge-only cost)")
    .option(
      "--releases <ids>",
      "Comma-separated release IDs (release mode — per-variant itemized cost)",
    )
    .option(
      "--rag-groups <ids>",
      "Comma-separated RAG group IDs (cross-products with --releases, mirrors multi-release-run's -g)",
    )
    .option("--max-tests <n>", "Cap tests per variant (default: all suite tests)")
    .option("--judge <toolId>", "Judge model override. Default is gemini-3.5-flash (batch-eligible, $1.50/$9.00 per M tokens). Other batch-eligible: gemini-2.5-flash ($0.15/$0.60 per M), gemini-3.1-flash-lite-preview ($0.25/$1.50 per M). Non-batch: gemini-3.1-pro-preview ($2.00/$12.00 per M, ≤200K).")
    .option(
      "--input-tokens <n>",
      "Avg input tokens per release call (default 3000 — question + ~3 RAG chunks)",
    )
    .option(
      "--output-tokens <n>",
      "Avg output tokens per release call (default 500)",
    )
    .option(
      "--batch-mode <mode>",
      "Predict routing under this batchMode (auto|force|never). Default 'auto' so the estimate matches what multi-release-run will charge.",
      "auto",
    )
    .option(
      "--batch-threshold <n>",
      "Auto-mode threshold (judge calls). Default 500.",
      "500",
    )
    .option("--json", "Output raw JSON")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const body: Record<string, unknown> = {};
        if (opts.arenaPreset) body.arenaPresetId = opts.arenaPreset;
        if (opts.releases) {
          body.releaseIds = String(opts.releases).split(",").map((s: string) => s.trim()).filter(Boolean);
        }
        if (opts.ragGroups) {
          body.ragGroupIds = String(opts.ragGroups).split(",").map((s: string) => s.trim()).filter(Boolean);
        }
        if (opts.maxTests) body.maxTestsPerVariant = parseInt(opts.maxTests, 10);
        if (opts.judge) body.judgeModelOverride = opts.judge;
        if (opts.inputTokens || opts.outputTokens) {
          body.tokenAssumptions = {
            ...(opts.inputTokens ? { inputTokens: parseInt(opts.inputTokens, 10) } : {}),
            ...(opts.outputTokens ? { outputTokens: parseInt(opts.outputTokens, 10) } : {}),
          };
        }
        // Phase 2i: routing prediction. Validate early so the user sees a
        // clear error instead of a 400 from the server.
        const validBatchModes = ["auto", "force", "never"] as const;
        type BatchMode = typeof validBatchModes[number];
        const batchMode = String(opts.batchMode ?? "auto") as BatchMode;
        if (!validBatchModes.includes(batchMode)) {
          throw new Error(`Invalid --batch-mode '${opts.batchMode}'. Expected one of: ${validBatchModes.join(", ")}.`);
        }
        const batchThreshold = parseInt(opts.batchThreshold ?? "500", 10);
        if (!Number.isFinite(batchThreshold) || batchThreshold < 1) {
          throw new Error(`Invalid --batch-threshold '${opts.batchThreshold}'. Must be a positive integer.`);
        }
        body.batchMode = batchMode;
        body.batchThreshold = batchThreshold;

        if (!body.arenaPresetId && !body.releaseIds) {
          throw new Error("Must provide either --arena-preset <id> or --releases <ids>");
        }

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${opts.suite}/estimate`;

        const data = await withSpinner("Computing cost estimate...", async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as { mode: string; estimate: any }; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        if (opts.json || globalOpts.json) {
          output(data);
          return;
        }

        const est = data.estimate;
        // eslint-disable-next-line no-console
        console.log(`Mode: ${data.mode}`);
        if (data.mode === "multi-release" && Array.isArray(est.perVariant)) {
          // eslint-disable-next-line no-console
          console.log(`\n  ${est.perVariant.length} variant(s), ${est.estimatedReleaseCalls} release calls + ${est.estimatedJudgeCalls} judge calls`);
          // eslint-disable-next-line no-console
          console.log(`  Judge: ${est.effectiveJudgeToolId}${est.batchApiEligible ? " (batch-eligible)" : ""}`);

          // eslint-disable-next-line no-console
          console.log(`\n  Per-variant cost:`);
          for (const v of est.perVariant as Array<{ assistantId: string; title: string; testCount: number; totalUsd: { release: number; judges: number; all: number }; releaseSubsidized: boolean }>) {
            const subsidizedNote = v.releaseSubsidized ? " (subsidized)" : "";
            // eslint-disable-next-line no-console
            console.log(`    ${safeLabel(v.title, 50).padEnd(50)} | ${v.assistantId.padEnd(40)} | $${v.totalUsd.all.toFixed(2)} (rel: $${v.totalUsd.release.toFixed(2)}${subsidizedNote} + judges: $${v.totalUsd.judges.toFixed(2)})`);
          }
          // eslint-disable-next-line no-console
          console.log(`\n  Sync-rate total: $${est.totalUsd.toFixed(2)}`);
          if (est.routing) {
            const r = est.routing as { mode: string; threshold: number; willBatch: boolean; reason: string };
            const eff = typeof est.effectiveTotalUsd === "number" ? est.effectiveTotalUsd : est.totalUsd;
            // eslint-disable-next-line no-console
            console.log(`  Effective (predicted routing): $${eff.toFixed(2)} — ${r.willBatch ? "BATCH" : "SYNC"} (${r.reason})`);
          }
          if (est.batchApiSavingsUsd) {
            // eslint-disable-next-line no-console
            console.log(`  Batch-API savings if engaged: $${est.batchApiSavingsUsd.toFixed(2)}`);
          }
        } else {
          // Legacy arena-preset mode: simple flat output.
          // eslint-disable-next-line no-console
          console.log(`\n  ${est.variantCount} variant(s) × ${est.testsPerVariant} tests × ${est.llmScorerCount} scorers = ${est.estimatedJudgeCalls} judge calls`);
          // eslint-disable-next-line no-console
          console.log(`  Sync-rate total: $${est.estimatedCostUsd.toFixed(2)}`);
          if (est.routing) {
            const r = est.routing as { mode: string; threshold: number; willBatch: boolean; reason: string };
            const eff = typeof est.effectiveCostUsd === "number" ? est.effectiveCostUsd : est.estimatedCostUsd;
            // eslint-disable-next-line no-console
            console.log(`  Effective (predicted routing): $${eff.toFixed(2)} — ${r.willBatch ? "BATCH" : "SYNC"} (${r.reason})`);
          }
          if (est.batchApiSavingsUsd) {
            // eslint-disable-next-line no-console
            console.log(`  Batch-API savings if engaged: $${est.batchApiSavingsUsd.toFixed(2)}`);
          }
        }

        if (Array.isArray(est.warnings) && est.warnings.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`\n  ⚠ Warnings:`);
          for (const w of est.warnings) {
            // eslint-disable-next-line no-console
            console.log(`    • ${w}`);
          }
        }

        if (est.requiresHardConfirmation) {
          // eslint-disable-next-line no-console
          console.log(`\n  → To run anyway: divinci qa multi-release-run <suite> -r ... --confirm-cost`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
