/**
 * divinci rag test-retrieval — end-to-end retrieval probe against a vector.
 *
 * Wraps `POST /white-label/:wlId/rag-vector/:ragId/test-retrieval`. Dogfood
 * surface: embed a query, search the vector store, fetch the top-K chunks,
 * report scores + latency + any diagnostic issues. The canonical way to
 * answer "does this vector's embedding integration actually work?".
 *
 * Especially useful when verifying a newly-wired embedding model (e.g.
 * Gemini Embedding 2 preview) against an existing corpus — scores + chunk
 * previews land in the terminal.
 */
import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";

interface RetrievalIssue {
  type: string;
  message: string;
  fixable: boolean;
  fixAction?: string;
}

interface RetrievalDiagnostics {
  indexExists: boolean | null;
  indexPointCount: number | null;
  d1ChunksExist: boolean | null;
  treeIndexExists: boolean | null;
  vectorSearchResults: number;
  vectorSearchScores: number[];
  chunksReturned: number;
  chunkPreview: string | null;
  vectorSearchMs: number;
  chunkLookupMs: number;
  totalMs: number;
}

interface TestRetrievalResponse {
  vectorId: string;
  vectorTitle: string;
  vectorIndexTool: string;
  embeddingModel?: string;
  issues: RetrievalIssue[];
  diagnostics: RetrievalDiagnostics;
}

function scoreColor(s: number): (str: string) => string {
  if (s >= 0.7) return colors.green;
  if (s >= 0.5) return colors.yellow;
  return colors.red;
}

export function registerRagTestRetrievalCommand(parent: Command): void {
  parent
    .command("test-retrieval <vectorId> <query>")
    .description("End-to-end retrieval probe: embed a query, vector-search, fetch chunks, report scores + diagnostics")
    .option("--max-chunks <n>", "Max chunks to return", "5")
    .action(async (vectorId: string, query: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const maxChunks = parseInt(opts.maxChunks, 10) || 5;

        const res = await withSpinner(`Probing retrieval on ${vectorId}...`, () =>
          httpClient.post<TestRetrievalResponse>(
            `${routeBase}/rag-vector/${vectorId}/test-retrieval`,
            { query, maxChunks },
          )
        );

        if (isJsonMode()) { output(res as any); return; }

        const d = res.diagnostics;
        console.log();
        console.log(colors.bold(`${res.vectorTitle}`));
        console.log(
          `  id=${res.vectorId}  tool=${res.vectorIndexTool}` +
          (res.embeddingModel ? `  model=${res.embeddingModel}` : "")
        );
        console.log();
        console.log(colors.bold(`Retrieval query: "${query}"`));
        console.log(
          `  indexExists=${d.indexExists}  points=${d.indexPointCount ?? "?"}  ` +
          `results=${d.vectorSearchResults}  chunks=${d.chunksReturned}  ` +
          `total=${d.totalMs}ms (vectorSearch=${d.vectorSearchMs}ms, chunkLookup=${d.chunkLookupMs}ms)`
        );
        if (d.vectorSearchScores.length > 0) {
          const coloredScores = d.vectorSearchScores
            .map(s => scoreColor(s)(s.toFixed(4)))
            .join(", ");
          console.log(`  scores: [${coloredScores}]`);
        }
        if (d.chunkPreview) {
          const preview = d.chunkPreview.replace(/\s+/g, " ").slice(0, 200);
          console.log(`  preview: ${colors.gray(preview)}${d.chunkPreview.length > 200 ? "…" : ""}`);
        }
        console.log();

        if (res.issues.length === 0) {
          console.log(`  ${colors.green("✓ no issues — integration verified")}`);
        } else {
          console.log(colors.bold(`Issues (${res.issues.length}):`));
          for (const i of res.issues) {
            const tag = i.fixable ? colors.yellow("[fixable]") : colors.red("[unfixable]");
            console.log(`  ${tag} ${i.type}: ${i.message}`);
            if (i.fixAction) console.log(`    → ${colors.gray(i.fixAction)}`);
          }
        }
        console.log();
      } catch (error) {
        handleCommandError(error);
      }
    });
}
