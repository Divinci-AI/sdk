import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { colors } from "../../output/colors.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel } from "../../output/safe-text.js";

/**
 * `divinci model-edits` — activation-level knowledge editing.
 *
 * Suppress or restore one association the model carries, without fine-tuning.
 * The flow the subcommands are built around is describe → suppress → verify:
 * `describe` shows what the model actually holds for an entity, and its
 * relation/target are what `suppress` expects, so an edit targets something
 * demonstrable rather than a guess.
 */

type Association = {
  relation: string,
  target: string,
  confidence: number,
  rawScore: number,
  layer: number,
  neighbors: string[],
};

type ProbeResult = { deltaLogit: number, probeBefore: number, probeAfter: number };

type OutputShift = {
  top1Before: string | null,
  top1After: string | null,
  top1Changed: boolean,
  totalVariation: number,
  k: number,
};

type GateEvidence = {
  scoreBefore: number | null,
  scoreAfter: number | null,
  layer: number,
  feature: number,
};

type Edit = {
  id: string,
  op: "INSERT" | "DELETE",
  entity: string,
  relation: string,
  target: string,
  status: "PENDING" | "COMMITTED" | "REVERTED",
  modelVersion: string,
  appliedAt: string,
  committedAt?: string,
  revertedAt?: string,
  probeResult?: ProbeResult,
  outputShift?: OutputShift,
  gateEvidence?: GateEvidence,
  larqlRuntime?: string,
  kind?: "ffn_delete" | "ffn_insert" | "output_override" | null,
};

/**
 * One line per kind saying what the edit certifies. The two primitives sit on
 * opposite sides of a line on the one model measured: an FFN delete is
 * visible in the index and left the answer unchanged; a KNN override changes
 * the answer and is invisible in the index. Saying which is the whole point.
 */
const KIND_LINE: Record<NonNullable<Edit["kind"]>, string> = {
  ffn_delete: "ffn_delete — removed from the feature index; does not by itself change what the model answers",
  ffn_insert: "ffn_insert — new features in the index, keyed on the measured prompt",
  output_override: "output_override — answer replaced on the measured prompt; index untouched, not forgetting",
};

/** A 0..1 confidence as a short bar, so a list scans without reading numbers. */
function bar(confidence: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(confidence * 10)));
  return "█".repeat(filled) + colors.dim("░".repeat(10 - filled));
}

function statusColor(status: Edit["status"]): string {
  if (status === "COMMITTED") return colors.green(status);
  if (status === "REVERTED") return colors.dim(status);
  return colors.yellow(status);
}

/**
 * Render what was actually measured about an edit.
 *
 * Three measurements exist and they are not interchangeable:
 *
 *   gate         deterministic, in the space the edit acts on. A DELETE that
 *                leaves the score unchanged did not take effect.
 *   output shift how much of the model's next-token probability mass moved.
 *                Measurable for every edit, because it needs no target token.
 *   probe        the target token's own probability. The weakest of the three:
 *                it needs the DESCRIBE target to appear in the model's top-k,
 *                and that target comes from gate space, so it usually does not.
 *
 * This used to print the probe alone, so the most commonly absent measurement
 * decided whether the edit looked measured at all. Edits carrying a real output
 * shift were reported as "not measured" — advice to go and re-verify something
 * that had already been verified.
 *
 * "Not measured" is now said only when nothing was measured, and it stays
 * distinct from "measured, and nothing moved". Those are opposite facts.
 */
function printEvidence(e: Edit): void {
  const { probeResult: probe, outputShift: shift, gateEvidence: gate } = e;

  if (e.kind) {
    console.log(colors.dim(`  kind:   ${KIND_LINE[e.kind]}`));
  }

  if (!probe && !shift && !gate) {
    console.log(
      colors.dim("  not measured — the edit is applied, but its effect was not observed"),
    );
    return;
  }

  if (gate) {
    const before = gate.scoreBefore === null ? "absent" : gate.scoreBefore.toFixed(1);
    // An absent edge is the SUCCESS case for a suppression: the association is
    // gone from the index, not merely scoring zero. Rendering it as 0.0 would
    // read as failure.
    const after = gate.scoreAfter === null ? colors.green("suppressed") : gate.scoreAfter.toFixed(1);
    console.log(`  gate:   ${before} → ${after}  ${colors.dim(`L${gate.layer}·f${gate.feature}`)}`);
  }

  if (shift) {
    const tv = shift.totalVariation;
    const tint = tv < 1e-4 ? colors.yellow : colors.green;
    const moved = shift.top1Changed ? "top-1 changed" : "top-1 unchanged";
    console.log(
      `  output: ${tint(`${tv.toFixed(4)} TV`)}  ${colors.dim(`${moved}, k=${shift.k}`)}`,
    );
    if (tv < 1e-4) {
      console.log(
        colors.yellow("  Nothing measurably moved for that prompt. The edit is recorded, but"),
      );
      console.log(
        colors.yellow("  treat the fact as unchanged until you can show otherwise."),
      );
    }
  }

  if (probe) {
    const { deltaLogit, probeBefore, probeAfter } = probe;
    const delta = deltaLogit >= 0 ? `+${deltaLogit.toFixed(4)}` : deltaLogit.toFixed(4);
    const tint = Math.abs(deltaLogit) < 1e-4 ? colors.yellow : colors.green;
    console.log(
      `  probe:  ${probeBefore.toFixed(4)} → ${probeAfter.toFixed(4)}  ${tint(`Δ ${delta}`)}`,
    );
  } else if (shift || gate) {
    // Absent probe is the norm, not a problem, once something else was
    // measured. Say so, so nobody reads silence as a failed measurement.
    console.log(colors.dim("  probe:  n/a — the target does not surface in the model's top-k"));
  }

  if (e.larqlRuntime) {
    // Neither measurement is interpretable without it: before larql 2017b761 a
    // DELETE reached the gate index but not the forward pass.
    console.log(colors.dim(`  runtime: ${e.larqlRuntime}`));
  }
}

function printEdit(e: Edit): void {
  console.log(
    `${colors.cyanBold(safeLabel(e.entity))} ${colors.dim("→")} ${safeLabel(e.relation)} ${colors.dim("→")} ${colors.cyanBold(safeLabel(e.target))}`,
  );
  console.log(
    `  ${colors.dim(e.id)}  ${e.op}  ${statusColor(e.status)}  ${colors.dim(`model ${e.modelVersion}`)}`,
  );
  printEvidence(e);
}

export function registerModelEditsCommand(program: Command): void {
  const edits = program
    .command("model-edits")
    .description("Suppress or restore what the model associates with an entity (activation-level editing)");

  edits
    .command("describe <entity>")
    .description("Show the associations the model carries for an entity, strongest first")
    .option(
      "--find <target>",
      "Pin one association into the list even if it ranks below the strongest (the fact you came to edit often does)",
    )
    .action(async (entity: string, opts: { find?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const result = await withSpinner(`Describing ${entity}`, () =>
          client.modelEdits.describe(entity, undefined, opts.find),
        );

        if (isJsonMode()) return output(result);

        const assocs = result.associations as Association[];
        if (!assocs.length) {
          console.log(
            colors.dim(`No associations found for "${entity}". Nothing here is suppressible.`),
          );
          return;
        }
        console.log(colors.cyanBold(safeLabel(result.entity)));
        for (const a of assocs) {
          console.log(
            `  ${bar(a.confidence)} ${(a.confidence * 100).toFixed(0).padStart(3)}%  ` +
              `${safeLabel(a.relation)} ${colors.dim("→")} ${colors.cyanBold(safeLabel(a.target))}  ` +
              colors.dim(`L${a.layer}`),
          );
          if (a.neighbors?.length) {
            console.log(colors.dim(`         also: ${a.neighbors.map(safeLabel).join(", ")}`));
          }
        }
        console.log();
        console.log(
          colors.dim("Suppress one:  divinci model-edits suppress <entity> --relation <r> --target <t>"),
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("list")
    .description("List edits, newest first")
    .option("--status <status>", "Filter by status: PENDING, COMMITTED, or REVERTED")
    .option("--entity <entity>", "Filter by entity")
    .action(async (opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const list = (await withSpinner("Listing edits", () =>
          client.modelEdits.list({
            status: opts.status?.toUpperCase(),
            entity: opts.entity,
          }),
        )) as Edit[];

        if (isJsonMode()) return output(list);
        if (!list.length) {
          console.log(colors.dim("No edits yet. Start with: divinci model-edits describe <entity>"));
          return;
        }
        list.forEach((e) => {
          printEdit(e);
          console.log();
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("get <editId>")
    .description("Show one edit")
    .action(async (editId: string, _opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const edit = (await withSpinner("Fetching edit", () =>
          client.modelEdits.get(editId),
        )) as Edit;

        if (isJsonMode()) return output(edit);
        printEdit(edit);
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("suppress <entity>")
    .description("Suppress the model's association between an entity and a target")
    .requiredOption("--relation <relation>", "Relation label (from `model-edits describe`)")
    .requiredOption("--target <target>", "Target the model associates with the entity")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (entity: string, opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        if (!opts.yes && !isJsonMode()) {
          const ok = await confirm({
            message: `Suppress "${entity} → ${opts.relation} → ${opts.target}" for this workspace's model?`,
            default: false,
          });
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }

        const result = (await withSpinner("Applying edit", () =>
          client.modelEdits.create({
            entity,
            relation: opts.relation,
            target: opts.target,
            op: "DELETE",
          }),
        )) as Edit & { confidence: number, activeEditCount: number };

        if (isJsonMode()) return output(result);

        console.log(colors.green("Edit applied."));
        printEdit(result);
        console.log();
        // Said on every suppression, not buried in --help: the mechanism is
        // rank-1, and a user who reads "suppressed" as "forgotten" will
        // over-claim it to someone else.
        console.log(
          colors.yellow("This removes the model's primary association for that fact."),
        );
        console.log(
          colors.yellow("Paraphrases and indirect routes to the same fact may survive it — verify"),
        );
        console.log(
          colors.yellow("with `model-edits describe` rather than assuming the fact is gone."),
        );
        console.log();
        console.log(colors.dim(`Undo:  divinci model-edits revert ${result.id}`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("restore <entity>")
    .description("Restore (re-assert) an association between an entity and a target")
    .requiredOption("--relation <relation>", "Relation label")
    .requiredOption("--target <target>", "Target to associate with the entity")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (entity: string, opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        if (!opts.yes && !isJsonMode()) {
          const ok = await confirm({
            message: `Restore "${entity} → ${opts.relation} → ${opts.target}"?`,
            default: false,
          });
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }

        const result = (await withSpinner("Applying edit", () =>
          client.modelEdits.create({
            entity,
            relation: opts.relation,
            target: opts.target,
            op: "INSERT",
          }),
        )) as Edit;

        if (isJsonMode()) return output(result);
        console.log(colors.green("Edit applied."));
        printEdit(result);
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("revert <editId>")
    .description("Revert an edit, undoing its effect")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (editId: string, opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        if (!opts.yes && !isJsonMode()) {
          const ok = await confirm({
            message: `Revert edit ${editId}?`,
            default: false,
          });
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }

        const result = await withSpinner("Reverting edit", () =>
          client.modelEdits.revert(editId),
        );

        if (isJsonMode()) return output(result);
        console.log(colors.green("Edit reverted."));
        console.log(
          `${colors.cyanBold(safeLabel(result.entity))} ${colors.dim("→")} ${safeLabel(result.relation)} ${colors.dim("→")} ${colors.cyanBold(safeLabel(result.target))}`,
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("ask <question>")
    .description("Ask the edited model a question and show what it predicts next (an added fact shows as the patched answer)")
    .option("--top <n>", "How many next tokens to show", "8")
    .action(async (question: string, opts: { top: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const result = await withSpinner("Asking the model", () =>
          client.modelEdits.probe(question, undefined, Number(opts.top) || 8),
        );
        if (isJsonMode()) return output(result);
        console.log(colors.dim(`"${safeLabel(result.prompt)}"  (${result.style} chat format)`));
        const rows = result.predictions ?? [];
        if (result.override) {
          console.log(
            `  ${colors.green("patched answer")}  ${colors.cyanBold(safeLabel(result.override.token.trim()))}  ` +
              colors.dim(`layer ${result.override.layer}`),
          );
        }
        for (const [i, p] of rows.entries()) {
          const overridden = result.override && i === 0;
          const label = safeLabel(p.token.trim() || "␣");
          console.log(
            `  ${bar(p.probability)} ${(p.probability * 100).toFixed(1).padStart(5)}%  ` +
              (overridden ? colors.dim(`${label}  (overridden by the patch)`) : label),
          );
        }
        if (!rows.length) console.log(colors.dim("  (no predictions returned)"));
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("replace <entity>")
    .description("Change a fact: suppress the target the model holds, then add the new one (two edits, each revertible)")
    .requiredOption("--relation <relation>", "The word that completes \"the ___ of <entity> is\" (e.g. capital)")
    .requiredOption("--from <oldTarget>", "The target the model holds now")
    .requiredOption("--to <newTarget>", "The target to teach instead")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (entity: string, opts: { relation: string; from: string; to: string; yes?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        if (!opts.yes && !isJsonMode()) {
          const ok = await confirm({
            message: `Replace "${entity} → ${opts.relation} → ${opts.from}" with "${opts.to}"?`,
            default: false,
          });
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }
        const result = await withSpinner("Applying two edits", () =>
          client.modelEdits.replace({
            entity,
            relation: opts.relation,
            oldTarget: opts.from,
            newTarget: opts.to,
          }, undefined),
        );
        if (isJsonMode()) return output(result);
        console.log(colors.green("Replaced."));
        printEdit(result.suppressed as unknown as Edit);
        printEdit(result.added as unknown as Edit);
        console.log();
        console.log(colors.dim(`Check:  divinci model-edits ask "What is the ${opts.relation} of ${entity}? Answer with one word."`));
        console.log(colors.dim(`Undo:   divinci model-edits revert ${result.added.id}  (and ${result.suppressed.id})`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  edits
    .command("export")
    .description("Export the receipt: model, every edit with its evidence, every version, and what is active now")
    .option("--out <file>", "Write JSON to a file instead of stdout")
    .action(async (opts: { out?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const receipt = await withSpinner("Exporting", () => client.modelEdits.export());
        if (opts.out) {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(opts.out, JSON.stringify(receipt, null, 2));
          if (!isJsonMode()) console.log(colors.green(`Wrote ${opts.out}`));
          return;
        }
        return output(receipt);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── Versions ──
  const versions = edits
    .command("versions")
    .description("Numbered snapshots of the active edits — record, restore, and see which QA runs scored under each");

  const printVersion = (v: {
    id: string;
    version: number;
    patchCount: number;
    source: string;
    createdBy: string;
    createdAt: string;
    changelog?: string;
    patches: Array<{ op: string; entity: string; relation: string; target: string }>;
  }, withPatches = false) => {
    const when = new Date(v.createdAt).toLocaleString();
    console.log(
      `${colors.cyanBold(`v${v.version}`)}  ${v.patchCount} patch${v.patchCount === 1 ? "" : "es"}  ` +
        colors.dim(`${v.source} · ${safeLabel(v.createdBy)} · ${when} · ${v.id}`) +
        (v.changelog ? `  ${safeLabel(v.changelog)}` : ""),
    );
    if (withPatches) {
      for (const p of v.patches) {
        const sign = p.op === "DELETE" ? colors.red("−") : colors.green("+");
        console.log(`    ${sign} ${safeLabel(p.entity)} ${colors.dim(safeLabel(p.relation))} ${colors.dim("→")} ${safeLabel(p.target)}`);
      }
    }
  };

  versions
    .command("list")
    .description("List versions, newest first")
    .option("--limit <n>", "How many to show", "50")
    .action(async (opts: { limit: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const list = await withSpinner("Fetching versions", () =>
          client.modelEdits.listVersions(undefined, Number(opts.limit) || 50),
        );
        if (isJsonMode()) return output(list);
        if (!list.length) {
          console.log(colors.dim("No versions yet. Save one with: divinci model-edits versions save"));
          return;
        }
        for (const v of list) printVersion(v);
      } catch (error) {
        handleCommandError(error);
      }
    });

  versions
    .command("get <ref>")
    .description("Show one version and its patches (id, or a number like 3 / v3)")
    .action(async (ref: string, _opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const v = await withSpinner("Fetching version", () => client.modelEdits.getVersion(ref));
        if (isJsonMode()) return output(v);
        printVersion(v, true);
      } catch (error) {
        handleCommandError(error);
      }
    });

  versions
    .command("save")
    .description("Freeze the active edits as a version (returns the existing one if nothing changed)")
    .option("--changelog <text>", "A note for the version")
    .action(async (opts: { changelog?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const { version, created } = await withSpinner("Saving version", () =>
          client.modelEdits.saveVersion(undefined, opts.changelog),
        );
        if (isJsonMode()) return output({ version, created });
        console.log(created ? colors.green("Version saved.") : colors.dim("Active set unchanged — this version already exists."));
        printVersion(version, true);
      } catch (error) {
        handleCommandError(error);
      }
    });

  versions
    .command("restore <ref>")
    .description("Make the active edits equal to a version's set (recorded as a version itself)")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (ref: string, opts: { yes?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        if (!opts.yes && !isJsonMode()) {
          const ok = await confirm({
            message: `Restore model edits version ${ref}? Edits not in it are reverted; its edits are re-applied.`,
            default: false,
          });
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }
        const result = await withSpinner("Restoring version", () => client.modelEdits.restoreVersion(ref));
        if (isJsonMode()) return output(result);
        console.log(
          colors.green(`Restored v${result.restoredFrom.version}.`) +
            colors.dim(`  reverted ${result.reverted}, re-applied ${result.reapplied}`),
        );
        printVersion(result.version, true);
      } catch (error) {
        handleCommandError(error);
      }
    });

  versions
    .command("qa-runs <ref>")
    .description("QA runs that scored while this version was in force")
    .action(async (ref: string, _opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const { version, runs } = await withSpinner("Fetching QA runs", () => client.modelEdits.versionQaRuns(ref));
        if (isJsonMode()) return output({ version, runs });
        printVersion(version);
        if (!runs.length) {
          console.log(colors.dim("  No QA runs recorded under this version."));
          return;
        }
        for (const r of runs) {
          const score = r.avgScore == null ? "n/a" : `${(r.avgScore * 100).toFixed(1)}%`;
          const when = r.completedAt ? new Date(r.completedAt).toLocaleString() : "";
          console.log(
            `  ${score.padStart(6)}  ${r.tests} tests  ` +
              colors.dim(`suite ${safeLabel(r.suiteId ?? "?")} · release ${safeLabel(r.releaseSlugVersion ?? r.releaseId ?? "?")} · ${r.status ?? ""} ${when} · run ${r.iterationResultId}`),
          );
        }
        console.log();
        console.log(
          colors.yellow("Patches do not reach the live chat path yet, so this is which edits were in force, not their effect on the score."),
        );
      } catch (error) {
        handleCommandError(error);
      }
    });
}
