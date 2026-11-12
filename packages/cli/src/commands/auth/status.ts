import { Command } from "commander";
import { resolveConfig } from "../../config/config-manager.js";
import { getCredentialsPath, getProfile } from "../../config/credentials.js";
import { colors } from "../../output/colors.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerStatusCommand(parent: Command): void {
  const statusCmd = parent
    .command("status")
    .description("Show current authentication status")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = resolveConfig(globalOpts);

        if (isJsonMode()) {
          const profile = config ? getProfile(config.profile) : undefined;
          output({
            authenticated: !!config,
            authType: config?.authType ?? null,
            profile: config?.profile ?? null,
            source: config?.source ?? null,
            apiUrl: config?.apiUrl ?? null,
            workspaceId: config?.workspaceId ?? null,
            email: profile?.email ?? null,
            expiresAt: config?.expiresAt ?? null,
            credentialsFile: getCredentialsPath(),
          });
          return;
        }

        if (!config) {
          console.log(colors.yellow("Not authenticated."));
          console.log(colors.dim("Run `divinci auth login` to authenticate."));
          return;
        }

        console.log(colors.greenBold("Authenticated"));
        console.log(`  Profile:    ${colors.cyan(config.profile)}`);
        console.log(`  Auth type:  ${colors.cyan(config.authType)}`);
        console.log(`  Source:     ${colors.dim(config.source)}`);
        console.log(`  API URL:    ${config.apiUrl}`);
        console.log(
          `  Workspace:  ${config.workspaceId ? colors.cyan(config.workspaceId) : colors.dim("not set")}`
        );

        if (config.authType === "oauth") {
          const profile = getProfile(config.profile);
          if (profile?.email) {
            console.log(`  Email:      ${colors.cyan(profile.email)}`);
          }
          if (config.expiresAt) {
            const expiresAt = new Date(config.expiresAt);
            const now = new Date();
            const isExpired = expiresAt <= now;
            const timeStr = expiresAt.toLocaleString();
            console.log(
              `  Expires:    ${isExpired ? colors.red(`${timeStr} (expired)`) : colors.dim(timeStr)}`
            );
          }
        } else if (config.apiKey) {
          console.log(`  Key:        ${colors.dim(maskApiKey(config.apiKey))}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // whoami alias
  parent
    .command("whoami")
    .description("Alias for `auth status`")
    .action(async () => {
      await statusCmd.parseAsync([], { from: "user" });
    });
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}
