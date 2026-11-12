import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { readFileSync } from "fs";

/**
 * Clone an existing preset under a new name, optionally swapping the
 * assistant ID on every variant. This is the primary path for creating
 * "Set C" from "Set A/B": clone the preset, change the assistant, done.
 *
 *   divinci arena-preset clone <presetId> --name "Set C — QLoRA v3" \
 *     --assistant-id gemma4-e2b-qlora-v3-rag
 *
 * Also supports import from a JSON file exported via:
 *   divinci arena-preset export <presetId> > set-a.json
 *   # edit set-a.json, then:
 *   divinci arena-preset clone --from-file set-a.json --name "Set C"
 */
export function registerArenaPresetCloneCommand(parent: Command): void {
  parent
    .command("clone [presetId]")
    .description("Clone an arena preset (optionally swap assistant on all variants)")
    .option("--name <name>", "Name for the new preset (defaults to '<original> (copy)')")
    .option("--assistant-id <id>", "Override assistantId on every variant")
    .option("--from-file <path>", "Import from an exported JSON file instead of cloning by ID")
    .action(async (presetId: string | undefined, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const baseUrl = config.apiUrl.replace(/\/+$/, "");

        if (!presetId && !opts.fromFile) {
          throw new Error("Provide a presetId to clone or --from-file <path> to import from JSON.");
        }

        // ── Resolve source preset ──────────────────────────────────────────
        let sourcePreset: any;
        if (opts.fromFile) {
          const raw = readFileSync(opts.fromFile, "utf8");
          const parsed = JSON.parse(raw);
          // Accept both export format {metadata, preset} and raw preset object
          sourcePreset = parsed?.preset ?? parsed;
        } else {
          const exportUrl = `${baseUrl}/white-label/${workspaceId}/arena/presets/${presetId}/export`;
          sourcePreset = await withSpinner("Exporting source preset...", async () => {
            const res = await fetch(exportUrl, {
              headers: { Authorization: `Bearer ${config.accessToken!}` },
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
            const parsed = JSON.parse(text) as any;
            return parsed?.preset ?? parsed;
          });
        }

        const newName = opts.name ?? `${sourcePreset.name ?? "Preset"} (copy)`;

        // ── Apply assistant override to every variant ──────────────────────
        const variants = (sourcePreset.variants ?? []).map((v: any) => {
          const updated = { ...v };
          if (opts.assistantId) {
            updated.config = { ...(v.config ?? {}), assistantId: opts.assistantId };
            delete updated.assistantId; // normalise: always in config for override
          }
          return updated;
        });

        const importBody = {
          metadata: { type: "arena-preset", version: "1.0", exportedAt: new Date().toISOString(), source: "divinci-ai" },
          preset: {
            name: newName,
            description: sourcePreset.description,
            variants,
            showModelNames: sourcePreset.showModelNames,
            mode: sourcePreset.mode,
            autoDisableAfterSelections: sourcePreset.autoDisableAfterSelections,
            cache: sourcePreset.cache,
            tags: sourcePreset.tags,
          },
        };

        const result = await withSpinner(`Creating preset "${newName}"...`, async () => {
          const res = await fetch(`${baseUrl}/white-label/${workspaceId}/arena/presets/import`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.accessToken!}`,
            },
            body: JSON.stringify(importBody),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as any; } catch { throw new Error(`Non-JSON: ${text.substring(0, 200)}`); }
        });

        const created = result?.preset ?? result;

        if (isJsonMode()) {
          output(created);
          return;
        }

        // eslint-disable-next-line no-console
        console.log(colors.green(`✔ Created preset "${newName}"`));
        // eslint-disable-next-line no-console
        console.log(`  ID: ${colors.cyanBold(created._id)}`);
        if (opts.assistantId) {
          // eslint-disable-next-line no-console
          console.log(`  Assistant override: ${colors.bold(opts.assistantId)} on ${variants.length} variant(s)`);
        }
        // eslint-disable-next-line no-console
        console.log(colors.dim(`\nRun: divinci qa arena-run <suiteId> --preset ${created._id} --judge-model gemini-3.1-flash-lite-preview`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
