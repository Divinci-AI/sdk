import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { complianceFetch } from "./_client.js";

interface StoredAnswer {
  gapId: string;
  releaseId: string | null;
  value: string;
  answeredBy: string;
  answeredAt: string;
}

export function registerComplianceAnswerCommands(parent: Command): void {
  parent
    .command("answers")
    .description("List stored answers to Annex IV gaps")
    .action(async (_opts, cmd) => {
      try {
        const res = await withSpinner("Fetching answers...", () =>
          complianceFetch(cmd.optsWithGlobals(), "/answers"),
        );
        const { answers } = res.json<{ answers: StoredAnswer[] }>();
        if (isJsonMode()) return output(answers);
        if (!answers.length) {
          console.log(colors.dim("No stored answers yet."));
          return;
        }
        output(
          answers.map((a) => ({
            gapId: a.gapId,
            scope: a.releaseId ?? "workspace",
            value: a.value.length > 60 ? `${a.value.slice(0, 57)}...` : a.value,
            answeredBy: a.answeredBy,
            answeredAt: a.answeredAt,
          })),
          {
            table: {
              columns: [
                { key: "gapId", header: "Gap" },
                { key: "scope", header: "Scope" },
                { key: "value", header: "Answer" },
                { key: "answeredBy", header: "By" },
                { key: "answeredAt", header: "When" },
              ],
            },
          },
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("answer <gapId> <value>")
    .description("Answer an Annex IV gap (closes it in every export)")
    .option(
      "--release <releaseId>",
      "Scope the answer to one release; omit for a workspace-wide answer every release inherits",
    )
    .action(async (gapId: string, value: string, opts, cmd) => {
      try {
        await withSpinner("Saving answer...", () =>
          complianceFetch(cmd.optsWithGlobals(), `/answers/${encodeURIComponent(gapId)}`, {
            method: "PUT",
            body: { value, releaseId: opts.release ?? null },
          }),
        );
        console.log(
          colors.green(
            `Answered ${gapId} (${opts.release ? `release ${opts.release}` : "workspace-wide"}).`,
          ),
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("unanswer <gapId>")
    .description("Remove a stored answer, reopening the gap")
    .option("--release <releaseId>", "Target a release-scoped answer")
    .action(async (gapId: string, opts, cmd) => {
      try {
        const qs = opts.release ? `?releaseId=${encodeURIComponent(opts.release)}` : "";
        const res = await withSpinner("Removing answer...", () =>
          complianceFetch(cmd.optsWithGlobals(), `/answers/${encodeURIComponent(gapId)}${qs}`, {
            method: "DELETE",
          }),
        );
        const { deleted } = res.json<{ deleted: boolean }>();
        console.log(
          deleted
            ? colors.green(`Removed the answer for ${gapId}.`)
            : colors.dim(`No stored answer for ${gapId} in that scope.`),
        );
      } catch (error) {
        handleCommandError(error);
      }
    });
}
