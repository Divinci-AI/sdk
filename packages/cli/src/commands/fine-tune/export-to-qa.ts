import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

type Strategy = "none" | "random" | "stratified" | "quality-weighted" | "diverse";
const VALID_STRATEGIES: Strategy[] = ["none", "random", "stratified", "quality-weighted", "diverse"];

export function registerFineTuneExportToQACommand(parent: Command): void {
  parent
    .command("export-to-qa <fileId>")
    .description("Sample Q&A pairs from a FineTuneFile and create ScoredQATest docs in one or more QA suites")
    .requiredOption("-s, --suite <id...>", "One or more target QASuite IDs (pass flag multiple times or space-separate)")
    .option("-m, --max-tests <number>", "Maximum tests to create (1–500)", "500")
    .option(
      "--sampling <strategy>",
      `Sampling strategy (${VALID_STRATEGIES.join("|")})`,
      "random",
    )
    .option("--workspace-override <id>", "Target workspace for created tests (raw or condensed)")
    .action(async (fileId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const strategy = opts.sampling as Strategy;
        if (!VALID_STRATEGIES.includes(strategy)) {
          throw new Error(`Invalid --sampling value "${opts.sampling}". Must be one of: ${VALID_STRATEGIES.join(", ")}`);
        }

        const targetSuiteIds: string[] = Array.isArray(opts.suite)
          ? opts.suite
          : [opts.suite];
        if (targetSuiteIds.length === 0) {
          throw new Error("At least one --suite is required");
        }

        const maxTests = parseInt(opts.maxTests, 10);
        if (!Number.isFinite(maxTests) || maxTests < 1) {
          throw new Error(`Invalid --max-tests value "${opts.maxTests}"`);
        }

        const data = await withSpinner(
          `Sampling from fine-tune file ${fileId}...`,
          () =>
            client.fineTune.exportFileToQA(fileId, {
              targetSuiteIds,
              maxTests,
              samplingStrategy: strategy,
              workspaceOverride: opts.workspaceOverride,
            }),
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
