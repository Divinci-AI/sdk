import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerReleaseDeleteCommand(parent: Command): void {
  parent
    .command("delete <releaseId>")
    .alias("rm")
    .description("Delete a release")
    .action(async (releaseId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        // Use the OAuth admin endpoint (DELETE /white-label/:ws/release/:id ->
        // deleteDraft), the same surface as `release list`/`create`. NOT
        // client.releases.delete() — that targets the api-key-only
        // /api/v1/releases/:id route (requireAPIKey), which 401s under OAuth.
        const httpClient = client.getHttpClient();
        await withSpinner("Deleting release...", () =>
          httpClient.delete(`/white-label/${workspaceId}/release/${releaseId}`)
        );

        console.error(colors.green(`Release ${releaseId} deleted successfully.`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
