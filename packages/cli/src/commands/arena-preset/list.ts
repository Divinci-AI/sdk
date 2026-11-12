import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerArenaPresetListCommand(parent: Command): void {
  parent
    .command("list")
    .description("List arena presets for the current workspace")
    .option("--limit <n>", "Max presets to return", "50")
    .option("--archived", "Include archived presets")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const params = new URLSearchParams({ limit: opts.limit });
        if (opts.archived) params.set("archived", "true");
        const url = `${baseUrl}/white-label/${workspaceId}/arena/presets?${params}`;

        const data = await withSpinner("Fetching presets...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
          try { return JSON.parse(text) as any; } catch { throw new Error(`Non-JSON: ${text.substring(0, 200)}`); }
        });

        const presets: any[] = data.presets ?? data ?? [];

        if (isJsonMode()) {
          output(presets);
          return;
        }

        if (presets.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("No presets found."));
          return;
        }

        for (const p of presets) {
          // eslint-disable-next-line no-console
          console.log(
            `${colors.cyanBold(p._id)}  ${colors.bold(p.name ?? "(unnamed)")}` +
            (p.archived ? colors.dim("  [archived]") : "") +
            (p.tags?.length ? colors.dim(`  [${p.tags.join(", ")}]`) : "")
          );
          if (p.variants?.length) {
            for (const v of p.variants) {
              // eslint-disable-next-line no-console
              console.log(
                `  ${colors.dim("└")} ${v.name ?? "(unnamed)"}` +
                (v.assistantId || v.config?.assistantId
                  ? colors.dim(`  assistant=${v.assistantId ?? v.config?.assistantId}`)
                  : "") +
                (v.ragVectorGroupId ? colors.dim(`  group=${v.ragVectorGroupId}`) : "") +
                (v.ragVectorId ? colors.dim(`  rag=${v.ragVectorId}`) : "")
              );
            }
          }
        }
        // eslint-disable-next-line no-console
        console.log(colors.dim(`\n${presets.length} preset(s)`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
