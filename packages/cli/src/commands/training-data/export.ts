import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerTrainingDataExportCommand(parent: Command): void {
  parent
    .command("export <jobId>")
    .description("Export training data to a fine-tune file or QA suite")
    .option("--to-qa", "Export to QA test suite instead of fine-tune file")
    .option("--suite <ids...>", "Target QA suite IDs (required with --to-qa)")
    .option("--title <title>", "Title for the exported file")
    .option("--quality <n>", "Minimum quality score filter (0-1)")
    .option("--approved-only", "Only include approved pairs")
    .option("--max-tests <n>", "Maximum tests to create (QA export)")
    .option(
      "--sampling <strategy>",
      "Sampling strategy: none | random | stratified | quality-weighted | diverse",
      "none",
    )
    .action(async (jobId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        if (opts.toQa) {
          if (!opts.suite || opts.suite.length === 0) {
            console.error("Error: --suite is required when using --to-qa");
            process.exit(1);
          }

          const validStrategies = ["none", "random", "stratified", "quality-weighted", "diverse"];
          if (!validStrategies.includes(opts.sampling)) {
            console.error(`Error: invalid --sampling value "${opts.sampling}". Valid: ${validStrategies.join(", ")}`);
            process.exit(1);
          }

          const result = await withSpinner("Exporting to QA suite...", () =>
            client.trainingData.exportToQA(workspaceId, jobId, {
              targetSuiteIds: opts.suite,
              qualityThreshold: opts.quality ? parseFloat(opts.quality) : undefined,
              approvedOnly: opts.approvedOnly || false,
              maxTests: opts.maxTests ? parseInt(opts.maxTests, 10) : undefined,
              samplingStrategy: opts.sampling as any,
            })
          );

          // Surface sampling observability: "Sampled X from Y unique pairs (Z total, D duplicates removed)"
          const dedupCount = typeof result.pairsDeduped === "number" ? result.pairsDeduped : 0;
          const afterDedup = result.totalPairsScanned - (result.pairsFiltered || 0) - dedupCount;
          if (result.samplingStrategy && result.samplingStrategy !== "none") {
            console.warn(
              `Sampled ${result.testsCreated} from ${afterDedup.toLocaleString()} unique pairs ` +
              `(${result.totalPairsScanned.toLocaleString()} total, ${dedupCount.toLocaleString()} duplicates removed) ` +
              `using "${result.samplingStrategy}" strategy`,
            );
          } else {
            console.warn(`Exported ${result.testsCreated} tests to QA suite(s)`);
          }
          output(result, { keyValue: true });
        } else {
          const result = await withSpinner("Exporting to fine-tune file...", () =>
            client.trainingData.exportToFineTune(workspaceId, jobId, {
              title: opts.title,
              qualityThreshold: opts.quality ? parseFloat(opts.quality) : undefined,
              approvedOnly: opts.approvedOnly || false,
            })
          );

          console.warn(`Created fine-tune file with ${result.totalPairs} pairs`);
          output(result, { keyValue: true });
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
