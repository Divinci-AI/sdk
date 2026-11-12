/**
 * divinci rag d1-provision — Provision per-vector D1 databases.
 *
 * Subcommands:
 *   rag d1-provision status                        Show D1 backing state across vectors
 *   rag d1-provision run [--vectors id,id,...]     Provision unprovisioned (or force re-provision specific)
 *   rag d1-provision run --dry-run                 Preview only
 *
 * Wraps:
 *   GET  /white-label/:wl/rag-vector/d1-provision
 *   POST /white-label/:wl/rag-vector/d1-provision
 *
 * The POST endpoint is idempotent — if `--vectors <ids>` is passed, the targeted
 * vectors are force-reprovisioned even if they already have a d1DatabaseId
 * (use this to recover from a deleted D1 backing). Without `--vectors`, only
 * unprovisioned vectors get D1 databases (standard provisioning sweep).
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel } from "../../output/safe-text.js";


interface ProvisionStatusVector {
  vectorId: string;
  title: string;
  vectorIndexTool: string;
  provisioned: boolean;
  d1DatabaseId?: string;
  d1WorkerName?: string;
}

interface ProvisionStatus {
  success: boolean;
  summary: {
    total: number;
    provisioned: number;
    unprovisioned: number;
    skippedTools?: number;
  };
  vectors: ProvisionStatusVector[];
}

interface ProvisionResult {
  success: boolean;
  dryRun?: boolean;
  results: Array<{
    vectorId: string;
    title: string;
    vectorIndexTool: string;
    status: "provisioned" | "skipped" | "failed";
    databaseId?: string;
    workerName?: string;
    error?: string;
  }>;
}


export function registerRagD1ProvisionCommand(parent: Command): void {
  const d1 = parent
    .command("d1-provision")
    .description("Manage per-vector D1 database backing (probe + reprovision broken vectors)");

  // ── status ────────────────────────────────────────────────────────────────
  d1
    .command("status")
    .description("Show D1 provisioning status across this workspace's RAG vectors")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching D1 status...", () =>
          httpClient.get<ProvisionStatus>(`${routeBase}/rag-vector/d1-provision`),
        );

        if (isJsonMode()) { output(data); return; }

        const vectors = data.vectors || [];
        const s = data.summary || { total: vectors.length, provisioned: 0, unprovisioned: 0 };
        console.log(colors.dim(`Total: ${s.total}  `) +
                    colors.cyan(`provisioned: ${s.provisioned}  `) +
                    (s.unprovisioned > 0 ? colors.yellow(`unprovisioned: ${s.unprovisioned}`) : colors.dim(`unprovisioned: 0`)) +
                    (typeof s.skippedTools === "number" ? colors.dim(`  skipped-tools: ${s.skippedTools}`) : ""));
        console.log(colors.dim("\n  Note: 'provisioned' means d1DatabaseId is set on the vector;\n        the underlying D1 may still be deleted upstream. Use\n        `divinci rag events <vectorId>` to look for D1_EXEC_ERROR.\n"));
        for (const v of vectors) {
          const dot = v.provisioned ? colors.cyan("●") : colors.yellow("○");
          const dbInfo = v.provisioned
            ? colors.dim(`db=${v.d1DatabaseId ?? "?"}`)
            : colors.yellow("(no D1 backing)");
          console.log(`  ${dot} ${v.vectorId}  ${safeLabel(v.title)}  ${colors.dim(`[${v.vectorIndexTool}]`)}  ${dbInfo}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── run ───────────────────────────────────────────────────────────────────
  d1
    .command("run")
    .description("Provision D1 databases. By default only unprovisioned; with --vectors force-reprovisions specific ids (use to recover from a deleted D1 backing).")
    .option("--vectors <ids>", "Comma-separated rag-vector ids to FORCE-reprovision (even if already provisioned)")
    .option("--dry-run", "Preview which vectors would be provisioned without making changes")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const body: { dryRun?: boolean; ragVectorIds?: string[] } = {};
        if (opts.dryRun) body.dryRun = true;
        if (opts.vectors) {
          const ids = String(opts.vectors).split(",").map(s => s.trim()).filter(Boolean);
          if (ids.length === 0) {
            console.error(colors.red("--vectors was passed but no ids parsed"));
            process.exit(1);
          }
          body.ragVectorIds = ids;
        }

        const data = await withSpinner(
          opts.dryRun ? "Dry-run provisioning..." : "Provisioning D1 databases...",
          () => httpClient.post<ProvisionResult>(`${routeBase}/rag-vector/d1-provision`, body),
        );

        if (isJsonMode()) { output(data); return; }

        const results = data.results || [];
        if (results.length === 0) {
          console.log(colors.dim("No vectors needed provisioning."));
          return;
        }

        const provisioned = results.filter(r => r.status === "provisioned");
        const skipped     = results.filter(r => r.status === "skipped");
        const failed      = results.filter(r => r.status === "failed");

        console.log(colors.dim(`Mode: ${data.dryRun ? "DRY-RUN" : "APPLY"}  `) +
                    colors.cyan(`provisioned=${provisioned.length}  `) +
                    colors.dim(`skipped=${skipped.length}  `) +
                    (failed.length > 0 ? colors.red(`failed=${failed.length}`) : `failed=${failed.length}`));
        console.log("");
        for (const r of results) {
          const dot = r.status === "provisioned" ? colors.cyan("✓")
                    : r.status === "skipped"     ? colors.dim("·")
                    : colors.red("✗");
          const detail = r.status === "provisioned"
            ? colors.dim(`db=${r.databaseId ?? "?"} worker=${r.workerName ?? "?"}`)
            : r.status === "failed"
              ? colors.red(r.error ?? "unknown error")
              : "";
          console.log(`  ${dot} ${r.vectorId}  ${safeLabel(r.title)}  ${colors.dim(`[${r.vectorIndexTool}]`)}  ${detail}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
