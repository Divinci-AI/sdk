import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerFineTuneCopyFromCommand(parent: Command): void {
  parent
    .command("copy-from <sourceWhitelabelId>")
    .description("Copy FineTuneFiles from a source whitelabel into the caller's workspace")
    .option("-f, --file <id...>", "Specific source file IDs to copy (omit to copy all)")
    .option("--copy-cached-ids", "Also copy cachedIds (provider model refs). Off by default.")
    .action(async (sourceWhitelabelId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const sourceFileIds: string[] | undefined = Array.isArray(opts.file)
          ? opts.file
          : opts.file
            ? [opts.file]
            : undefined;

        const data = await withSpinner(
          `Copying fine-tune files from ${sourceWhitelabelId}...`,
          () =>
            client.fineTune.copyFilesFrom({
              sourceWhitelabelId,
              sourceFileIds,
              copyCachedIds: !!opts.copyCachedIds,
            }),
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
