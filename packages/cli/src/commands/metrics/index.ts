/**
 * `divinci metrics` command group
 *
 * Pipeline telemetry for AI releases: per-node latency/error/throughput
 * metrics, export, active alerts, and custom alert configurations with
 * in-app / email / webhook notification channels.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, outputSuccess } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { DivinciServer, AlertNotificationChannel } from "@divinci-ai/server";

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

export function registerMetricsCommands(parent: Command): void {
  parent
    .command("pipeline <pipelineId>")
    .description("Per-node metrics for a pipeline (latency p50/p95/p99, error rate, throughput)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--node-type <type>", "Narrow to one node type")
    .option("--time-range <range>", "1m | 5m | 1h | 24h | 7d | 30d", "1h")
    .action(async (pipelineId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching pipeline metrics…", () =>
          client.metrics.pipeline(workspaceId, pipelineId, {
            nodeType: opts.nodeType,
            timeRange: opts.timeRange,
          })
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("export <pipelineId>")
    .description("Export pipeline metrics (CSV by default, --format json for rows)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--time-range <range>", "1m | 5m | 1h | 24h | 7d | 30d", "1h")
    .option("--node-types <types>", "Comma-separated node-type filter")
    .option("--format <fmt>", "csv | json", "csv")
    .action(async (pipelineId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Exporting metrics…", () =>
          client.metrics.exportMetrics(workspaceId, pipelineId, {
            timeRange: opts.timeRange,
            nodeTypes: opts.nodeTypes ? String(opts.nodeTypes).split(",") : undefined,
            format: opts.format === "json" ? "json" : "csv",
          })
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });

  const alerts = parent
    .command("alerts")
    .description("Active alerts + custom alert configurations");

  alerts
    .command("list <pipelineId>")
    .alias("ls")
    .description("Active alerts for a pipeline")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (pipelineId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching alerts…", () =>
          client.metrics.alerts(workspaceId, pipelineId)
        );
        output(result.alerts, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "nodeType", header: "Node" },
              { key: "metric", header: "Metric" },
              { key: "severity", header: "Severity" },
              { key: "currentValue", header: "Value" },
              { key: "threshold", header: "Threshold" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  alerts
    .command("ack <pipelineId> <alertId>")
    .description("Acknowledge an active alert")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (pipelineId, alertId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Acknowledging alert…", () =>
          client.metrics.acknowledgeAlert(workspaceId, pipelineId, alertId)
        );
        outputSuccess(`Alert ${alertId} acknowledged.`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  alerts
    .command("configs <pipelineId>")
    .description("List stored alert configurations")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (pipelineId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching alert configs…", () =>
          client.metrics.getAlertConfigs(workspaceId, pipelineId)
        );
        output(result.configs);
      } catch (error) {
        handleCommandError(error);
      }
    });

  alerts
    .command("set <pipelineId>")
    .description("Create/update an alert config (custom thresholds → in-app/email/webhook)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--node-type <type>", "Pipeline node type (e.g. embedding, chunking)")
    .requiredOption("--metric <name>", "Metric name (e.g. errorRate, p95Duration)")
    .option("--warning <n>", "Warning threshold")
    .option("--critical <n>", "Critical threshold")
    .option("--webhook <url>", "Also notify this webhook URL")
    .option("--email <address>", "Also notify this email address")
    .action(async (pipelineId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        if (opts.warning === undefined && opts.critical === undefined) {
          throw new Error("At least one of --warning or --critical is required");
        }
        const notificationChannels: AlertNotificationChannel[] = [];
        if (opts.webhook) {
          notificationChannels.push({ type: "webhook", config: { url: opts.webhook } });
        }
        if (opts.email) {
          notificationChannels.push({ type: "email", config: { emailAddress: opts.email } });
        }
        const result = await withSpinner("Saving alert config…", () =>
          client.metrics.setAlertConfig(workspaceId, pipelineId, {
            nodeType: opts.nodeType,
            metric: opts.metric,
            thresholds: {
              warning: opts.warning !== undefined ? Number(opts.warning) : undefined,
              critical: opts.critical !== undefined ? Number(opts.critical) : undefined,
            },
            notificationChannels,
          })
        );
        output(result.config);
      } catch (error) {
        handleCommandError(error);
      }
    });

  alerts
    .command("unset <pipelineId>")
    .description("Delete an alert config (identified by --node-type + --metric)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--node-type <type>", "Pipeline node type")
    .requiredOption("--metric <name>", "Metric name")
    .action(async (pipelineId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Deleting alert config…", () =>
          client.metrics.deleteAlertConfig(workspaceId, pipelineId, {
            nodeType: opts.nodeType,
            metric: opts.metric,
          })
        );
        outputSuccess(`Alert config ${opts.nodeType}/${opts.metric} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("usage <orgName>")
    .description("Workspace API-key usage stats (transactions, cost, success rate)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--start <ms>", "Start date (epoch ms)")
    .option("--end <ms>", "End date (epoch ms)")
    .action(async (orgName, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching usage…", () =>
          client.usage.apiKeyUsage(workspaceId, orgName, {
            startDate: opts.start ? Number(opts.start) : undefined,
            endDate: opts.end ? Number(opts.end) : undefined,
          })
        );
        output(result.stats, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("billing-report")
    .description("Billing report comparing BYOK vs Divinci wallet usage")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching billing report…", () =>
          client.usage.billingReport(workspaceId)
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
