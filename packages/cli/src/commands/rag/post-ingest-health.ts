/**
 * #2 Auto post-ingest health probe.
 *
 * After ingestion completes, run a SELF-CONSISTENCY retrieval probe: take a
 * just-ingested chunk's own text as the query and confirm the index returns it
 * at a high score. A healthy index self-matches near ~1.0; an index with an
 * embedding-space mismatch (the F13 class — docs embedded with one model,
 * queried with another) returns even its own text at ~0.04. This catches the
 * silent "ingested but not retrievable" failure AT ingest, not at customer
 * query time. Best-effort: never throws, never fails the parent command.
 */
import { colors } from "../../output/colors.js";

// /all-chunks returns rows under `page[]` (not `chunks[]`).
interface ChunksResp { page?: Array<{ text?: string }> }
interface ProbeResp {
  diagnostics?: {
    indexExists?: boolean | null;
    vectorSearchResults?: number;
    vectorSearchScores?: number[];
  };
  issues?: Array<{ severity?: string; message?: string; code?: string }>;
}

interface HttpLike {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export async function printPostIngestHealth(
  httpClient: HttpLike,
  routeBase: string,
  vectorId: string,
): Promise<void> {
  try {
    const chunksRes = await httpClient.get<ChunksResp>(
      `${routeBase}/rag-vector/${vectorId}/all-chunks?offset=0&length=1&backend=auto`,
    );
    const sample = chunksRes.page?.[0]?.text?.trim();
    if (!sample) {
      console.log(colors.dim("  Health: no chunks found to probe (index may still be embedding)."));
      return;
    }
    // First ~12 words of a real chunk = a query that MUST self-match.
    const query = sample.split(/\s+/).slice(0, 12).join(" ");
    const probe = await httpClient.post<ProbeResp>(
      `${routeBase}/rag-vector/${vectorId}/test-retrieval`,
      { query, maxChunks: 3 },
    );
    const diag = probe.diagnostics ?? {};
    const scores = diag.vectorSearchScores ?? [];
    const top = scores.length > 0 ? scores[0] : null;
    const results = diag.vectorSearchResults ?? 0;

    if (diag.indexExists === false || results === 0) {
      console.log(colors.red("  ✖ Health: FAIL — index returned 0 results for its own content. Not retrievable."));
    } else if (top !== null && top < 0.5) {
      console.log(colors.yellow(
        `  ⚠ Health: WARN — self-match score ${top.toFixed(2)} is low (expected ~1.0). ` +
        "Likely an embedding-model mismatch — retrieval will under-perform.",
      ));
    } else {
      console.log(colors.green(`  ✓ Health: OK — self-match ${top !== null ? top.toFixed(2) : "n/a"}, ${results} result(s) retrievable.`));
    }
    for (const issue of probe.issues ?? []) {
      if (issue.message) console.log(colors.dim(`    • ${issue.severity ?? "info"}: ${issue.message}`));
    }
  } catch (err) {
    console.log(colors.dim(`  Health: probe skipped (${err instanceof Error ? err.message : "error"}).`));
  }
}
