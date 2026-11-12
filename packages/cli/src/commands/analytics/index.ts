/**
 * `divinci analytics` command group
 *
 * Product analytics for AI releases: aggregated metrics, trends, per-product
 * performance, A/B experiment results, and conversion funnel.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { DivinciServer } from "@divinci-ai/server";

async function buildContext(
  opts: { workspace?: string },
  cmd: Command
): Promise<{ client: DivinciServer; workspaceId: string }> {
  const globalOpts = cmd.optsWithGlobals();
  let config = requireConfig(globalOpts);
  requireOAuthAuth(config);
  config = await ensureValidToken(config);
  const client = createClient(config);
  const workspaceId = opts.workspace || config.workspaceId;
  if (!workspaceId) throw new Error("--workspace required (no active workspace set)");
  return { client, workspaceId };
}

export function registerAnalyticsCommands(parent: Command): void {
  parent
    .command("metrics")
    .description("Aggregated product metrics with previous-period comparison")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--time-range <range>", "1d | 7d | 30d | 90d", "7d")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching metrics…", () =>
          client.analytics.metrics(workspaceId, { timeRange: opts.timeRange })
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("trends")
    .description("Time-series trend data for charts")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--time-range <range>", "1d | 7d | 30d | 90d", "7d")
    .option("--granularity <g>", "hourly | daily", "daily")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching trends…", () =>
          client.analytics.trends(workspaceId, {
            timeRange: opts.timeRange,
            granularity: opts.granularity,
          })
        );
        output(result.trends);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("performance")
    .description("Per-product performance (impressions, clicks, CTR, conversions)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--time-range <range>", "1d | 7d | 30d | 90d", "7d")
    .option("--limit <n>", "Max products", "25")
    .option("--sort-by <field>", "impressions | clicks | ctr | conversions | conversionRate")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching product performance…", () =>
          client.analytics.performance(workspaceId, {
            timeRange: opts.timeRange,
            limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
            sortBy: opts.sortBy,
          })
        );
        output(result.products);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("experiments")
    .description("A/B experiment results (lift, p-value, winner)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--experiment <id>", "Filter to one experiment")
    .option("--status <status>", "running | completed", "running")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching experiments…", () =>
          client.analytics.experiments(workspaceId, {
            experimentId: opts.experiment,
            status: opts.status,
          })
        );
        output(result.experiments);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("funnel")
    .description("Conversion funnel (impressions → clicks → sessions → conversions)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--time-range <range>", "1d | 7d | 30d | 90d", "7d")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching funnel…", () =>
          client.analytics.funnel(workspaceId, { timeRange: opts.timeRange })
        );
        output(result.funnel);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
