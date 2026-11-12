/**
 * divinci rag health — per-vector or whitelabel-wide RAG health check
 *
 * Surfaces the structured `issues.list` shape added in Tier B #9
 * (2026-04-21). Renders each issue with its type, severity, fixability,
 * and one-line message so operators can triage at a glance.
 *
 * Subcommands:
 *   rag health check [vectorId]   — per-vector or all-vectors health scan
 *   rag health fix-all            — kick off the self-healing fix-all loop
 */
import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface HealthIssue {
  type: string;
  severity: "info" | "warning" | "error";
  fixable: boolean;
  fileId?: string;
  filename?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface HealthCheckResult {
  vectorId: string;
  vectorTitle: string;
  vectorIndexTool: string;
  embeddingModel?: string;
  expectedDataType?: string;
  issues: {
    list?: HealthIssue[];
    [key: string]: unknown;
  };
  totalFiles: number;
  totalIssues: number;
  fixableIssues: number;
  unfixableIssues: number;
  checkedAt: string;
}

function severitySymbol(s: HealthIssue["severity"]): string {
  if (s === "error") return colors.red("✖");
  if (s === "warning") return colors.yellow("⚠");
  return colors.cyan("ℹ");
}

function renderResult(r: HealthCheckResult, listOnly: boolean, limit: number): void {
  const list = r.issues?.list ?? [];

  if (!listOnly) {
    console.log(colors.bold(`\n${r.vectorTitle}`));
    console.log(
      `  id=${r.vectorId}  tool=${r.vectorIndexTool}` +
      (r.expectedDataType ? `  contract=${r.expectedDataType}` : "")
    );
    console.log(
      `  files=${r.totalFiles}  ` +
      `issues=${r.totalIssues} ` +
      `(${colors.red(`${r.fixableIssues} fixable`)}, ` +
      `${colors.yellow(`${r.unfixableIssues} unfixable`)})`
    );
    if (list.length === 0) {
      console.log(`  ${colors.green("✓ healthy")}\n`);
      return;
    }
  }

  const shown = list.slice(0, limit);
  for (const i of shown) {
    const loc = i.fileId ? `${i.fileId.slice(0, 10)}… ${(i.filename ?? "").slice(0, 34).padEnd(34)}` : "".padEnd(45);
    const fix = i.fixable ? colors.green("[fix] ") : colors.gray("[-]   ");
    console.log(`  ${severitySymbol(i.severity)} ${fix}${i.type.padEnd(20)} ${loc}  ${i.message}`);
  }
  if (shown.length < list.length) {
    console.log(colors.gray(`  ...and ${list.length - shown.length} more (use --limit N to see more)`));
  }
  if (!listOnly) console.log();
}

export function registerRagHealthCommand(parent: Command): void {
  const health = parent.command("health").description("RAG vector health diagnostics");

  health
    .command("check [vectorId]")
    .description("Scan one vector (if vectorId given) or all vectors in the workspace")
    .option("--limit <n>", "Max issues to show per vector", "20")
    .option("--list-only", "Skip headers, print only issue lines (pipe-friendly)")
    .action(async (vectorId: string | undefined, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const limit = parseInt(opts.limit, 10) || 20;

        if (vectorId) {
          const result = await withSpinner(`Scanning vector ${vectorId}...`, () =>
            httpClient.get<HealthCheckResult>(
              `${routeBase}/rag-vector/${vectorId}/health`
            )
          );
          if (isJsonMode()) { output(result as any); return; }
          renderResult(result, !!opts.listOnly, limit);
          return;
        }

        // No vectorId: list all targets then scan each
        const targets = await withSpinner("Listing vectors...", () =>
          httpClient.get<Array<{ _id: string; title?: string }>>(
            `${routeBase}/rag-vector`
          )
        );
        if (!Array.isArray(targets) || targets.length === 0) {
          console.log("No RAG vectors found in this workspace.");
          return;
        }

        const results: HealthCheckResult[] = [];
        for (const t of targets) {
          try {
            const r = await httpClient.get<HealthCheckResult>(
              `${routeBase}/rag-vector/${t._id}/health`
            );
            results.push(r);
          } catch (err) {
            console.error(colors.red(`  failed scanning ${t._id}: ${(err as Error).message}`));
          }
        }

        if (isJsonMode()) { output(results as any); return; }

        // Aggregate summary
        const totFix = results.reduce((s, r) => s + r.fixableIssues, 0);
        const totUnfix = results.reduce((s, r) => s + r.unfixableIssues, 0);
        const totFiles = results.reduce((s, r) => s + r.totalFiles, 0);
        console.log(colors.bold(`\nWorkspace health — ${results.length} vectors, ${totFiles} file refs`));
        console.log(
          `  ${colors.red(`${totFix} fixable`)}, ${colors.yellow(`${totUnfix} unfixable`)}\n`
        );

        for (const r of results.sort((a, b) => b.totalIssues - a.totalIssues)) {
          renderResult(r, !!opts.listOnly, limit);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  health
    .command("fix-all")
    .description("Kick off self-healing fix-all across every vector in the workspace")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        // fix-all is only registered on the OAuth custom-rag router
        // (POST /white-label/:wl/rag-vector/health/fix-all). There is no
        // v1 mirror yet — the CLI's API-key path simply can't call this
        // until a v1 route is added. `routeBase` for OAuth is
        // /white-label/:id and does NOT include the /rag-vector segment
        // that the server registration lives under, so we add it here.
        if (routeBase.startsWith("/api/v1")) {
          throw new Error(
            "`rag health fix-all` is not available on API-key auth yet — use OAuth (`divinci auth login`) in the meantime.",
          );
        }
        const fixAllPath = `${routeBase}/rag-vector/health/fix-all`;
        const result = await withSpinner("Kicking off health-fix-all...", () =>
          httpClient.post<{ operationId: string; message?: string; success: boolean }>(
            fixAllPath,
            {}
          )
        );
        if (isJsonMode()) { output(result as any); return; }
        console.log(colors.green("✓ fix-all started"));
        console.log(`  operationId: ${result.operationId}`);
        if (result.message) console.log(`  ${result.message}`);
        console.log(colors.gray("  (progress streams via WebSocket; this command returns immediately)"));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
