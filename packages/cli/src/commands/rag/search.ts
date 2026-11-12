import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface SearchResult {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  source?: string;
}

export function registerRagSearchCommand(parent: Command): void {
  parent
    .command("search <query>")
    .description("Search your knowledge base")
    .option("--limit <number>", "Maximum results", "5")
    .action(async (query, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Searching knowledge base...", () =>
          httpClient.get<{ results: SearchResult[] }>(
            `${routeBase}/rag/search`,
            {
              q: query,
              limit: parseInt(opts.limit, 10),
            }
          )
        );

        if (isJsonMode()) {
          output(data.results);
          return;
        }

        if (data.results.length === 0) {
          console.log(colors.dim("No results found."));
          return;
        }

        for (let i = 0; i < data.results.length; i++) {
          const result = data.results[i];
          const scoreColor = result.score >= 0.9 ? colors.green : result.score >= 0.7 ? colors.yellow : colors.red;
          console.log(
            `${colors.cyanBold(`[${i + 1}]`)} ${scoreColor(`Score: ${result.score.toFixed(3)}`)}` +
            (result.source ? colors.dim(` (${result.source})`) : "")
          );
          console.log(result.content.substring(0, 300) + (result.content.length > 300 ? "..." : ""));
          console.log("");
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
