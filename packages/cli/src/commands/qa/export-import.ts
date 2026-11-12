import { Command } from "commander";
import { promises as fs } from "fs";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa export <suiteId> [-o file] [--format yaml|json]`
 *
 * Snapshot a QA suite (metadata + scoreGenerators + suggestionGeneration
 * + calibrationConfig + all tests) to a portable YAML or JSON file. The
 * output is round-trippable via `divinci qa import`.
 *
 * What's NOT included: workspace ID, calibration ratings, run results,
 * fine-tune file references, RAG context. See the schema doc in
 * server-side qa-suite/export-import.ts for the full v1 contract.
 *
 * Default format is yaml (git-diff friendly). Use --format json for
 * machine-pipelines.
 *
 * Examples:
 *   divinci qa export <whitelabelId> -o my-suite.yaml
 *   divinci qa export <whitelabelId> --format json | jq '.tests | length'
 */
export function registerQAExportCommand(parent: Command): void {
  parent
    .command("export <suiteId>")
    .description("Export a QA suite (metadata + tests) to YAML or JSON for version control / cross-workspace migration")
    .option("-o, --output <file>", "Write to this file instead of stdout")
    .option("--format <format>", "Output format: yaml (default) or json", "yaml")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        const format = opts.format === "json" ? "json" : "yaml";
        const url = `${apiBase}/white-label/${workspaceId}/scored-qa/suites/${suiteId}/export?format=${format}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await r.text();
        if (!r.ok) {
          process.stderr.write(`❌ HTTP ${r.status}: ${body.substring(0, 500)}\n`);
          process.exit(1);
        }

        if (opts.output) {
          await fs.writeFile(opts.output, body);
          const sizeKb = (body.length / 1024).toFixed(1);
          process.stderr.write(`✅ Exported to ${opts.output} (${sizeKb} KB, format=${format})\n`);
        } else {
          process.stdout.write(body);
          if (!body.endsWith("\n")) process.stdout.write("\n");
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}

/**
 * `divinci qa import <file> [--name "..."]`
 *
 * Create a new QA suite in the current workspace from a YAML or JSON
 * export file. The schema version is checked; mismatched files are
 * rejected with an actionable error.
 *
 * `--name` overrides the suite name from the file (lets you fork-as-v2
 * without editing the YAML). Tests get fresh IDs in the target workspace
 * but their original sourceTestId is preserved as edit-id provenance.
 *
 * Examples:
 *   divinci qa import my-suite.yaml
 *   divinci qa import my-suite.yaml --name "My Calibration Suite v2"
 */
export function registerQAImportCommand(parent: Command): void {
  parent
    .command("import <file>")
    .description("Import a QA suite from a YAML or JSON export file. Use --name to override the suite name.")
    .option("--name <name>", "Override the suite name from the file (handy for fork-as-v2 patterns)")
    .addHelpText("after", `
The file is a \`qa export\` document ({"divinciQASuite": "v1", ...}). To make a
suite from your own questions, you do not need one:
  divinci qa suites create --name "My suite" --tests tests.jsonl
  divinci qa tests add <suiteId> --file tests.jsonl`)
    .action(async (file: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        const fileText = await fs.readFile(file, "utf-8");
        // Detect format by extension or by first non-whitespace char
        const looksJson = file.endsWith(".json") || fileText.trimStart().startsWith("{");
        const body = looksJson
          ? JSON.stringify({ json: JSON.parse(fileText), newName: opts.name })
          : JSON.stringify({ yaml: fileText, newName: opts.name });

        const url = `${apiBase}/white-label/${workspaceId}/scored-qa/suites/import`;
        process.stderr.write(`POST ${url}  (format=${looksJson ? "json" : "yaml"}, override-name=${opts.name ?? "(none)"})\n`);

        const r = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body,
        });
        const responseText = await r.text();
        if (!r.ok) {
          process.stderr.write(`❌ HTTP ${r.status}: ${responseText.substring(0, 500)}\n`);
          process.exit(1);
        }

        let result: {
          newSuiteId: string;
          newSuiteName: string;
          testsImported: number;
          testsSkipped: number;
          skippedReasons?: Array<{ index: number, reason: string }>;
          schemaVersion: string;
          sourceWorkspace?: string;
          sourceSuiteId?: string;
        };
        try {
          result = JSON.parse(responseText);
        } catch {
          process.stderr.write(`❌ Failed to parse response: ${responseText.substring(0, 200)}\n`);
          process.exit(1);
          return;
        }

        const lines = [
          ``,
          `✅ Imported QA suite to workspace ${workspaceId}`,
          ``,
          `  New suite ID:                    ${result.newSuiteId}`,
          `  Name:                            ${result.newSuiteName}`,
          `  Tests imported:                  ${result.testsImported}`,
          `  Tests skipped:                   ${result.testsSkipped}`,
          `  Schema version:                  ${result.schemaVersion}`,
        ];
        if (result.sourceWorkspace) {
          lines.push(`  Source workspace:                ${result.sourceWorkspace}`);
        }
        if (result.sourceSuiteId) {
          lines.push(`  Source suite ID:                 ${result.sourceSuiteId}`);
        }
        lines.push(``);
        process.stdout.write(lines.join("\n"));

        if ((result.skippedReasons?.length ?? 0) > 0) {
          process.stderr.write(`First ${result.skippedReasons!.length} skipped:\n`);
          for (const s of result.skippedReasons!) {
            process.stderr.write(`  - test #${s.index}: ${s.reason}\n`);
          }
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
