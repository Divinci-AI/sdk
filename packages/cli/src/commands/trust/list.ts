import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustGet } from "./_client.js";

interface RunRow {
  runId: string;
  status: string;
  score?: number;
  benchmarkId?: string;
  benchmarkVersion?: string;
  modelAssistantId?: string;
  visibility?: string;
  createdAt?: string;
}

export function registerTrustListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List your TrustBench runs")
    .option("--mine", "Only show runs you triggered", false)
    .option("--benchmark <id-or-slug>", "Filter by benchmark")
    .option("--model <assistant-id>", "Filter by model assistant")
    .option(
      "--status <status>",
      "Filter by status: queued | running | complete | failed | canceled"
    )
    .option("--limit <number>", "Max results", "20")
    .option("--since <iso8601>", "Earliest createdAt to include")
    .action(async (opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());

        // The list endpoint is already scoped to the caller's own/triggered
        // runs, so --mine is the default behavior (no server param for it).
        const params = new URLSearchParams();
        if (opts.benchmark) params.set("benchmarkId", opts.benchmark);
        if (opts.model) params.set("modelAssistantId", opts.model);
        if (opts.status) params.set("status", opts.status);
        if (opts.since) params.set("since", opts.since);
        if (opts.limit) params.set("limit", opts.limit);
        const qs = params.toString();

        const data = await withSpinner("Fetching runs...", () =>
          trustGet<{ runs: RunRow[]; count: number }>(
            http,
            `/v1/trustbench/runs${qs ? `?${qs}` : ""}`
          )
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const runs = data.runs ?? [];
        if (runs.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("No runs found."));
          return;
        }

        output(runs, {
          table: {
            columns: [
              { key: "runId", header: "RUN" },
              { key: "status", header: "STATUS" },
              { key: "score", header: "SCORE", format: (v) => (typeof v === "number" ? String(v) : "—") },
              { key: "benchmarkId", header: "BENCHMARK" },
              { key: "modelAssistantId", header: "MODEL" },
              { key: "visibility", header: "VIS" },
              { key: "createdAt", header: "CREATED", format: (v) => (typeof v === "string" ? v.replace("T", " ").replace(/\.\d+Z$/, "Z") : "") },
            ],
          },
        });
        // eslint-disable-next-line no-console
        console.log(colors.dim(`\n${data.count ?? runs.length} run(s)`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
