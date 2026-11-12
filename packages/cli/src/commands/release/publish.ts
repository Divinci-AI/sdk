import { Command } from "commander";
import { requireConfig, ensureValidToken, requireWorkspaceId } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerReleasePublishCommand(parent: Command): void {
  parent
    .command("publish <releaseId>")
    .description("Publish (activate) a release draft")
    .action(async (releaseId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        // Workspace-scoped publish route (releaseReleaseDraft) — works with
        // OAuth user tokens and API keys. The SDK's activate() hits the v1
        // consumer API, which rejects OAuth tokens (dogfood F15). Note the
        // server exposes publish as a GET.
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/release/${releaseId}/release`;

        const data = await withSpinner("Publishing release...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
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
