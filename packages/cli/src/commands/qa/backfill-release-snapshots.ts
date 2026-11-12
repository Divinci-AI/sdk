import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa backfill-release-snapshots <suiteId>` — retroactively
 * populate `responseGenerationSnapshot.releaseSnapshotId` on QA test
 * results scored before the ReleaseSnapshot machinery shipped.
 *
 * Each test-result's source release is hashed (canonical-JSON →
 * sha-256) and either matched to an existing snapshot or used to
 * create a new one. Same hash + same release = same snapshot doc,
 * so this is idempotent — running it twice produces the same result
 * (alreadyHadSnapshot grows; nothing changes).
 *
 * Best-effort caveat: the snapshot captures the release's CURRENT
 * config, which may have been edited since the original scoring run.
 * The created snapshot is tagged `snapshottedFrom: "backfill"` so
 * downstream UI can warn about the after-the-fact reconstruction.
 * For QA runs landing AFTER the phase-1 ship, envToSnapshot already
 * creates `snapshottedFrom: "qa-run"` snapshots at write time, so
 * the live release IS the truthful state and no backfill is needed.
 *
 * Use --dry-run first to preview impact without writing snapshots.
 *
 * Examples:
 *   divinci qa backfill-release-snapshots <whitelabelId> --dry-run
 *   divinci qa backfill-release-snapshots <whitelabelId>
 *   divinci qa backfill-release-snapshots <whitelabelId> --limit 500
 */

interface BackfillResult {
  totalScanned: number;
  alreadyHadSnapshot: number;
  snapshotsCreated: number;
  snapshotsReused: number;
  missingRelease: number;
  errors: Array<{ testResultId: string, error: string }>;
  warnings: Array<{ snapshotId: string, message: string }>;
  distinctSnapshotCount: number;
  dryRun: boolean;
}

export function registerQABackfillReleaseSnapshotsCommand(parent: Command): void {
  parent
    .command("backfill-release-snapshots <suiteId>")
    .description("Retroactively populate responseGenerationSnapshot.releaseSnapshotId on historical QATestResults")
    .option("--dry-run", "Preview what would change without writing", false)
    .option("--limit <n>", "Max test-results to process per call (default 1000, max 5000)", "1000")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        const limit = parseInt(opts.limit, 10);
        if (!Number.isFinite(limit) || limit < 1 || limit > 5000) {
          process.stderr.write(`❌ --limit must be between 1 and 5000 (got ${opts.limit})\n`);
          process.exit(1);
        }

        const url = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/backfill-release-snapshots`;
        process.stderr.write(`POST ${url}  (suiteId=${suiteId}, dryRun=${opts.dryRun}, limit=${limit})\n`);

        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ suiteId, dryRun: !!opts.dryRun, limit }),
        });

        const responseText = await r.text();
        if (!r.ok) {
          process.stderr.write(`❌ HTTP ${r.status}: ${responseText.substring(0, 500)}\n`);
          process.exit(1);
        }

        let result: BackfillResult;
        try {
          result = JSON.parse(responseText) as BackfillResult;
        } catch {
          process.stderr.write(`❌ Failed to parse response as JSON: ${responseText.substring(0, 200)}\n`);
          process.exit(1);
          return;
        }

        const summary = [
          ``,
          `${result.dryRun ? "📝 DRY-RUN —" : "✅"} Backfill-release-snapshots complete for suite ${suiteId}`,
          ``,
          `  Total QATestResults scanned:        ${result.totalScanned}`,
          `  Already had releaseSnapshotId:      ${result.alreadyHadSnapshot}`,
          `  New snapshots created:              ${result.snapshotsCreated}`,
          `  Existing snapshots reused (dedupe): ${result.snapshotsReused}`,
          `  Missing source release:             ${result.missingRelease}`,
          `  Errors:                             ${result.errors.length}`,
          `  Distinct snapshots in workspace:    ${result.distinctSnapshotCount}`,
          ``,
        ];
        process.stdout.write(summary.join("\n"));

        if (result.warnings.length > 0) {
          process.stderr.write(`\nWarnings (first 10) — usually rag-vectors without a publishedVersion:\n`);
          for (const w of result.warnings.slice(0, 10)) {
            process.stderr.write(`  - snapshot ${w.snapshotId}: ${w.message}\n`);
          }
        }
        if (result.errors.length > 0) {
          process.stderr.write(`\nErrors (first 5):\n`);
          for (const e of result.errors.slice(0, 5)) {
            process.stderr.write(`  - ${e.testResultId}: ${e.error}\n`);
          }
        }
        if (result.dryRun) {
          process.stdout.write(`Re-run without --dry-run to apply.\n`);
        }
        if (
          !result.dryRun
          && result.totalScanned === limit
          && result.alreadyHadSnapshot + result.snapshotsCreated + result.snapshotsReused + result.missingRelease + result.errors.length === result.totalScanned
        ) {
          process.stdout.write(`Hit --limit=${limit}; re-run to process the next batch.\n`);
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
