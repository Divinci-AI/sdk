import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * divinci qa tests generate <ragFileId>
 *
 * Generate Q/A test pairs from a RAG file and add them to a QA suite.
 * Runs through every chunk in the file, generates questions via the prompt
 * generator, answers them via the specified release, and saves each pair
 * as a ScoredQATest in the target suite(s).
 *
 * Use this to expand a small QA suite (e.g., 20 tests) to 500+ before fine-tuning.
 *
 * Example:
 *   divinci qa tests generate <ragFileId> \
 *     --suite <suiteId> \
 *     --release <releaseId> \
 *     --qa-per-chunk 5 \
 *     --preset conversational
 */
export function registerQAGenerateTestsCommand(parent: Command): void {
  parent
    .command("generate <ragFileId>")
    .description("Generate Q/A test pairs from a RAG file and add them to a QA suite")
    .requiredOption("-s, --suite <id...>", "Target QA suite ID(s) to add tests to")
    .requiredOption("-r, --release <id>", "Release ID whose AI + RAG env generates expected answers")
    .option("-n, --qa-per-chunk <n>", "Q/A pairs generated per RAG chunk (1–10)", "3")
    .option(
      "--preset <name>",
      "Question generation style: conversational | factual-only | default",
      "conversational",
    )
    .option("--allow-duplicates", "Allow re-generating tests from chunks that already have tests", false)
    .option(
      "--prompt-tool-id <id>",
      "AI tool ID for question generation (default: divinci-internal Gemini Flash)",
    )
    .option("--prompt-auth-id <id>", "BYOK credential ID for the prompt generator tool")
    .action(async (ragFileId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        requireWorkspaceId(config);

        const suiteIds: string[] = Array.isArray(opts.suite) ? opts.suite : [opts.suite];
        const body: Record<string, unknown> = {
          ragFileId,
          suiteIds,
          releaseId: opts.release,
          qaPerChunk: parseInt(opts.qaPerChunk, 10),
          preset: opts.preset,
          noduplicateSources: !opts.allowDuplicates,
        };

        if (opts.promptToolId && opts.promptAuthId) {
          body.promptGenerator = { toolId: opts.promptToolId, authId: opts.promptAuthId };
        }

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const workspaceId = requireWorkspaceId(config);
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/tests/generate-from-rag-file`;

        const result = await withSpinner(
          `Generating Q/A tests from RAG file (${opts.qaPerChunk} per chunk, preset: ${opts.preset})...`,
          async () => {
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
            try { return JSON.parse(text) as any; }
            catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
          },
        );

        if (!globalOpts.json) {
          console.warn(`\nGenerated ${result.testCount} test(s) across ${suiteIds.length} suite(s)`);
          if (result.failedTests?.length > 0) {
            console.warn(`  Failed chunks: ${result.failedTests.length}`);
          }
          if (result.failedSuites?.length > 0) {
            console.warn(`  Failed suites: ${result.failedSuites.map((s: any) => s._id).join(", ")}`);
          }
          console.warn("");
        }

        output(result, { keyValue: !globalOpts.json });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
