import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa list-ratings` — list calibration ratings, workspace-scoped,
 * with optional filters. Wraps GET /scored-qa/calibration-ratings.
 *
 * Use cases:
 *   - Audit: "show me every rating Dr. Fuhrman submitted last week"
 *   - Scripted workflows: feed ratings into a downstream agreement
 *     computation that the API doesn't compute server-side
 *   - Calibration progress: "how many ratings has rater X done in suite Y?"
 *
 * Usage:
 *   divinci qa list-ratings \\
 *     [--suite-id <suiteId>] \\
 *     [--scorer-key llm-relevance] \\
 *     [--rater-user-id auth0|abcd1234] \\
 *     [--limit 100] \\
 *     [--skip 0] \\
 *     [--json]
 */

interface RatingsResponse {
  ratings: Array<{
    _id: string;
    workspace: string;
    testResultId: string;
    scorerKey: string;
    score: number;
    rubricVersion: string;
    reasoning?: string | null;
    durationMs?: number | null;
    editedResponse?: string | null;
    rater: { userId: string; displayName?: string | null; role?: string | null };
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  skip: number;
  limit: number;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${text.substring(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse response (status ${resp.status}): ${text.substring(0, 300)}`);
  }
}

export function registerQAListRatingsCommand(parent: Command): void {
  parent
    .command("list-ratings")
    .description("List human-rater calibration ratings (filterable by suite/scorer/rater)")
    .option("--suite-id <id>", "Restrict to ratings for this suite (joins via testResults → qaTest._id)")
    .option("--scorer-key <key>", "Restrict to ratings under this scorer (e.g. llm-relevance)")
    .option("--rater-user-id <id>", "Restrict to ratings from this rater (Auth0 sub)")
    .option("--limit <n>", "Page size (max 500, default 100)", (v) => parseInt(v, 10))
    .option("--skip <n>", "Pagination offset (default 0)", (v) => parseInt(v, 10))
    .option("--json", "Output the full response as JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        const url = new URL(`${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings`);
        if (opts.suiteId) url.searchParams.set("suiteId", opts.suiteId);
        if (opts.scorerKey) url.searchParams.set("scorerKey", opts.scorerKey);
        if (opts.raterUserId) url.searchParams.set("raterUserId", opts.raterUserId);
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));
        if (typeof opts.skip === "number") url.searchParams.set("skip", String(opts.skip));

        const result = await fetchJson<RatingsResponse>(url.toString(), token);

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.warn(`Total: ${result.total}  ·  showing ${result.ratings.length} (skip=${result.skip}, limit=${result.limit})`);
        if (result.ratings.length === 0) {
          console.warn("(no ratings)");
          return;
        }
        console.warn("");
        for (const r of result.ratings) {
          const who = r.rater.displayName ? `${r.rater.userId} (${r.rater.displayName})` : r.rater.userId;
          const edited = r.editedResponse ? " · ✏ editedResponse" : "";
          console.warn(`  ${r.score}  scorer=${r.scorerKey}  result=${r.testResultId}`);
          console.warn(`    by ${who} · v${r.rubricVersion} · ${r.createdAt}${edited}`);
          if (r.reasoning) console.warn(`    note: ${r.reasoning.substring(0, 140)}${r.reasoning.length > 140 ? "..." : ""}`);
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
