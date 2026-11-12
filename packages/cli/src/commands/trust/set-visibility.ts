import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustPost } from "./_client.js";

interface VisibilityRunResponse {
  run: {
    runId: string;
    status: string;
    visibility: string;
    manifestR2Key?: string;
  };
}

export function registerTrustSetVisibilityCommand(parent: Command): void {
  parent
    .command("set-visibility <runId> <visibility>")
    .description(
      "Flip a TrustBench run between private and public (public endpoints only serve complete runs)"
    )
    .option(
      "--acknowledge-prompts-public",
      "Required with a public publish of a workspace benchmark: confirms the suite's questions, the answers and the judge's reasoning become readable by anyone, permanently",
      false,
    )
    .action(async (runId: string, visibility: string, opts, cmd) => {
      try {
        if (visibility !== "private" && visibility !== "public") {
          throw new Error("visibility must be 'private' or 'public'");
        }

        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const data = await trustPost<VisibilityRunResponse>(
          http,
          `/v1/trustbench/runs/${encodeURIComponent(runId)}/visibility`,
          { visibility, ...(opts.acknowledgePromptsPublic ? { acknowledgePromptsPublic: true } : {}) },
          { "X-Trustbench-Surface": "cli" }
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const run = data.run;
        // eslint-disable-next-line no-console
        console.log(
          `${colors.green("✔")} ${colors.cyanBold(run.runId)} is now ${run.visibility}` +
            (run.visibility === "public"
              ? " (public — manifest/outputs become verifiable when the run is complete)"
              : "")
        );
        if (run.manifestR2Key) {
          // eslint-disable-next-line no-console
          console.log(colors.dim(`  verify: divinci trust verify ${run.runId}`));
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}