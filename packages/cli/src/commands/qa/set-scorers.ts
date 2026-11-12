import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa suites set-scorers <targetSuiteId> --from <sourceSuiteId>`
 *
 * Copies the scoreGenerators (and suggestionGeneration, since the suite
 * PATCH validator requires both) from one suite onto another. Useful when
 * spinning up a new calibration suite that should share the proven scorer
 * stack of an existing suite — saves manual UI configuration and keeps
 * the cross-scorer Spearman ρ meaningful when comparing runs across
 * suites that share scorer configs.
 *
 * The PATCH endpoint validates the full suite body (name/description/
 * scoreGenerators/suggestionGeneration), so we read both suites and
 * assemble a payload that preserves the target's identity fields while
 * swapping in the source's scorer config.
 */
export function registerQASuitesSetScorersCommand(parent: Command): void {
  parent
    .command("set-scorers <suiteId>")
    .description("Copy scoreGenerators (and suggestionGeneration) from another suite onto this one")
    .requiredOption("--from <sourceSuiteId>", "Suite to copy scorer config FROM")
    .option("--force", "Overwrite even if target already has scoreGenerators (dangerous; default behavior is to refuse + print a diff so the user can review)", false)
    .option("--dry-run", "Print what WOULD change but don't PATCH", false)
    .action(async (suiteId: string, opts: { from: string, force?: boolean, dryRun?: boolean }, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const sourceUrl = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${opts.from}`;
        const targetUrl = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}`;
        const headers = {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        };

        type Suite = {
          name?: string,
          description?: string,
          scoreGenerators?: unknown[],
          suggestionGeneration?: unknown,
          calibrationConfig?: { rhoLowerTarget?: number, rhoTargetN?: number },
        };

        async function fetchSuite(url: string, label: string): Promise<Suite> {
          const r = await fetch(url, { headers: { Authorization: headers.Authorization } });
          const t = await r.text();
          if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${label}: ${t.substring(0, 300)}`);
          try { return JSON.parse(t) as Suite; }
          catch { throw new Error(`Non-JSON ${label}: ${t.substring(0, 200)}`); }
        }

        const [source, target] = await withSpinner("Fetching source + target suites...", async () => {
          return Promise.all([
            fetchSuite(sourceUrl, "source"),
            fetchSuite(targetUrl, "target"),
          ]);
        });

        const sourceScorers = Array.isArray(source.scoreGenerators) ? source.scoreGenerators : [];
        const targetScorers = Array.isArray(target.scoreGenerators) ? target.scoreGenerators : [];
        if (sourceScorers.length === 0) {
          throw new Error(`Source suite ${opts.from} has no scoreGenerators to copy.`);
        }
        if (!source.suggestionGeneration) {
          throw new Error(`Source suite ${opts.from} is missing suggestionGeneration; PATCH validator requires it.`);
        }

        // Safety: if target already has scoreGenerators, refuse without --force
        // and print a side-by-side diff so the user can decide whether the
        // overwrite is intentional. Same policy applies to suggestionGeneration
        // since the PATCH validator requires both fields together — if we
        // overwrite scorers we'd also be replacing the suggestion config.
        if (targetScorers.length > 0 && !opts.force) {
          process.stderr.write([
            ``,
            `❌ Refusing to overwrite — target suite ${suiteId} already has ${targetScorers.length} scoreGenerator(s).`,
            ``,
            `Diff (target → source):`,
            ...renderScorerDiff(targetScorers as ScorerLike[], sourceScorers as ScorerLike[]),
            ``,
            `If this overwrite is intentional, re-run with --force.`,
            `If you wanted to merge instead of replace, that's not supported yet — open an issue or do it via the UI.`,
            ``,
          ].join("\n"));
          process.exit(2);
          return;
        }

        // Assemble the PATCH body. Target's identity fields stay, source's
        // scorer + suggestion config replaces target's. calibrationConfig
        // stays as the target's (per-suite risk profile is local choice).
        const body: Record<string, unknown> = {
          name: target.name ?? "Untitled",
          description: target.description ?? "",
          scoreGenerators: sourceScorers,
          suggestionGeneration: source.suggestionGeneration,
        };
        if (target.calibrationConfig) body.calibrationConfig = target.calibrationConfig;

        if (opts.dryRun) {
          process.stdout.write([
            ``,
            `🛟 --dry-run — no PATCH sent.`,
            ``,
            `Would set on suite ${suiteId}:`,
            `  Scorers: ${sourceScorers.length} (replacing ${targetScorers.length})`,
            `  Diff:`,
            ...renderScorerDiff(targetScorers as ScorerLike[], sourceScorers as ScorerLike[]),
            ``,
            `Re-run without --dry-run to actually apply.`,
            ``,
          ].join("\n"));
          return;
        }

        const updated = await withSpinner("PATCHing target suite...", async () => {
          const r = await fetch(targetUrl, {
            method: "PATCH",
            headers,
            body: JSON.stringify(body),
          });
          const t = await r.text();
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.substring(0, 500)}`);
          try { return JSON.parse(t) as Suite & { _id?: string }; }
          catch { throw new Error(`Non-JSON PATCH response: ${t.substring(0, 200)}`); }
        });

        const updatedScorers = Array.isArray(updated.scoreGenerators) ? updated.scoreGenerators : [];
        process.stdout.write([
          ``,
          `✅ Copied scorer config to suite ${suiteId}`,
          ``,
          `  From:                 ${opts.from}`,
          `  Scorers copied:       ${updatedScorers.length}`,
          `  Target name:          ${updated.name ?? "(unchanged)"}`,
          ``,
        ].join("\n"));
      } catch (e) {
        handleCommandError(e);
      }
    });
}

// Minimal shape needed for the diff. The PATCH validator handles the full
// schema; we just need scorer identity + weight to render a useful diff.
interface ScorerLike {
  weight?: number,
  source?: { _id?: string, type?: string, assistantTool?: { id?: string } },
  scorerKey?: string,
}

function scorerKey(s: ScorerLike): string {
  return s.scorerKey ?? s.source?._id ?? "(unknown)";
}

function renderScorerDiff(target: ScorerLike[], source: ScorerLike[]): string[] {
  const tByKey = new Map<string, ScorerLike>(target.map(s => [scorerKey(s), s]));
  const sByKey = new Map<string, ScorerLike>(source.map(s => [scorerKey(s), s]));
  const allKeys = new Set([...tByKey.keys(), ...sByKey.keys()]);
  const lines: string[] = [];
  for (const k of [...allKeys].sort()) {
    const t = tByKey.get(k);
    const s = sByKey.get(k);
    if (t && s) {
      if (t.weight === s.weight) {
        lines.push(`    = ${k}  weight=${t.weight}`);
      } else {
        lines.push(`    ~ ${k}  weight ${t.weight} → ${s.weight}`);
      }
    } else if (t && !s) {
      lines.push(`    - ${k}  (would be REMOVED, weight=${t.weight})`);
    } else if (!t && s) {
      lines.push(`    + ${k}  (would be ADDED, weight=${s.weight})`);
    }
  }
  if (lines.length === 0) lines.push(`    (no scorer changes)`);
  return lines;
}
