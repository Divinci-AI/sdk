import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerQARunCommand(parent: Command): void {
  parent
    .command("run <suiteId>")
    .description("Run QA validation against a release")
    .requiredOption("--release <id>", "Release ID to test against")
    .option("--max-tests <n>", "Maximum tests to run", "100")
    .option("--concurrency <n>", "Parallel test concurrency (1-10)", "3")
    .option("--summary", "Show only summary (suppress per-test output)")
    .action(async (suiteId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        const result = await withSpinner("Running QA validation...", () =>
          client.qa.run(workspaceId, suiteId, {
            releaseId: opts.release,
            maxTests: parseInt(opts.maxTests, 10),
            concurrency: parseInt(opts.concurrency, 10),
          })
        );

        // Show per-test results unless --summary
        if (!opts.summary && !globalOpts.json) {
          for (const r of result.results || []) {
            const icon = r.overallScore !== null && r.overallScore >= 0.5 ? "\u2713" : "\u2717";
            const score = r.overallScore !== null ? `${(r.overallScore * 100).toFixed(0)}%` : "N/A";
            console.warn(`  ${icon} ${r.prompt?.substring(0, 60)}... (${score})`);
          }
          for (const e of result.errors || []) {
            console.warn(`  ! ${e.testId}: ${e.error}`);
          }
          console.warn("");
        }

        // Summary
        if (!globalOpts.json) {
          const score = result.overallScore !== null
            ? `${(result.overallScore * 100).toFixed(1)}%`
            : "N/A";
          const delta = result.delta !== null
            ? ` (${result.delta >= 0 ? "+" : ""}${(result.delta * 100).toFixed(1)}%)`
            : "";
          console.warn(`Score: ${score}${delta}`);
          console.warn(`Tests: ${result.passedCount}/${result.testCount} passed`);
          if (result.errorCount) console.warn(`Errors: ${result.errorCount}`);
          if (result.deadlineReached) console.warn("Note: Deadline reached, not all tests completed");
        }

        output(result, { keyValue: !globalOpts.json });

        // Exit code: 0 = all pass, 1 = failures, 2 = infra error
        if (result.errorCount > 0 && result.passedCount === 0) {
          process.exit(2);
        } else if (result.overallScore !== null && result.overallScore < 0.5) {
          process.exit(1);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
