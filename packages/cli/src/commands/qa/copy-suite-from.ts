import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerQACopySuiteFromCommand(parent: Command): void {
  parent
    .command("copy-suite-from <sourceWhitelabelId> <sourceSuiteId>")
    .description("Copy a QA suite + tests from a source whitelabel into the caller's workspace")
    .option("-n, --new-name <name>", "Override the name of the new suite")
    .option(
      "--fileid-map <json>",
      "JSON map of sourceFineTuneFileId → targetFineTuneFileId (remaps test provenance). Typically the fileIdMap from `divinci fine-tune copy-from --json`.",
    )
    .action(async (sourceWhitelabelId: string, sourceSuiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        let fineTuneFileIdMap: Record<string, string> | undefined;
        if (opts.fileidMap) {
          try {
            const parsed = JSON.parse(opts.fileidMap);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              fineTuneFileIdMap = parsed;
            } else {
              throw new Error("must be a JSON object");
            }
          } catch (e) {
            throw new Error(`Invalid --fileid-map JSON: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        const data = await withSpinner(
          `Copying QA suite ${sourceSuiteId} from ${sourceWhitelabelId}...`,
          () =>
            client.qa.copySuiteFrom(workspaceId, {
              sourceWhitelabelId,
              sourceSuiteId,
              newSuiteName: opts.newName,
              fineTuneFileIdMap,
            }),
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
