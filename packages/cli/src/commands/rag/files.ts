import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerRagFilesCommand(parent: Command): void {
  parent
    .command("files")
    .alias("ls")
    .description("List indexed files")
    .option("--page <number>", "Page number", "1")
    .option("--limit <number>", "Results per page", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching files...", () =>
          httpClient.get<Array<Record<string, unknown>>>(
            `${routeBase}/rag/files`,
            {
              page: parseInt(opts.page, 10),
              limit: parseInt(opts.limit, 10),
            }
          )
        );

        const files = Array.isArray(data) ? data : (data as any).files || [];
        output(files, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "originalFilename", header: "Filename" },
              { key: "status", header: "Status" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
