/**
 * divinci rag events — timeline query against the Phase C1 event log.
 *
 * Consumer surface for `GET /white-label/:whitelabelId/rag-vector/:id/events`,
 * added in Tier C Phase C1 Round 3. Shows recent "what happened to this
 * vector?" events with actor + reason, so operators can answer timeline
 * questions without SSHing to a mongo shell.
 *
 * Subcommands:
 *   divinci rag events <vectorId>                       # last 50 non-backfill events
 *   divinci rag events <vectorId> --limit 200           # up to 500
 *   divinci rag events <vectorId> --file <fileId>       # filter to one file
 *   divinci rag events <vectorId> --action added        # filter to one action type
 *   divinci rag events <vectorId> --actor-type workflow # filter by actor.type
 *   divinci rag events <vectorId> --since 2026-04-22    # only recent
 *   divinci rag events <vectorId> --include-backfill    # show initial-backfill rows too
 */
import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface EventRow {
  _id: string;
  fileId: string;
  vectorId: string;
  target: string;
  action: string;
  actor: { type: string; id: string; label?: string };
  reason: string;
  previousState?: string;
  payload?: Record<string, unknown>;
  at: string;
  correlationId?: string;
}

interface EventsResponse {
  vectorId: string;
  count: number;
  hasMore: boolean;
  events: EventRow[];
}

function actionColor(action: string): (s: string) => string {
  switch (action) {
    case "added":              return colors.green;
    case "removed":            return colors.red;
    case "failed":
    case "source-missing":
    case "contract-violated":  return colors.red;
    case "processing-started": return colors.cyan;
    case "embedding-uploaded": return colors.green;
    case "queue-enqueued":
    case "requested":
    case "reassigned":         return colors.yellow;
    default:                   return (s: string) => s;
  }
}

export function registerRagEventsCommand(parent: Command): void {
  parent
    .command("events <vectorId>")
    .description("Show the recent event log for a RAG vector (Phase C1 timeline)")
    .option("--limit <n>", "Max events to return (1-500)", "50")
    .option("--file <fileId>", "Filter to events for one file")
    .option("--action <name>", "Filter to one action type (added|removed|failed|...)")
    .option("--actor-type <type>", "Filter by actor.type (user|system|workflow|script|fix-pass)")
    .option("--since <iso>", "Only events at or after this ISO timestamp")
    .option("--include-backfill", "Include initial-backfill rows (default hidden)")
    .action(async (vectorId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const params = new URLSearchParams();
        params.set("limit", opts.limit ?? "50");
        if (opts.file) params.set("fileId", opts.file);
        if (opts.action) params.set("action", opts.action);
        if (opts.actorType) params.set("actorType", opts.actorType);
        if (opts.since) params.set("since", opts.since);
        if (opts.includeBackfill) params.set("includeBackfill", "1");

        // Uses /rag/targets/:id/events which is mounted under both the v1
        // API-key router and the OAuth-whitelabel rag-cli router, so this
        // command works regardless of auth type.
        const res = await withSpinner(`Fetching events for vector ${vectorId}...`, () =>
          httpClient.get<EventsResponse>(
            `${routeBase}/rag/targets/${vectorId}/events?${params.toString()}`
          )
        );

        if (isJsonMode()) {
          output(res as any);
          return;
        }

        if (res.count === 0) {
          console.log(colors.gray("No events for this vector matching the filters."));
          console.log(colors.gray("  (hint: use --include-backfill to include initial-backfill rows)"));
          return;
        }

        console.log(
          colors.bold(
            `\nVector ${vectorId} — ${res.count} event${res.count === 1 ? "" : "s"}` +
            (res.hasMore ? ` (more available — use --limit to see more)` : "")
          )
        );

        // Events come newest-first from the API. Print chronological (oldest
        // first) for a readable timeline, but keep a time column so direction
        // is unambiguous.
        const chrono = [...res.events].reverse();
        for (const e of chrono) {
          const t = new Date(e.at).toISOString().replace("T", " ").slice(0, 19);
          const action = actionColor(e.action)(e.action.padEnd(22));
          const actor = `${e.actor.type}:${e.actor.id}`.slice(0, 40).padEnd(40);
          const file = e.fileId ? e.fileId.slice(-8) : "-".padEnd(8);
          console.log(`  ${colors.gray(t)}  ${action}  ${colors.gray(file)}  ${colors.gray(actor)}  ${e.reason}`);
        }
        console.log();
      } catch (error) {
        handleCommandError(error);
      }
    });
}
