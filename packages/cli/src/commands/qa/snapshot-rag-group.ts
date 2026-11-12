import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa snapshot-rag-group <suiteId>` — backfill the
 * ResponseGenerationSnapshot.{ragVectorGroupId, releaseSlugVersion}
 * fields onto historical QATestResult docs that were written before
 * the schema captured these fields.
 *
 * Why this exists: releases are mutable. The calibrate-page UI shows
 * "what RAG group was used to generate each variant's answer" by
 * reading the snapshot. Older runs were written when the snapshot
 * lacked these fields, so the UI fell back to current release state
 * (which lies whenever a release is later edited).
 *
 * This command resolves each test result's snapshot by:
 *   (1) Skipping if already populated
 *   (2) Copying down from the parent IterationResult.responseGenerationSnapshot
 *   (3) Falling back to the release's CURRENT ragVectorGroupId +
 *       whitelabelSlugVersion (best-effort — the release may have
 *       been edited since scoring)
 *
 * Use --dry-run first to preview impact without writing anything.
 *
 * Example:
 *   divinci qa snapshot-rag-group <whitelabelId> --dry-run
 *   divinci qa snapshot-rag-group <whitelabelId>
 */

interface BackfillResult {
  totalScanned: number;
  alreadySnapshotted: number;
  copiedFromIteration: number;
  // Per-field enrichment counts so slug-only and ragIndexes-only
  // updates are visible. Total enriched is the SUM of the three
  // (a single test result can be enriched on multiple fields).
  enrichedFromRelease: {
    ragVectorGroupId: number,
    releaseSlugVersion: number,
    ragVectorIndexIds: number,
  };
  // #238: arena-variant recovery — when iterationResultId encodes the
  // arena preset + variant index, the variant's ragVectorGroupId
  // override is the AUTHORITATIVE source (releases for arena variants
  // typically carry null ragVectorGroupId). Distinguished from the
  // weaker enrichedFromRelease fallback. Optional in the type because
  // older server builds don't emit it.
  enrichedFromArenaVariant?: {
    ragVectorGroupId: number,
  };
  missingRelease: number;
  errors: Array<{ testResultId: string, message: string }>;
  dryRun: boolean;
}

export function registerQASnapshotRagGroupCommand(parent: Command): void {
  parent
    .command("snapshot-rag-group <suiteId>")
    .description("Backfill ResponseGenerationSnapshot.ragVectorGroupId + releaseSlugVersion onto historical QATestResults")
    .option("--dry-run", "Preview what would change without writing", false)
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        const url = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/snapshot-rag-group`;
        process.stderr.write(`POST ${url}  (suiteId=${suiteId}, dryRun=${opts.dryRun})\n`);

        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ suiteId, dryRun: !!opts.dryRun }),
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

        const e = result.enrichedFromRelease;
        const av = result.enrichedFromArenaVariant?.ragVectorGroupId ?? 0;
        const summary = [
          ``,
          `${result.dryRun ? "📝 DRY-RUN —" : "✅"} Snapshot-rag-group backfill complete for suite ${suiteId}`,
          ``,
          `  Total QATestResults scanned:     ${result.totalScanned}`,
          `  Already snapshotted (skipped):   ${result.alreadySnapshotted}`,
          `  Copied from parent iteration:    ${result.copiedFromIteration}`,
          `  Enriched from arena variant (authoritative):`,
          `    - ragVectorGroupId:            ${av}`,
          `  Enriched from release-current (best-effort):`,
          `    - ragVectorGroupId:            ${e.ragVectorGroupId}`,
          `    - releaseSlugVersion:          ${e.releaseSlugVersion}`,
          `    - ragVectorIndexIds:           ${e.ragVectorIndexIds}`,
          `  Missing release (no fallback):   ${result.missingRelease}`,
          `  Errors:                          ${result.errors.length}`,
          ``,
        ];
        process.stdout.write(summary.join("\n"));

        if (result.errors.length > 0) {
          process.stderr.write(`\nFirst 5 errors:\n`);
          for (const e of result.errors.slice(0, 5)) {
            process.stderr.write(`  - ${e.testResultId}: ${e.message}\n`);
          }
        }
        if (result.dryRun) {
          process.stdout.write(`Re-run without --dry-run to apply.\n`);
        }
      } catch (e) {
        handleCommandError(e);
      }
    });
}
