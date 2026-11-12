import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { writeFileSync } from "fs";

export function registerArenaPresetExportCommand(parent: Command): void {
  parent
    .command("export <presetId>")
    .description("Export an arena preset as JSON (pipe to file to save)")
    .option("--out <path>", "Write to file instead of stdout")
    .action(async (presetId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/arena/presets/${presetId}/export`;

        const data = await withSpinner("Exporting preset...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken!}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
          try { return JSON.parse(text) as any; } catch { throw new Error(`Non-JSON: ${text.substring(0, 200)}`); }
        });

        if (opts.out) {
          writeFileSync(opts.out, JSON.stringify(data, null, 2));
          // eslint-disable-next-line no-console
          console.log(`Exported to ${opts.out}`);
        } else {
          output(data);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
