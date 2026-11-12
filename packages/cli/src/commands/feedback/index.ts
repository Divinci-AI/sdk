/**
 * `divinci feedback` command group
 *
 * Admin-tier READ of the message feedback a whitelabel's releases received
 * (consumers submit it from the chat UI / consumer SDK). List, inspect, and
 * aggregate stats.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { DivinciServer } from "@divinci-ai/server";
import type { ListFeedbackOptions, FeedbackStatsOptions } from "@divinci-ai/server";

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

/** Parse a sentiment flag, erroring on an unknown bucket. */
function parseSentiment(raw?: string): ListFeedbackOptions["sentiment"] {
  if (!raw) return undefined;
  if (raw === "positive" || raw === "negative" || raw === "neutral") return raw;
  throw new Error(`--sentiment must be one of: positive | negative | neutral (got "${raw}")`);
}

function parseSource(raw?: string): "authed" | "anonymous" | undefined {
  if (!raw) return undefined;
  if (raw === "authed" || raw === "anonymous") return raw;
  throw new Error(`--source must be one of: authed | anonymous (got "${raw}")`);
}

export function registerFeedbackCommands(parent: Command): void {
  parent
    .command("list")
    .description("List message feedback (paginated, filtered)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--release <id>", "Filter to one release")
    .option("--sentiment <s>", "positive | negative | neutral")
    .option("--source <s>", "authed | anonymous")
    .option("--has-text", "Only feedback that carries written detail")
    .option("--created-after <ms>", "Lower bound on createdAt (epoch ms)")
    .option("--created-before <ms>", "Upper bound on createdAt (epoch ms)")
    .option("--page <n>", "Page index (0-based)", "0")
    .option("--limit <n>", "Page size (max 100)", "50")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const filters: ListFeedbackOptions = {
          releaseId: opts.release,
          sentiment: parseSentiment(opts.sentiment),
          source: parseSource(opts.source),
          hasText: opts.hasText === true ? true : undefined,
          createdAfter: opts.createdAfter ? parseInt(opts.createdAfter, 10) : undefined,
          createdBefore: opts.createdBefore ? parseInt(opts.createdBefore, 10) : undefined,
          page: opts.page ? parseInt(opts.page, 10) : undefined,
          limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        };
        const result = await withSpinner("Fetching feedback…", () =>
          client.feedback.list(workspaceId, filters)
        );
        output(result.docs);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("stats")
    .description("Aggregate feedback stats (sentiment / source / per-release breakdown)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--release <id>", "Filter to one release")
    .option("--source <s>", "authed | anonymous")
    .option("--created-after <ms>", "Lower bound on createdAt (epoch ms)")
    .option("--created-before <ms>", "Upper bound on createdAt (epoch ms)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const filters: FeedbackStatsOptions = {
          releaseId: opts.release,
          source: parseSource(opts.source),
          createdAfter: opts.createdAfter ? parseInt(opts.createdAfter, 10) : undefined,
          createdBefore: opts.createdBefore ? parseInt(opts.createdBefore, 10) : undefined,
        };
        const result = await withSpinner("Aggregating feedback…", () =>
          client.feedback.stats(workspaceId, filters)
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("get <feedbackId>")
    .description("Get a single feedback record by id")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (feedbackId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching feedback record…", () =>
          client.feedback.get(workspaceId, feedbackId)
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
