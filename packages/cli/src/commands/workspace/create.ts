import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { assertHipaaFlagsCoherent, resolveHipaaAssent } from "./hipaa-flow.js";

export function registerWorkspaceCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a new workspace")
    .requiredOption("--title <title>", "Workspace title")
    .requiredOption("--description <description>", "Workspace description")
    .option(
      "--host <host>",
      "The website this workspace is for (e.g. example.com). Makes this find-or-create: " +
        "an existing workspace for that site is returned instead of a duplicate being made.",
    )
    .option(
      "--hipaa",
      "Create the workspace HIPAA-scoped. This accepts the Business Associate Agreement " +
        "(review it with `divinci workspace baa`); starting scoped is far easier than " +
        "converting a workspace that is already in use",
    )
    .option("--baa-signer-title <title>", "Your title, recorded as the signer (with --hipaa)")
    .option("--baa-org-legal-name <name>", "Legal name of your organization (with --hipaa)")
    .option(
      "--baa-version-hash <hash>",
      "Hash of the agreement text you reviewed, from `divinci workspace baa` (with --hipaa)",
    )
    .action(async (opts, cmd) => {
      try {
        // Before anything else: a bad combination must not reach the network.
        assertHipaaFlagsCoherent(opts);

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        // Assent is gathered BEFORE create is called, so a refusal (agreement
        // unavailable, stale hash, declined prompt) creates nothing.
        const hipaa = opts.hipaa
          ? await resolveHipaaAssent(
              await withSpinner("Fetching agreement...", () => client.workspaces.getBaaAgreement()),
              opts,
            )
          : undefined;

        const data = await withSpinner(
          opts.host ? "Resolving workspace..." : "Creating workspace...",
          () =>
            client.workspaces.create({
              name: opts.title,
              description: opts.description,
              ...(opts.host ? { onboardingHost: opts.host } : {}),
              ...(hipaa ? { hipaa } : {}),
            })
        );

        // Say so when nothing was created. A caller that passed --host and got
        // a workspace back has no other way to tell reuse from creation, and
        // silently reusing someone else's workspace is worth a line of output.
        if (opts.host && data.created === false) {
          console.warn(
            `Reused the existing workspace for ${opts.host} — nothing was created.`,
          );
        }

        output(data, { keyValue: true });

        // A scoped workspace that silently refuses chat reads as a bug.
        if (data.hipaa?.chatBlockedUntilVendorBaa) {
          console.warn(
            "This workspace is HIPAA-scoped. Chat is paused until Divinci completes a Business " +
              "Associate Agreement with a model provider.",
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
