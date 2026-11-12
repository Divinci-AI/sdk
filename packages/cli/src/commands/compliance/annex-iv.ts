import { Command } from "commander";
import { writeFile } from "fs/promises";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { complianceFetch, type Dossier } from "./_client.js";

const STATUS_MARK: Record<string, string> = {
  generated: "●",
  partial: "◐",
  "requires-input": "○",
};

export function registerComplianceAnnexIvCommand(parent: Command): void {
  parent
    .command("annex-iv <releaseId>")
    .description("Generate the EU AI Act Annex IV technical-documentation dossier for a release")
    .option("--format <format>", "json | markdown", "text")
    .option("--output <file>", "Write to a file instead of stdout")
    .option("--gaps-only", "List only the outstanding items", false)
    .action(async (releaseId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const wantMarkdown = opts.format === "markdown" || opts.format === "md";

        const res = await withSpinner("Building dossier...", () =>
          complianceFetch(
            globalOpts,
            `/annex-iv/${encodeURIComponent(releaseId)}${wantMarkdown ? "?format=markdown" : ""}`,
          ),
        );

        if (wantMarkdown) {
          if (opts.output) {
            await writeFile(opts.output, res.text, "utf8");
            console.log(colors.green(`Wrote ${opts.output}`));
            return;
          }
          console.log(res.text);
          return;
        }

        const dossier = res.json<Dossier>();

        if (opts.output) {
          await writeFile(opts.output, JSON.stringify(dossier, null, 2), "utf8");
          console.log(colors.green(`Wrote ${opts.output}`));
          return;
        }
        if (isJsonMode() || opts.format === "json") {
          output(dossier);
          return;
        }

        // ── Human-readable summary ──────────────────────────────────────────
        const c = dossier.completeness;
        console.log("");
        console.log(colors.bold(`EU AI Act — Annex IV · ${dossier.system.name}`));
        console.log(
          colors.dim(
            `release ${dossier.system.releaseId} v${dossier.system.version} · dossier ${dossier.dossierId}`,
          ),
        );
        console.log("");
        console.log(
          `${colors.bold("Coverage")}  ${c.generated} generated · ${c.partial} partial · ` +
            `${c.requiresInput} require input · ${colors.bold(`${c.openGaps} open items`)}`,
        );
        console.log(
          colors.dim("This is a draft, not a declaration of conformity."),
        );
        console.log("");

        for (const [i, s] of dossier.sections.entries()) {
          const gapCount = s.gaps.length;
          if (opts.gapsOnly && gapCount === 0) continue;
          const mark = STATUS_MARK[s.status] ?? "?";
          const tint =
            s.status === "generated"
              ? colors.green
              : s.status === "partial"
                ? colors.yellow
                : colors.dim;
          console.log(
            `${tint(mark)} ${String(i + 1).padStart(2)}. ${s.title}  ${colors.dim(
              gapCount === 0 ? "no open items" : `${gapCount} open`,
            )}`,
          );
          for (const g of s.gaps) {
            // Say which gaps a human can close by writing, and which need the
            // system to change — they are not interchangeable.
            const how =
              g.kind === "requires-answer"
                ? colors.yellow(`answerable · divinci compliance answer ${g.id} "..."`)
                : colors.dim("requires a change to the system");
            console.log(`     ${colors.dim("-")} ${g.text}`);
            console.log(`       ${how}`);
          }
        }
        console.log("");
      } catch (error) {
        handleCommandError(error);
      }
    });
}
