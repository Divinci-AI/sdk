import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
function assertObjectId(value: string, label: string): string {
  if (!OBJECT_ID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected a 24-char hex ObjectId, got '${value.substring(0, 32)}'`);
  }
  return value;
}

/**
 * `divinci qa winner-pick` — record a calibrator's "this variant won"
 * pick for a specific gold question. Wraps the C.2
 * /scored-qa/calibration-ratings/winner-picks endpoint.
 *
 * The pick:
 *   1. Persists to ScoredQACalibrationWinnerPick (audit trail)
 *   2. Fires saveRoutingPreference() async with source:"calibration",
 *      teaching the platform's RAG Routing system to prefer this
 *      variant's RAG group for similar future queries
 *
 * Usage:
 *   # Pick "best overall" winner for a gold question
 *   divinci qa winner-pick \\
 *     --test-id <testId> \\
 *     --winner-test-result-id 69ed12ee219e297d37e8648a \\
 *     [--notes "v3 captures the fiber caveat correctly"] \\
 *     [--rater-display-name "Dr. Joel Fuhrman"]
 *
 *   # Pick winner for a specific scorer (per-scorer winner picks)
 *   divinci qa winner-pick \\
 *     --test-id ... --winner-test-result-id ... \\
 *     --scorer-key llm-completeness-coverage
 */

interface WinnerPickResponse {
  pick: {
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
  };
}

async function fetchJson<T>(url: string, token: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

export function registerQAWinnerPickCommand(parent: Command): void {
  parent
    .command("winner-pick")
    .description("Record a calibrator's 'this variant won' pick (feeds RAG Routing)")
    .requiredOption("--test-id <id>", "ScoredQATest._id — the gold question")
    .requiredOption("--winner-test-result-id <id>", "QATestResult._id of the winning variant")
    .option("--scorer-key <key>", "Per-scorer winner pick (omit for 'best overall')")
    .option("--notes <text>", "Free-text rationale (max 2000 chars)")
    .option("--rater-display-name <name>", "Display name to record on the pick")
    .option("--rater-role <role>", "Rater role tag (e.g. 'domain-expert')")
    .option("--json", "Output the full response as JSON")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        assertObjectId(opts.testId, "--test-id");
        assertObjectId(opts.winnerTestResultId, "--winner-test-result-id");

        const body: Record<string, unknown> = {
          testId: opts.testId,
          winnerTestResultId: opts.winnerTestResultId,
        };
        if (opts.scorerKey) body.scorerKey = opts.scorerKey;
        if (opts.notes) body.notes = opts.notes;
        if (opts.raterDisplayName) body.raterDisplayName = opts.raterDisplayName;
        if (opts.raterRole) body.raterRole = opts.raterRole;

        const url = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/winner-picks`;
        const result = await fetchJson<WinnerPickResponse>(url, token, body);

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const p = result.pick;
        console.warn(`✓ Winner pick saved`);
        console.warn(`  _id:                    ${p._id}`);
        console.warn(`  testId (gold question): ${p.testId}`);
        console.warn(`  winnerTestResultId:     ${p.winnerTestResultId}`);
        console.warn(`  winner release:         ${p.winnerReleaseId ?? "(unknown)"}`);
        console.warn(`  winner RAG group:       ${p.winnerRagVectorGroupId ?? "(none — routing skipped)"}`);
        if (p.scorerKey) {
          console.warn(`  scorer:                 ${p.scorerKey}`);
        } else {
          console.warn(`  scope:                  best overall`);
        }
        console.warn(`  rater:                  ${p.rater.userId}${p.rater.displayName ? ` (${p.rater.displayName})` : ""}`);
        if (p.notes) console.warn(`  notes:                  ${p.notes}`);
        if (p.winnerRagVectorGroupId) {
          console.warn(``);
          console.warn(`Routing preference fired async (source: "calibration").`);
          console.warn(`Future similar queries will prefer this RAG group via /api/v1 chat path.`);
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
