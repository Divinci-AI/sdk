import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

interface FineTunerToolRow {
  id: string;
  title: string;
  org: string;
  status: string;
}

export function registerFineTuneModelsCommand(parent: Command): void {
  parent
    .command("models")
    .description("List fine-tuner base models available on the platform (the id is what `create --base-model` accepts)")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const data = await withSpinner("Fetching available fine-tuner models...", () =>
          client.fineTune.listModels()
        );

        const rows: FineTunerToolRow[] = Object.values(
          data as Record<string, { id: string, status?: string, info?: { title?: string, org?: string } }>,
        ).map((tool) => ({
          id: tool.id,
          title: tool.info?.title ?? tool.id,
          org: tool.info?.org ?? "",
          status: tool.status ?? "",
        }));

        output(rows, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "org", header: "Organization" },
              { key: "status", header: "Status" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
