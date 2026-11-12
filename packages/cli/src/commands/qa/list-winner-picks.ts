import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa list-winner-picks` — list this rater's calibration winner
 * picks for a suite. Wraps GET /scored-qa/calibration-ratings/winner-picks.
 *
 * Always scoped to the authenticated user — the server filters by
 * `rater.userId` so this command never returns another rater's picks.
 *
 * Usage:
 *   divinci qa list-winner-picks \\
 *     [--suite-id <suiteId>] \\
 *     [--test-ids id1,id2,id3] \\
 *     [--scorer-key llm-relevance] \\
 *     [--limit 100] \\
 *     [--skip 0] \\
 *     [--json]
 */

interface WinnerPicksResponse {
  picks: Array<{
    _id: string;
    workspace: string;
    testId: string;
    winnerTestResultId: string;
    winnerRagVectorGroupId?: string | null;
    winnerReleaseId?: string | null;
    scorerKey?: string;
    notes?: string | null;
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

export function registerQAListWinnerPicksCommand(parent: Command): void {
  parent
    .command("list-winner-picks")
    .description("List the current rater's calibration winner picks (filterable by suite/scorer)")
    .option("--suite-id <id>", "Restrict to picks for testIds in this suite (IDOR-checked)")
    .option("--test-ids <csv>", "Comma-separated testId whitelist (intersected with suite if both)")
    .option("--scorer-key <key>", "Restrict to per-scorer picks (omit for 'best overall')")
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

        const url = new URL(`${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/winner-picks`);
        if (opts.suiteId) url.searchParams.set("suiteId", opts.suiteId);
        if (opts.testIds) url.searchParams.set("testIds", opts.testIds);
        if (opts.scorerKey) url.searchParams.set("scorerKey", opts.scorerKey);
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));
        if (typeof opts.skip === "number") url.searchParams.set("skip", String(opts.skip));

        const result = await fetchJson<WinnerPicksResponse>(url.toString(), token);

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.warn(`Total: ${result.total}  ·  showing ${result.picks.length} (skip=${result.skip}, limit=${result.limit})`);
        if (result.picks.length === 0) {
          console.warn("(no winner picks)");
          return;
        }
        console.warn("");
        for (const p of result.picks) {
          const scope = p.scorerKey ?? "best-overall";
          console.warn(`  test=${p.testId}  →  winner=${p.winnerTestResultId}`);
          console.warn(`    scope=${scope} · release=${p.winnerReleaseId ?? "?"} · RAG=${p.winnerRagVectorGroupId ?? "(none)"} · ${p.updatedAt}`);
          if (p.notes) console.warn(`    note: ${p.notes.substring(0, 140)}${p.notes.length > 140 ? "..." : ""}`);
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
