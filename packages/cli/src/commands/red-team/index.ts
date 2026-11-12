/**
 * `divinci red-team` — probe a DEPLOYED release against the shared
 * TrustBench corpus. One category per API request (a full sweep is 32
 * billed model calls and would 524 at the edge); `--all` walks them
 * here, sequentially.
 */

import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import type { RedTeamBatchResponse } from "@divinci-ai/server";

/**
 * Local copy of the server SDK's RED_TEAM_CATEGORIES. Kept here so
 * `createProgram()` can register `--category` help without depending on
 * a freshly-built `@divinci-ai/server` dist — program.test.ts imports
 * the CLI entry at collect time.
 */
const RED_TEAM_CATEGORIES = [
  "prompt-injection",
  "jailbreak",
  "system-prompt-leak",
  "data-exfiltration",
  "harmful-content",
  "indirect-injection",
  "scope-violation",
] as const;

type RedTeamCategory = (typeof RED_TEAM_CATEGORIES)[number];

function isRedTeamCategory(value: unknown): value is RedTeamCategory {
  return (
    typeof value === "string" &&
    (RED_TEAM_CATEGORIES as readonly string[]).includes(value)
  );
}

function printBatch(batch: RedTeamBatchResponse): void {
  const rate = `${Math.round(batch.score.attackSuccessRate * 100)}%`;
  const weighted = `${Math.round(batch.score.weightedAttackSuccessRate * 100)}%`;
  const status = batch.measured ? "measured" : "NOT A SCORE (incomplete)";
  console.warn(`  ${batch.category}  asr=${rate}  weighted=${weighted}  ${status}`);
  if (!batch.measured) {
    if (batch.errors.length) {
      console.warn(`    errors: ${batch.errors.map((e) => `${e.probeId}: ${e.error}`).join("; ")}`);
    }
    if (batch.unmeasuredProbes.length) {
      console.warn(`    unmeasured: ${batch.unmeasuredProbes.join(", ")}`);
    }
  }
  if (batch.defense.moderationHeld > 0) {
    console.warn(`    ${batch.defense.note}`);
  }
  for (const item of batch.remediation) {
    console.warn(`    fix ${item.category}: ${item.remediation}`);
  }
}

export function registerRedTeamCommands(parent: Command): void {
  parent
    .command("plan")
    .description("Show the red-team corpus (categories, probe counts, billed-call note)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);
        const client = createClient(config);

        const plan = await withSpinner("Fetching red-team plan…", () =>
          client.redTeam.plan(workspaceId),
        );

        if (isJsonMode()) {
          output(plan);
          return;
        }
        console.warn(`${plan.totalProbes} probes across ${plan.categories.length} categories`);
        console.warn(plan.note);
        for (const c of plan.categories) {
          console.warn(
            `  ${c.category.padEnd(22)} ${String(c.probeCount ?? "?").padStart(2)}  ${c.severity.padEnd(8)}  ${c.title}`,
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("run")
    .description(
      "Red-team a DEPLOYED release. Pass --category for one class, or --all to walk every class.",
    )
    .requiredOption("--release <id>", "Release ID to probe (must be a deployed release)")
    .option(
      "--category <name>",
      `One category: ${RED_TEAM_CATEGORIES.join(" | ")}`,
    )
    .option("--all", "Walk every category sequentially (32 billed model calls)", false)
    .option(
      "--system-prompt <text>",
      "Operator system prompt — required to grade leak probes. Without it, leak probes are unmeasured, not clean.",
    )
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);
        const client = createClient(config);

        if (!opts.all && !opts.category) {
          throw new Error(
            "Pass --category <name> for one class, or --all to walk every class. " +
              `Categories: ${RED_TEAM_CATEGORIES.join(", ")}`,
          );
        }
        if (opts.category && !isRedTeamCategory(opts.category)) {
          throw new Error(
            `Unknown category "${opts.category}". Allowed: ${RED_TEAM_CATEGORIES.join(", ")}`,
          );
        }

        if (opts.all) {
          const sweep = await withSpinner("Running red-team sweep (every category)…", () =>
            client.redTeam.runSweep(workspaceId, {
              releaseId: opts.release,
              systemPrompt: opts.systemPrompt,
            }),
          );
          if (!isJsonMode()) {
            for (const batch of sweep.batches) printBatch(batch);
            const unmeasured = sweep.batches.filter((b) => !b.measured).length;
            if (unmeasured) {
              console.warn(
                `\n${unmeasured} categor${unmeasured === 1 ? "y was" : "ies were"} not fully measured — do not cite those rates.`,
              );
            }
          }
          output(sweep);
          return;
        }

        const batch = await withSpinner(`Running red-team category ${opts.category}…`, () =>
          client.redTeam.run(workspaceId, {
            releaseId: opts.release,
            category: opts.category,
            systemPrompt: opts.systemPrompt,
          }),
        );
        if (!isJsonMode()) printBatch(batch);
        output(batch);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
