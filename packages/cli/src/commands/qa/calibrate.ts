import { Command } from "commander";
import readline from "readline";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa calibrate` — interactive human-rater session against the
 * calibration storage layer (PR #1003) + agreement endpoint (PR2 Phase A).
 *
 * Walks the operator through (test, response, gold) triples one at a time,
 * collects 0/0.25/0.5/0.75/1.0 ratings, POSTs each to
 * /scored-qa/calibration-ratings, and (optionally) prints the agreement
 * table at the end so they can pick a calibrated default judge.
 *
 * Reference: notebooks/arena_results/calibrate_via_script_2026_04_25.py
 * (this is the TS port, fitted to the SDK's auth + config conventions).
 */

const VALID_SCORES: Record<string, number> = {
  "0": 0.0,
  "0.25": 0.25,
  "0.5": 0.5,
  "0.75": 0.75,
  "1": 1.0,
  "1.0": 1.0,
};

interface Triple {
  testResultId: string;
  testId: string | null;
  prompt: string;
  gold: string;
  response: string;
  llmScore: number | null;
  releaseId?: string | null;
}

interface TriplesResponse {
  rubricVersion: string;
  rubricPrompt: string;
  triples: Triple[];
  remainingCount: number;
}

interface AgreementResponse {
  scorerKey: string;
  rubricVersion: string;
  n_ratings: number;
  rho_per_judge: Array<{
    judgeId: string;
    rho: number;
    n_pairs: number;
    mean_human: number;
    mean_judge: number;
  }>;
  recommended_default_judge: string | null;
  recommendation_caveat: string | null;
  thresholds?: { rho: number; min_n: number };
}

function fmt(text: string, width = 100): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      if (line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out.join("\n");
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (ans) => resolve(ans)));
}

async function fetchJson<T>(url: string, token: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const resp = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} on ${opts.method ?? "GET"} ${url}: ${text.substring(0, 400)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse response from ${url} as JSON: ${text.substring(0, 200)}`);
  }
}

async function promptForScore(
  rl: readline.Interface,
  triple: Triple,
): Promise<{ score: number; reasoning: string } | "skip" | "stop"> {
  const sep = "=".repeat(100);
  console.warn(`\n${sep}`);
  console.warn("QUESTION");
  console.warn("-".repeat(100));
  console.warn(fmt(triple.prompt));
  console.warn("\nEXPECTED ANSWER (gold)");
  console.warn("-".repeat(100));
  console.warn(fmt(triple.gold));
  console.warn("\nMODEL'S RESPONSE");
  console.warn("-".repeat(100));
  console.warn(fmt(triple.response));
  // Blind rating: the LLM judge's score is intentionally NOT shown here — it is
  // revealed only AFTER the human commits their own score (below). Showing it
  // first anchors the rater toward the machine and inflates the human-judge
  // agreement (Spearman ρ) that calibration uses to validate that judge.
  // Matches the web Calibrate UI reveal-after-rate behaviour.
  console.warn(sep);
  console.warn("How well does the response cover the EXPECTED answer's key points?");
  console.warn("  0    — covers 0% (or contradicts the gold)");
  console.warn("  0.25 — covers ~25%");
  console.warn("  0.5  — covers ~50%");
  console.warn("  0.75 — covers ~75%");
  console.warn("  1.0  — covers 100%");
  console.warn("  Type 'skip' to skip; 'stop' to end the session.");

  while (true) {
    const ans = (await ask(rl, "\nScore (0 / 0.25 / 0.5 / 0.75 / 1.0): ")).trim().toLowerCase();
    if (ans === "stop" || ans === "quit" || ans === "q") return "stop";
    if (ans === "skip") return "skip";
    if (ans in VALID_SCORES) {
      // Reveal-after-rate: now that the human has committed, show the LLM
      // judge's score for transparency/comparison (post-hoc, non-anchoring).
      console.warn(`  → You rated ${VALID_SCORES[ans]}.  LLM judge scored this item: ${triple.llmScore ?? "n/a"}`);
      const reasoning = (await ask(rl, "One-line reasoning (optional): ")).trim();
      return { score: VALID_SCORES[ans], reasoning };
    }
    console.warn(`  ✖ '${ans}' is not one of {0, 0.25, 0.5, 0.75, 1.0} — try again`);
  }
}

function renderAgreementTable(agreement: AgreementResponse): void {
  console.warn("\n" + "=".repeat(100));
  console.warn(`Agreement: ${agreement.scorerKey}  (rubric=${agreement.rubricVersion}, n_ratings=${agreement.n_ratings})`);
  console.warn("=".repeat(100));
  if (agreement.rho_per_judge.length === 0) {
    console.warn("  (no LLM judges have scored these items yet)");
  } else {
    console.warn(`  ${"judge".padEnd(40)} ${"ρ".padStart(8)} ${"n_pairs".padStart(8)} ${"mean(h)".padStart(10)} ${"mean(j)".padStart(10)}`);
    for (const j of agreement.rho_per_judge) {
      const rho = Number.isFinite(j.rho) ? j.rho.toFixed(4) : "NaN";
      console.warn(
        `  ${j.judgeId.padEnd(40)} ${rho.padStart(8)} ${String(j.n_pairs).padStart(8)} ` +
        `${j.mean_human.toFixed(3).padStart(10)} ${j.mean_judge.toFixed(3).padStart(10)}`,
      );
    }
  }
  console.warn("-".repeat(100));
  if (agreement.recommended_default_judge) {
    console.warn(`✅ Recommended default judge: ${agreement.recommended_default_judge}`);
  } else if (agreement.recommendation_caveat) {
    console.warn(`⚠️  ${agreement.recommendation_caveat}`);
  }
  console.warn("=".repeat(100));
}

export function registerQACalibrateCommand(parent: Command): void {
  parent
    .command("calibrate <suiteId>")
    .description("Interactive human-rater session for judge calibration on a ScoredQA suite")
    .requiredOption("--scorer <key>", "Scorer key to calibrate (e.g. llm-completeness-coverage)")
    .option("--max <n>", "Max items to rate this session", "30")
    .option("--name <displayName>", "Display name to record on the rating (e.g. 'Dr. Joel Fuhrman')")
    .option("--role <role>", "Rater role tag", "domain-expert")
    .option("--show-agreement", "After session, fetch and print the agreement table")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const max = parseInt(opts.max, 10);

        // 1. Fetch the next batch of unrated triples
        const triplesUrl = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/triples` +
          `?suiteId=${encodeURIComponent(suiteId)}&scorerKey=${encodeURIComponent(opts.scorer)}&limit=${max}`;
        const triplesResp = await fetchJson<TriplesResponse>(triplesUrl, (config.accessToken ?? config.apiKey ?? ""));

        if (triplesResp.triples.length === 0) {
          console.warn(`Nothing to rate — ${triplesResp.remainingCount} unrated items in suite, but possibly all already rated by you under rubric ${triplesResp.rubricVersion}.`);
          return;
        }

        console.warn(`Fetched ${triplesResp.triples.length} unrated triples (${triplesResp.remainingCount} remain in suite).`);
        console.warn(`Rubric version: ${triplesResp.rubricVersion}`);

        // 2. Walk items
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        let rated = 0;
        let skipped = 0;
        try {
          for (let i = 0; i < triplesResp.triples.length; i++) {
            const t = triplesResp.triples[i];
            console.warn(`\n[${i + 1}/${triplesResp.triples.length}]`);
            const t0 = Date.now();
            const result = await promptForScore(rl, t);
            if (result === "stop") {
              console.warn("Stopping by user request.");
              break;
            }
            if (result === "skip") {
              console.warn("  ⊘ skipped");
              skipped++;
              continue;
            }

            // 3. POST the rating
            const body: Record<string, unknown> = {
              testResultId: t.testResultId,
              scorerKey: opts.scorer,
              score: result.score,
              durationMs: Date.now() - t0,
            };
            if (result.reasoning) body.reasoning = result.reasoning;
            if (opts.name) body.raterDisplayName = opts.name;
            if (opts.role) body.raterRole = opts.role;
            try {
              const rating = await fetchJson<{ rating: { _id: string } }>(
                `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings`,
                (config.accessToken ?? config.apiKey ?? ""),
                { method: "POST", body },
              );
              rated++;
              console.warn(`  ✓ saved rating _id=${rating.rating._id} score=${result.score}`);
            } catch (e) {
              console.warn(`  ✖ POST failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        } finally {
          rl.close();
        }

        console.warn(`\nSession complete: ${rated} rated, ${skipped} skipped`);

        // 4. Optional: show agreement
        if (opts.showAgreement) {
          const agreementUrl = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/agreement` +
            `?suiteId=${encodeURIComponent(suiteId)}&scorerKey=${encodeURIComponent(opts.scorer)}`;
          const agreement = await fetchJson<AgreementResponse>(agreementUrl, (config.accessToken ?? config.apiKey ?? ""));
          renderAgreementTable(agreement);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
