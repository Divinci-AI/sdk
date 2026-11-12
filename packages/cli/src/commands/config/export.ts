import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci config export` — export the whitelabel configuration, optionally with
 * the full release snapshots (assistant, RAG vectors/group, routing, moderation,
 * TTS, pricing, …), as a portable YAML document or JSON object.
 *
 * Defaults to YAML + releases + resources so the common case ("export the
 * release in its entirety") is a single flagless command.
 */
export function registerConfigExportCommand(parent: Command): void {
  parent
    .command("export")
    .description("Export the whitelabel configuration (with releases) as YAML or JSON")
    .option("--format <format>", "Output format: yaml | json", "yaml")
    .option("--no-releases", "Exclude full release snapshots")
    .option("--no-resources", "Exclude sub-resources (prefixes, moderators, agents, …)")
    .option("--out <file>", "Write the export to a file instead of stdout")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const format = String(opts.format).toLowerCase() === "json" ? "json" : "yaml";
        // commander sets opts.releases/opts.resources to false when --no-* is passed,
        // true (the implicit default) otherwise.
        const params: Record<string, string> = {
          includeReleases: opts.releases === false ? "false" : "true",
          includeResources: opts.resources === false ? "false" : "true",
          format,
        };

        const path = `/white-label/${workspaceId}/export`;

        const content = await withSpinner(`Exporting workspace config (${format})...`, async () => {
          if (format === "yaml") {
            return httpClient.getText(path, params);
          }
          const json = await httpClient.request<unknown>(path, {
            method: "GET",
            params,
            skipValidation: true,
          });
          return JSON.stringify(json, null, 2);
        });

        if (opts.out) {
          await writeFile(opts.out, content, "utf8");
          process.stdout.write(`Exported to ${opts.out}\n`);
        } else {
          process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
