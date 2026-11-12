import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { deleteProfile, getProfile } from "../../config/credentials.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerLogoutCommand(parent: Command): void {
  parent
    .command("logout")
    .description("Remove stored credentials")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts, cmd) => {
      try {
        // `--profile` is a GLOBAL option captured by optsWithGlobals, not the
        // subcommand's local opts (see login.ts). logout used to declare its own
        // local `--profile` too, so `logout --profile prod` would have removed the
        // "default" profile instead. Read the authoritative global value.
        const profileName: string = cmd.optsWithGlobals().profile ?? "default";
        const profile = getProfile(profileName);
        if (!profile) {
          console.log(colors.yellow(`No credentials found for profile "${profileName}".`));
          return;
        }

        if (!opts.yes) {
          const confirmed = await confirm({
            message: `Remove credentials for profile "${profileName}"?`,
            default: false,
          });
          if (!confirmed) {
            console.log(colors.dim("Cancelled."));
            return;
          }
        }

        // Best-effort revoke refresh token for OAuth profiles
        if (profile.authType === "oauth" && profile.refreshToken) {
          const { revokeRefreshToken, getAuth0Config } = await import("../../auth/oauth.js");
          const auth0Config = getAuth0Config(profile.apiUrl);
          await revokeRefreshToken({ auth0Config, refreshToken: profile.refreshToken });
        }

        deleteProfile(profileName);
        console.log(colors.green(`Credentials removed for profile "${profileName}".`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
