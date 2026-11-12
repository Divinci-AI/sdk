import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustGet } from "./_client.js";

interface BoardRow {
  rank: number;
  displayName: string;
  providerId: string;
  modelId: string;
  score: number;
  runId: string;
  runCount: number;
  runsInWindow: number;
  scoreRange: { min: number; max: number };
}

interface Board {
  benchmark: {
    slug: string;
    name: string;
    version: string;
    metric: string;
    higherIsBetter: boolean;
  };
  rows: BoardRow[];
  excludedCount: number;
}

/**
 * `divinci trust leaderboard [slug]`
 *
 * The public boards were reachable only over raw HTTP until now: the CLI
 * could create, list and verify runs but could not read the thing those runs
 * feed. Reading a board is how you answer "did my run land, and where?", so
 * its absence pushed people to curl.
 *
 * ⚠️ Equal scores share a rank (competition ranking), so repeated ranks in
 * this table are correct and meaningful — they say the models are tied, not
 * that the board is broken. A gap after a tie (1,1,1,4) says how many models
 * are ahead. The `SPREAD` column is min–max across the scoring window, so a
 * wide spread means the model is inconsistent, which is itself a finding.
 */
export function registerTrustLeaderboardCommand(parent: Command): void {
  parent
    .command("leaderboard [slug]")
    .alias("board")
    .description(
      "Show a public TrustBench leaderboard (omit the slug to list every published board)"
    )
    .action(async (slug: string | undefined, _opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const path = slug
          ? `/v1/trustbench/public/leaderboard/${encodeURIComponent(slug)}`
          : "/v1/trustbench/public/leaderboard";

        const data = await withSpinner("Fetching leaderboard...", () =>
          trustGet<Board | { boards: Board[] }>(http, path)
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const boards: Board[] = "boards" in data ? data.boards : [data];
        if (boards.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("No published boards with qualifying runs."));
          return;
        }

        for (const board of boards) {
          const b = board.benchmark;
          // eslint-disable-next-line no-console
          console.log(
            `\n${colors.bold(b.name)} ${colors.dim(`(${b.slug} v${b.version})`)}\n` +
              colors.dim(
                `${b.metric} — ${b.higherIsBetter ? "higher" : "LOWER"} is better`
              )
          );
          output(board.rows, {
            table: {
              columns: [
                { key: "rank", header: "#" },
                { key: "displayName", header: "MODEL" },
                { key: "providerId", header: "PROVIDER" },
                { key: "score", header: "SCORE", format: (v) => (typeof v === "number" ? v.toFixed(4) : "—") },
                {
                  key: "scoreRange",
                  header: "SPREAD",
                  format: (v) => {
                    const r = v as BoardRow["scoreRange"] | undefined;
                    return r ? `${r.min.toFixed(3)}–${r.max.toFixed(3)}` : "—";
                  },
                },
                { key: "runsInWindow", header: "RUNS" },
                { key: "runId", header: "VERIFY (run id)" },
              ],
            },
          });
          if (board.excludedCount > 0) {
            // eslint-disable-next-line no-console
            console.log(
              colors.dim(
                `${board.excludedCount} run(s) excluded (wrong version, unsigned, or not attributed)`
              )
            );
          }
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
