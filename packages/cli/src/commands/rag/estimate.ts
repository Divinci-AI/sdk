import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { CHUNKING_TOOL_OPTION_DESCRIPTION, assertValidChunkingTool } from "./chunking-tools.js";
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";

interface EstimateLine {
  key: string;
  toolId: string;
  inputCost: string;
  outputEscrow: string;
  costStatus: string;
}

interface EstimateResult {
  status: string;
  dryRun: boolean;
  files: Array<{
    originalName: string;
    byteLength: number;
    estimatedChunkCount: number;
    lines: EstimateLine[];
    totalEstimate: string;
    costStatus: string;
  }>;
  totalEstimate: string;
  costStatus: string;
  currency: string;
}

function formatNanoUSD(nano: string): string {
  const usd = Number(nano) / 1e9;
  if (!Number.isFinite(usd)) return "$?";
  if (usd === 0) return "$0.00";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function registerRagEstimateCommand(parent: Command): void {
  parent
    .command("estimate <files...>")
    .description("Dry-run cost estimate for processing files (chunker + cleaners + optional date extraction) — nothing is uploaded")
    .option("--chunking-tool <tool>", CHUNKING_TOOL_OPTION_DESCRIPTION)
    .option("--cleaners <ids>", "Comma-separated cleaner tool IDs (e.g. @divinci-ai/gim-cleaner)")
    .option("--extract-published-date", "Include the AI publish-date extraction pass in the estimate")
    .action(async (filePaths: string[], opts, cmd) => {
      try {
        assertValidChunkingTool(opts.chunkingTool as string | undefined);

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const files = filePaths.map((p) => {
          if (!existsSync(p)) {
            console.error(colors.red(`File not found: ${p}`));
            process.exit(1);
          }
          return { byteLength: statSync(p).size, originalName: basename(p) };
        });

        const toolId = (opts.chunkingTool as string) || "langextract";
        const cleaners = opts.cleaners
          ? (opts.cleaners as string).split(",").map((c: string) => c.trim()).filter(Boolean)
              .map((id: string) => ({ id, authId: "", config: {} }))
          : [];

        const result = await withSpinner("Estimating processing cost...", () =>
          httpClient.post<EstimateResult>(`${routeBase}/rag/files/estimate-cost`, {
            files,
            chunkingTool: { id: toolId, authId: "", config: {} },
            cleaners,
            extractPublishedDate: Boolean(opts.extractPublishedDate),
          })
        );

        if (isJsonMode()) {
          output(result);
          return;
        }

        for (const f of result.files) {
          console.log(`${colors.cyan(f.originalName)} (${(f.byteLength / 1024).toFixed(1)} KB, ~${f.estimatedChunkCount} chunks)`);
          for (const line of f.lines) {
            const cost = (BigInt(line.inputCost) + BigInt(line.outputEscrow)).toString();
            console.log(`  ${line.key.padEnd(14)} ${line.toolId.padEnd(40)} ${formatNanoUSD(cost)}${line.costStatus === "maximum" ? colors.dim(" (upper bound)") : ""}`);
          }
          console.log(`  ${colors.green("subtotal")}       ${" ".repeat(40)} ${formatNanoUSD(f.totalEstimate)}`);
        }
        console.log(`\n${colors.green("Total estimate:")} ${formatNanoUSD(result.totalEstimate)}${result.costStatus === "maximum" ? colors.dim(" (upper bound — final cost settles at actual usage)") : ""}`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
