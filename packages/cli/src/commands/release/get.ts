import { Command } from "commander";
import { requireConfig, ensureValidToken, requireWorkspaceId } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerReleaseGetCommand(parent: Command): void {
  parent
    .command("get <releaseId>")
    .description("Get release details")
    .action(async (releaseId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        // Workspace-scoped route (same auth path as `release list`) — works
        // with both OAuth user tokens and API keys. The SDK's
        // client.releases.get() hits the v1 consumer API, which rejects OAuth
        // tokens (dogfood F8).
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/release/${releaseId}`;

        const release = await withSpinner("Fetching release...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text); }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        output(release, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
