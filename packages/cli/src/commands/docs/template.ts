import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { requireConfig, ensureValidToken, requireWorkspaceId } from "../../config/config-manager.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export const DOCS_TEMPLATE_SCHEMA = "divinci-docs-template/v1";

/**
 * Instance-specific fields stripped when exporting a Release as a reusable
 * template — identity, ownership, timestamps, and the bound RAG vector (a
 * freshly-cloned Release gets its own vector, re-seeded by `docs add`/crawl).
 * Everything else (assistant/model config, moderation, on-topic, thread
 * prefixes, gate config, languages, fallback chain, MCP config) is the template.
 */
export const TEMPLATE_OMIT_KEYS = new Set([
  // identity / ownership / timestamps
  "_id", "id", "__v", "workspace", "workspaceId", "whitelabel", "whitelabelId",
  "owner", "ownerId", "createdAt", "updatedAt", "publishedAt", "lastDeployedAt",
  "releaseDate", "version", "signiture", "signature",
  // instance-bound knowledge / target / site (a clone re-seeds its own)
  "ragVector", "ragVectorId", "vectorId", "ragVectorGroupId", "ragIndexes",
  "target", "siteManifest", "transcript", "messages", "stats", "usage",
  // instance slugs / snapshot lineage / per-deploy domains
  "slug", "whitelabelSlug", "whitelabelSlugVersion", "previousSnapshotId",
  "testingDomains",
]);

export interface DocsTemplate {
  schemaVersion: string;
  exportedFrom: string;
  exportedAtNote: string;
  config: Record<string, unknown>;
}

/**
 * Serialize a fetched Release into a portable, version-controllable template:
 * the config minus instance-specific identity/content. Pure → unit-testable.
 */
export function toDocsTemplate(release: Record<string, unknown>, releaseId: string): DocsTemplate {
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(release)) {
    if (TEMPLATE_OMIT_KEYS.has(k)) continue;
    config[k] = v;
  }
  return {
    schemaVersion: DOCS_TEMPLATE_SCHEMA,
    exportedFrom: releaseId,
    exportedAtNote: "Stamp the export time at write-time; omitted here for determinism.",
    config,
  };
}

export function registerDocsTemplateCommand(parent: Command): void {
  const template = parent
    .command("template")
    .description("Export/inspect a Release as a reusable Divinci Docs template (import = `release clone`)");

  template
    .command("export <releaseId>")
    .description("Export a Release's config to a portable template JSON (strips ids/vector/content)")
    .option("--out <file>", "Write the template JSON to a file instead of stdout")
    .action(async (releaseId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/release/${releaseId}`;

        const release = await withSpinner("Fetching release...", async () => {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${config.accessToken}` } });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
          try { return JSON.parse(text) as Record<string, unknown>; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        const tpl = toDocsTemplate(release, releaseId);
        const json = JSON.stringify(tpl, null, 2);
        if (opts.out) {
          writeFileSync(opts.out, json + "\n");
          if (!isJsonMode()) output(`Wrote template (${Object.keys(tpl.config).length} config keys) → ${opts.out}`);
          else output({ out: opts.out, schemaVersion: tpl.schemaVersion, configKeys: Object.keys(tpl.config).length });
        } else {
          output(json);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
