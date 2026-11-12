import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { resolveTrustHttp, trustGet, trustPatch } from "./_client.js";
import { stripControlChars } from "../../output/safe-text.js";

interface BenchmarkRow {
  bmId: string;
  slug: string;
  name: string;
  description?: string;
  version: string;
  authorId?: string;
  ownerType?: string;
  scoringRubric?: {
    metric: string;
    range?: { min: number; max: number };
    higherIsBetter?: boolean;
  };
  expectedDurationSec?: number;
  costEstimateCents?: number;
  pricePerRunCents?: number;
  attestationGrade?: string;
  status?: string;
  publishedAt?: string;
  /** Only on a workspace's own list (--workspace): that workspace's runs on it. */
  stats?: { runs: number; releasesCovered: number; latestRunAt: string | null };
}

export function registerTrustBenchmarksCommand(parent: Command): void {
  const benchmarks = parent
    .command("benchmarks")
    .description("Browse the TrustBench benchmark catalog");

  benchmarks
    .command("list")
    .alias("ls")
    .description("List available benchmarks")
    .option(
      "--status <status>",
      "Filter by status: published | all",
      "published"
    )
    .option(
      "--owner <kind>",
      "platform (Divinci's catalog) | whitelabel (a workspace's own, with --workspace; without it, publicly listed workspace boards) | user (your own)",
      "platform"
    )
    .option(
      "--workspace <whitelabelId>",
      "With --owner whitelabel: list this workspace's benchmarks (you must be able to see its private runs)"
    )
    .option("--search <query>", "Free-text search")
    .action(async (opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());

        const params = new URLSearchParams();
        if (opts.status) params.set("status", opts.status);
        if (opts.workspace && opts.owner !== "whitelabel") {
          throw new Error("--workspace needs --owner whitelabel");
        }
        if (opts.owner) params.set("owner", opts.owner);
        if (opts.workspace) params.set("whitelabelId", opts.workspace);
        if (opts.search) params.set("search", opts.search);
        const qs = params.toString();

        const data = await withSpinner("Fetching benchmarks...", () =>
          trustGet<{ benchmarks: BenchmarkRow[]; count: number }>(
            http,
            `/v1/trustbench/benchmarks${qs ? `?${qs}` : ""}`
          )
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const list = data.benchmarks ?? [];
        if (list.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("No benchmarks found."));
          return;
        }

        if (opts.workspace) {
          output(list.map((b) => ({
            slug: b.slug, version: b.version, name: b.name, status: b.status,
            runs: b.stats?.runs ?? 0, releases: b.stats?.releasesCovered ?? 0,
            latest: b.stats?.latestRunAt ? b.stats.latestRunAt.slice(0, 10) : "—",
          })), {
            table: {
              columns: [
                { key: "slug", header: "SLUG" },
                { key: "version", header: "VER" },
                { key: "name", header: "NAME" },
                { key: "status", header: "STATUS" },
                { key: "runs", header: "RUNS" },
                { key: "releases", header: "RELEASES" },
                { key: "latest", header: "LATEST RUN" },
              ],
            },
          });
          // eslint-disable-next-line no-console
          console.log(colors.dim(`\n${data.count ?? list.length} benchmark(s) in this workspace, every version`));
          return;
        }

        output(list, {
          table: {
            columns: [
              { key: "slug", header: "SLUG" },
              { key: "version", header: "VER" },
              { key: "name", header: "NAME" },
              { key: "ownerType", header: "OWNER" },
              { key: "attestationGrade", header: "GRADE" },
              { key: "status", header: "STATUS" },
              {
                key: "pricePerRunCents",
                header: "PRICE",
                format: (v) =>
                  typeof v === "number" ? (v === 0 ? "free" : `${(v / 100).toFixed(2)}`) : "—",
              },
            ],
          },
        });
        // eslint-disable-next-line no-console
        console.log(colors.dim(`\n${data.count ?? list.length} benchmark(s)`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  benchmarks
    .command("board <id-or-slug>")
    .description("A workspace's PRIVATE board for a benchmark: its signed runs, one row per release (members only)")
    .requiredOption("--workspace <whitelabelId>", "The workspace whose private board to read")
    .action(async (idOrSlug: string, opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const data = await withSpinner("Fetching board...", () =>
          trustGet<{
            benchmark: { name: string; version: string; metric: string };
            rows: Array<{ rank: number; releaseTitle?: string | null; releaseId?: string; modelId: string; retrievalStackLabel?: string; judgeModelId?: string; score: number; runsInWindow: number; runCount: number }>;
            excluded: Array<{ runId: string; reason: string }>;
          }>(
            http,
            `/v1/trustbench/benchmarks/${encodeURIComponent(idOrSlug)}/board?whitelabelId=${encodeURIComponent(opts.workspace)}`,
          )
        );
        if (isJsonMode()) {
          output(data);
          return;
        }
        output(data.rows.map((r) => ({
          rank: r.rank,
          release: r.releaseTitle || r.releaseId || r.modelId,
          retrieval: r.retrievalStackLabel ?? "none",
          judge: r.judgeModelId ?? "code-graded",
          score: (r.score * 100).toFixed(1) + "%",
          runs: `${r.runsInWindow}/${r.runCount}`,
        })), {
          table: {
            columns: [
              { key: "rank", header: "#" },
              { key: "release", header: "RELEASE" },
              { key: "retrieval", header: "RETRIEVAL" },
              { key: "judge", header: "JUDGE" },
              { key: "score", header: data.benchmark.metric.toUpperCase() },
              { key: "runs", header: "RUNS" },
            ],
          },
        });
        // eslint-disable-next-line no-console
        console.log(colors.dim(`\nPrivate board: ${data.benchmark.name} v${data.benchmark.version}; ${data.excluded.length} run(s) left off (--json for reasons)`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  benchmarks
    .command("update <bmId>")
    .description("Edit the name and/or description of a benchmark you can edit (scoring and identity are frozen)")
    .option("--name <name>", "New display name (1-120 characters)")
    .option("--description <text>", "New description (up to 600 characters). Served publicly once any run on it is public")
    .action(async (bmId: string, opts, cmd) => {
      try {
        // An edit needs one exact version; a slug matches every version.
        if (!/^bm_[0-9A-HJKMNP-TV-Z]{26}$/.test(bmId)) {
          throw new Error("Address the benchmark by bmId (bm_<ulid>); a slug can match several versions.");
        }
        const body: { name?: string; description?: string } = {};
        if (typeof opts.name === "string") body.name = opts.name;
        if (typeof opts.description === "string") body.description = opts.description;
        if (body.name === undefined && body.description === undefined) {
          throw new Error("Pass --name and/or --description.");
        }
        const http = await resolveTrustHttp(cmd.optsWithGlobals());
        const data = await withSpinner("Updating benchmark...", () =>
          trustPatch<{ benchmark: BenchmarkRow }>(
            http,
            `/v1/trustbench/benchmarks/${encodeURIComponent(bmId)}`,
            body,
          )
        );
        if (isJsonMode()) {
          output(data);
          return;
        }
        output(
          {
            bmId: data.benchmark.bmId,
            slug: data.benchmark.slug,
            version: data.benchmark.version,
            name: stripControlChars(data.benchmark.name),
          },
          { keyValue: true }
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  benchmarks
    .command("show <id-or-slug>")
    .description("Show benchmark detail")
    .action(async (idOrSlug: string, _opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());

        const data = await withSpinner("Fetching benchmark...", () =>
          trustGet<{ benchmark: BenchmarkRow }>(
            http,
            `/v1/trustbench/benchmarks/${encodeURIComponent(idOrSlug)}`
          )
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const b = data.benchmark;
        const rubric = b.scoringRubric;
        const price =
          typeof b.pricePerRunCents === "number"
            ? b.pricePerRunCents === 0
              ? "free"
              : `${(b.pricePerRunCents / 100).toFixed(2)}`
            : "—";
        output(
          {
            slug: b.slug,
            name: b.name,
            version: b.version,
            status: b.status ?? "",
            bmId: b.bmId,
            authorId: b.authorId ?? "",
            ownerType: b.ownerType ?? "",
            attestationGrade: b.attestationGrade ?? "",
            scoring: rubric
              ? `${rubric.metric} [${rubric.range?.min}..${rubric.range?.max}] ${rubric.higherIsBetter ? "↑ higher-better" : "↓ lower-better"}`
              : "",
            expectedDurationSec: b.expectedDurationSec ?? "",
            pricePerRun: price,
            publishedAt: b.publishedAt ?? "",
          },
          { keyValue: true }
        );
        if (b.description) {
          // eslint-disable-next-line no-console
          console.log(`\n${colors.dim(stripControlChars(b.description))}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
