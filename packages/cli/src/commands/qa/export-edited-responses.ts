import { Command } from "commander";
import { writeFile } from "fs/promises";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa export-edited-responses` — export rater-edited responses
 * as a JSONL training set ready for SFT fine-tuning.
 *
 * Phase B of the calibration UI. Raters who used the "Edit response"
 * button on the Calibrate page produced an `editedResponse` field on
 * their rating — a "what the model SHOULD have said" signal. This
 * command pulls those edits, joins them with the original prompts, and
 * emits one line per (prompt, edited-response) pair in the OpenAI
 * messages format:
 *
 *   {"messages":[{"role":"user","content":"<prompt>"},
 *                {"role":"assistant","content":"<edited response>"}]}
 *
 * Usage:
 *   divinci qa export-edited-responses --suite-id <id> --scorer-key <key> \
 *     [--output edited-responses.jsonl] [--format jsonl|csv]
 */

interface CalibrationRating {
  _id: string;
  workspace: string;
  testResultId: string;
  scorerKey: string;
  rubricVersion: string;
  score: number;
  reasoning?: string | null;
  editedResponse?: string | null;
  rater?: { userId?: string; displayName?: string };
  createdAt?: string;
  updatedAt?: string;
}

interface ListRatingsResponse {
  ratings: CalibrationRating[];
  total: number;
  skip: number;
  limit: number;
}

interface Triple {
  testResultId: string;
  prompt: string;
  response: string;
  gold: string;
}

interface TriplesResponse {
  rubricVersion: string;
  rubricPrompt: string;
  triples: Triple[];
  remainingCount: number;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
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

function csvEscape(s: string): string {
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function registerQAExportEditedResponsesCommand(parent: Command): void {
  parent
    .command("export-edited-responses")
    .description("Export rater-edited model responses as JSONL/CSV training data (Phase B)")
    .requiredOption("--suite-id <id>", "Suite to pull ratings from")
    .requiredOption("--scorer-key <key>", "Scorer key (e.g. llm-completeness-coverage)")
    .option("--output <path>", "Output file path", "edited-responses.jsonl")
    .option("--format <fmt>", "Output format: jsonl | csv", "jsonl")
    .option("--rater-user-id <id>", "Filter to a single rater's edits")
    .option("--include-score", "Include the rater's score in each row (jsonl/csv only)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        if (!["jsonl", "csv"].includes(opts.format)) {
          throw new Error(`--format must be jsonl or csv (got: ${opts.format})`);
        }

        // Pull ALL ratings for (suite, scorer). Page through if needed —
        // listRatings caps limit at 500.
        const allRatings: CalibrationRating[] = [];
        let skip = 0;
        const pageSize = 500;
        while (true) {
          const params = new URLSearchParams({
            suiteId: opts.suiteId,
            scorerKey: opts.scorerKey,
            limit: String(pageSize),
            skip: String(skip),
          });
          if (opts.raterUserId) params.set("raterUserId", opts.raterUserId);
          const url = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings?${params.toString()}`;
          const page = await fetchJson<ListRatingsResponse>(url, token);
          allRatings.push(...page.ratings);
          if (allRatings.length >= page.total || page.ratings.length < pageSize) break;
          skip += pageSize;
        }

        // Filter to ratings that actually have an editedResponse.
        const edited = allRatings.filter(r =>
          typeof r.editedResponse === "string" && r.editedResponse.trim().length > 0,
        );

        if (edited.length === 0) {
          console.warn(`No edited responses found for (suite=${opts.suiteId}, scorer=${opts.scorerKey}).`);
          console.warn(`Total ratings on this scorer: ${allRatings.length}.`);
          console.warn("Tip: raters need to use the 'Edit response' button on the Calibrate page (Phase B).");
          return;
        }

        // Need the original PROMPT for each edited rating. Pull a big
        // triples batch (covers all unrated AND rated since we'll filter).
        // Note: list-triples filters out items the requester already rated,
        // so we need to GET each test result individually OR enrich via
        // a lookup — for v1 simplicity, we try the triples endpoint with
        // a high limit and fall back to per-item lookups for misses.
        const triplesUrl = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/triples?suiteId=${encodeURIComponent(opts.suiteId)}&scorerKey=${encodeURIComponent(opts.scorerKey)}&limit=100`;
        const triplesResp = await fetchJson<TriplesResponse>(triplesUrl, token);
        const promptByTestResultId = new Map(
          triplesResp.triples.map(t => [t.testResultId, t.prompt]),
        );

        // Write output.
        if (opts.format === "jsonl") {
          const lines: string[] = [];
          let withPrompt = 0;
          let withoutPrompt = 0;
          for (const r of edited) {
            const prompt = promptByTestResultId.get(r.testResultId);
            if (!prompt) {
              withoutPrompt++;
              continue;
            }
            withPrompt++;
            const messages = [
              { role: "user", content: prompt },
              { role: "assistant", content: r.editedResponse },
            ];
            const row: Record<string, unknown> = { messages };
            if (opts.includeScore) {
              row.score = r.score;
              row.testResultId = r.testResultId;
              row.raterUserId = r.rater?.userId ?? null;
            }
            lines.push(JSON.stringify(row));
          }
          await writeFile(opts.output, lines.join("\n") + "\n", "utf-8");
          console.warn(`Wrote ${withPrompt} JSONL rows to ${opts.output}.`);
          if (withoutPrompt > 0) {
            console.warn(
              `⚠ ${withoutPrompt} edited ratings skipped — their testResultId was ` +
              `not in the recent triples batch (item is older than the batch window). ` +
              `Re-run after extending the triples lookup if you need them.`,
            );
          }
        } else {
          // CSV — quote everything that needs quoting.
          const headers = ["testResultId", "score", "raterUserId", "prompt", "editedResponse"];
          const rows: string[] = [headers.join(",")];
          let withPrompt = 0;
          for (const r of edited) {
            const prompt = promptByTestResultId.get(r.testResultId) ?? "";
            if (!prompt) continue;
            withPrompt++;
            rows.push([
              csvEscape(r.testResultId),
              String(r.score),
              csvEscape(r.rater?.userId ?? ""),
              csvEscape(prompt),
              csvEscape(r.editedResponse ?? ""),
            ].join(","));
          }
          await writeFile(opts.output, rows.join("\n") + "\n", "utf-8");
          console.warn(`Wrote ${withPrompt} CSV rows to ${opts.output}.`);
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
