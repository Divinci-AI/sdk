import { Command } from "commander";
import { getProfile, setProfile, loadCredentials } from "../../config/credentials.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerWorkspaceUseCommand(parent: Command): void {
  parent
    .command("use <workspaceId>")
    .description("Set default workspace for future commands")
    .action(async (workspaceId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const profileName = globalOpts.profile ?? loadCredentials().defaultProfile;
        const profile = getProfile(profileName);

        if (!profile) {
          console.error(
            colors.red(`No profile "${profileName}" found. Run \`divinci auth login\` first.`)
          );
          process.exit(1);
        }

        setProfile(profileName, {
          ...profile,
          workspaceId,
        });

        console.log(
          colors.green(
            `Default workspace set to ${colors.cyan(workspaceId)} for profile "${profileName}".`
          )
        );
      } catch (error) {
        handleCommandError(error);
      }
    });
}
