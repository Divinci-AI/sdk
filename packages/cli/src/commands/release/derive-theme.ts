import { Command } from "commander";
import { requireConfig, ensureValidToken, requireWorkspaceId } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerReleaseDeriveThemeCommand(parent: Command): void {
  parent
    .command("derive-theme <releaseId>")
    .description("Derive a WCAG-legible chat theme from your storefront into a DRAFT release")
    .option("--from <url>", "Storefront URL to extract from (default: catalog's first landing page → first product page)")
    .action(async (releaseId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/release/${releaseId}/derive-theme`;
        const body = opts.from ? { from: opts.from as string } : {};

        const data = await withSpinner("Rendering storefront + deriving theme...", async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text); }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
