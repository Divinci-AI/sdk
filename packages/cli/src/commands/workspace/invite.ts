import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

// Uses client.workspaces.inviteUser (POST /white-label/:id/permission/invite-user),
// the same OAuth-session route the web app's Settings > Permissions page calls —
// distinct from `divinci permissions grant`, which talks to the API-key-only
// /api/v1/permissions surface and 401s for Bearer-authed CLI sessions.

export function registerWorkspaceInviteCommand(parent: Command): void {
  parent
    .command("invite <email>")
    .description("Invite a user to the active workspace with the given permissions")
    .requiredOption(
      "--permissions <permissions>",
      "Comma-separated permission list (e.g. editConfig,delete,fineTune)",
    )
    .option("--workspace <id>", "Workspace ID (defaults to the active workspace)")
    .action(async (email, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = opts.workspace ?? requireWorkspaceId(config);
        const client = createClient(config);

        const permissions = opts.permissions
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean);

        await withSpinner(`Inviting ${email} to workspace ${workspaceId}...`, () =>
          client.workspaces.inviteUser(workspaceId, { email, permissions }),
        );
        console.error(`Invited ${email} to workspace ${workspaceId} with permissions: ${permissions.join(", ")}`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
