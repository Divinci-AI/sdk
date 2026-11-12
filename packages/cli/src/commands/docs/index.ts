import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { output, isJsonMode } from "../../output/formatter.js";
import { handleCommandError } from "../../utils/errors.js";
import { registerDocsSnippetCommand, embedSnippet } from "./snippet.js";
import { registerDocsGenerateCommand } from "./generate.js";
import { registerDocsTemplateCommand } from "./template.js";
import {
  mapDocsChangesToUrls,
  DOCS_SYNC_INGEST_DISABLED_HINT,
} from "./changed-urls.js";

/**
 * `divinci docs` — the Divinci Docs pipeline entry point.
 *
 * Composes existing primitives rather than reinventing them:
 *   - `divinci release clone`  → provision a Release from a template
 *   - `divinci connectors web-crawl --swap` → seed/refresh a published
 *     Release's RAG vector (direct `rag crawl` is rejected by isVectorUsed
 *     on available/active releases — silent 200 + failedChunkSources)
 *   - `divinci docs snippet`   → the embed code for @divinci-ai/embed-chat-ui
 *
 * v1 ships `snippet` + `add` (Mode-A recipe) + `sync` (report-only change
 * list; real re-ingest goes through the connector swap path). See
 * .claude/goals/2026-06-15-divinci-docs-pipeline.md.
 */
export function registerDocsCommands(program: Command): void {
  const docs = program
    .command("docs")
    .description("Divinci Docs — add the Ask-Divinci assistant to your docs, or generate a docs site");

  registerDocsSnippetCommand(docs);
  registerDocsGenerateCommand(docs);
  registerDocsTemplateCommand(docs);

  // Mode A — add the assistant to an existing docs site.
  docs
    .command("add <docsUrl>")
    .description("Mode A: provision a Release, crawl your docs into it, and print the embed snippet")
    .option("--template <releaseId>", "Template Release to clone (defaults to the canonical Divinci Docs template)")
    .option("--name <name>", "Name for the new Release")
    .option("--api-url <url>", "Divinci API origin", "https://api.divinci.app")
    .option("--kind <kind>", "Embed snippet flavor: npm | script | astro", "npm")
    .action((docsUrl, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const apiUrl = globalOpts.apiUrl || opts.apiUrl;
        const template = opts.template || "6a2c9fb64b8b9753d15ffcac";
        const name = opts.name || "Docs Assistant";
        // Runnable recipe over the existing commands, ending in the exact embed
        // snippet. IMPORTANT (verified live 2026-06-15): `release create --from`
        // SHARES the template's RAG vector — crawling into it would pollute the
        // source. So the new Release MUST get a FRESH vector attached before the
        // crawl. (This is exactly what the in-process auto-exec must do.)
        const recipe = [
          `# Divinci Docs — Mode A (add the assistant to existing docs)`,
          `# 1. Fork the Docs template Release (copies the assistant config):`,
          `divinci release create --from ${template} --name ${JSON.stringify(name)}`,
          `#    → note the new <releaseId>.`,
          ``,
          `# 2. Attach a FRESH knowledge vector (the fork SHARES the template's`,
          `#    vector by default — crawling into that pollutes the source).`,
          `#    Create a new RAG vector in your workspace, then attach it:`,
          `divinci release update <releaseId> --rag-indexes <newVectorId>`,
          ``,
          `# 3. Crawl your docs into the FRESH vector:`,
          `divinci rag crawl ${JSON.stringify(docsUrl)} --vector <newVectorId> --multi --wait`,
          ``,
          `# 4. Allowlist your docs site's origin for the assistant's chat (CORS).`,
          `#    MUST be set while the release is a DRAFT (a published release is locked):`,
          `divinci release update <releaseId> --testing-domains "https://your-docs-site.example.com"`,
          `divinci release publish <releaseId>`,
          ``,
          `# 5. Embed the assistant (snippet below; or: divinci docs snippet <releaseId>):`,
          embedSnippet({ releaseId: "<releaseId>", apiUrl, kind: opts.kind }),
        ].join("\n");
        if (isJsonMode()) output({ mode: "add", docsUrl, template, apiUrl, recipe });
        else output(recipe);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // Phase 5 — report which docs changed (and map them to page URLs).
  //
  // Real re-ingest into a published Release vector is intentionally NOT done
  // here. Direct `rag crawl` hits isVectorUsed() on any vector attached to a
  // status=available/active release: the HTTP call returns 200 + a crawlId,
  // but every chunk write lands in failedChunkSources as
  // "Can't update vector when used." That silent no-op left the Divinci Docs
  // Assistant 18 days stale (2026-08-07 handoff). The supported path is the
  // web_crawl connector with --swap (draft + swapOnSuccess), which is what
  // the recurring autoSync schedule uses. This command only reports the
  // change set so CI can decide whether a connector resync is warranted.
  docs
    .command("sync")
    .description(
      "List docs that changed since a git ref (report-only). " +
      "Does NOT re-ingest — published Release vectors require " +
      "`divinci connectors web-crawl <url> --vector <id> --swap [--recurring]`",
    )
    .option("--since <ref>", "Git ref to diff against (default: previous commit)", "HEAD~1")
    .option("--paths <glob>", "Docs path prefix to watch", "src/content/docs")
    .option("--vector <id>", "(ignored for ingest) RAG vector id — kept for flag compatibility")
    .option("--base-url <url>", "Deployed docs site origin, to map changed files → page URLs")
    .option("--dry-run", "Alias for the default report-only behaviour", false)
    .action((opts) => {
      try {
        let changed: string[] = [];
        try {
          const out = execFileSync(
            "git",
            ["diff", "--name-only", `${opts.since}`, "HEAD", "--", opts.paths],
            { encoding: "utf8" },
          );
          changed = out.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch {
          changed = [];
        }
        const baseUrl = (opts.baseUrl || "").replace(/\/+$/, "");
        const urls = mapDocsChangesToUrls(changed, baseUrl);

        if (!changed.length) {
          output(isJsonMode() ? { since: opts.since, changedCount: 0, changed: [] } : `No docs changed since ${opts.since}.`);
          return;
        }

        // Always report-only. Refuse the old real-ingest path so CI never
        // gets a green "Re-ingested N pages" while the vector is unchanged.
        const result = {
          since: opts.since,
          paths: opts.paths,
          changedCount: changed.length,
          urls,
          vector: opts.vector || null,
          dryRun: true,
          ingest: "disabled" as const,
          hint: DOCS_SYNC_INGEST_DISABLED_HINT,
        };
        if (isJsonMode()) {
          output(result);
          return;
        }
        output([
          `${changed.length} changed doc(s) since ${opts.since} (report-only — no re-ingest):`,
          ...urls.map((u) => `  ${u}`),
          "",
          "To re-ingest a published Release's knowledge, use the web_crawl connector",
          "with swap (direct rag crawl into a live vector is a silent no-op):",
          "  divinci connectors web-crawl <site-or-sitemap-url> \\",
          "    --vector <vectorId> --swap [--feed] [--recurring]",
        ].join("\n"));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
