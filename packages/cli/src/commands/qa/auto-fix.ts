import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa auto-fix …` — drive the scored-QA auto-fix loop from the CLI.
 *
 * The loop runs a QA suite against a release, treats every low-scoring test
 * as a knowledge gap, proposes a patch to the release's RAG vector (new
 * chunks, and existing chunks flagged for removal), and stops for a human
 * to approve the patch before applying it. Until now the loop was reachable
 * only from the web UI or a raw `divinci api` call.
 *
 * Talks to the white-label scored-qa routes directly, the same way
 * `qa runs` does, rather than through the SDK.
 */

type Ctx = { baseUrl: string, workspaceId: string, token: string };

async function context(cmd: Command): Promise<Ctx>{
  let config = requireConfig(cmd.optsWithGlobals());
  config = await ensureValidToken(config);
  const workspaceId = requireWorkspaceId(config);
  return {
    baseUrl: config.apiUrl.replace(/\/+$/, ""),
    workspaceId,
    token: config.accessToken as string,
  };
}

async function call(ctx: Ctx, method: string, path: string, body?: unknown): Promise<any>{
  const res = await fetch(`${ctx.baseUrl}/white-label/${ctx.workspaceId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if(!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  if(!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (status ${res.status}): ${text.substring(0, 200)}`);
  }
}

const AUTO_FIX = "/scored-qa/auto-fix";

function print(data: unknown, human: ()=>void, wantJson?: boolean): void{
  if(wantJson || isJsonMode()){
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  human();
}

const PATCH_CHUNK_PAGE = 50;

/**
 * The patch-chunks and flagged-chunks routes both answer `{ page, total }`.
 * Reading any other field (this command used to try `chunks` / `addedChunks` /
 * `additions` on the patch document, which holds none of them) reports every
 * patch as empty — on 2026-10-02 it printed "0" for a patch holding 3 chunks.
 */
export function pagedList(resp: unknown): { items: any[], total: number }{
  if(Array.isArray(resp)) return { items: resp, total: resp.length };
  const r = resp as { page?: unknown, total?: unknown } | null | undefined;
  const items = Array.isArray(r?.page) ? r.page as any[] : [];
  return { items, total: typeof r?.total === "number" ? r.total : items.length };
}

/** Test results whose suggestors escalated instead of proposing a fix. */
export function escalatedQuestions(testResults: unknown): Array<{ prompt: string, confidence: number, reasoning: string }>{
  if(!Array.isArray(testResults)) return [];
  const out: Array<{ prompt: string, confidence: number, reasoning: string }> = [];
  for(const r of testResults as any[]){
    const escalations = r?.suggestions?.escalations;
    if(!Array.isArray(escalations) || escalations.length === 0) continue;
    if((r.suggestions.newRag?.length ?? 0) > 0) continue;
    const best = escalations.reduce((a: any, b: any)=>(Number(b?.confidence) > Number(a?.confidence) ? b : a));
    out.push({
      prompt: String(r.prompt ?? r.qaTest?.prompt ?? ""),
      confidence: Number(best?.confidence ?? 0),
      reasoning: String(best?.reasoning ?? ""),
    });
  }
  return out;
}

function pct(v: unknown): string{
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
}

function summarizeLoop(loop: any): void{
  const lines = [
    `Loop:        ${loop._id}`,
    `Status:      ${loop.status}`,
    `Suite:       ${loop.suiteId}`,
    `Release:     ${loop.releaseId}`,
    `Vectors:     ${(loop.additionIndexes ?? []).map((a: any)=>a.ragIndexId).join(", ") || "—"}`,
  ];
  const iterations = loop.iterations ?? loop.iterationResults;
  if(Array.isArray(iterations)) lines.push(`Iterations:  ${iterations.length}`);
  if(loop.interventionRequired){
    const ir = loop.interventionRequired;
    const approvals = ir.approvals?.length ?? (ir.resolvedBy ? 1 : 0);
    lines.push(ir.resolvedAt
      ? `Review:      approved (${approvals} approval(s)) — ${ir.reason ?? "patch review"}`
      : `Review:      needed (${approvals} approval(s) so far) — ${ir.reason ?? "patch awaiting approval"}`);
  }
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
  if(loop.status === "escalated"){
    // eslint-disable-next-line no-console
    console.log(`\nEvery low score was escalated: no passage in the corpus states the answer, so nothing was added. List the questions with \`divinci qa auto-fix iterations ${loop._id}\` and \`divinci qa auto-fix patch <iterationId>\`.`);
  }
  if(loop.status === "requires-review"){
    // eslint-disable-next-line no-console
    console.log(`\nA patch is waiting for a human. Inspect it with \`divinci qa auto-fix iterations ${loop._id}\` and \`divinci qa auto-fix patch <iterationId>\`, then \`divinci qa auto-fix approve ${loop._id}\`.`);
  }
}

export function registerQAAutoFixCommands(parent: Command): void{
  const autoFix = parent
    .command("auto-fix")
    .description("Find knowledge gaps with a QA suite, propose RAG patches, and gate them on human review");

  autoFix
    .command("start <suiteId>")
    .description("Start an auto-fix loop: run the suite, treat low scores as gaps, propose a vector patch")
    .requiredOption("-r, --release <releaseId>", "Release to test and fix")
    .requiredOption("-v, --vector <vectorIds...>", "RAG vector(s) the patch may add chunks to")
    .option("--embedding-tool <toolId>", "Embedding tool for new chunks (default: each vector's own embedding model)")
    .option("--low-score <n>", "A test below this overall score counts as a gap (0-1)", "0.8")
    .option("--max-iterations <n>", "Maximum test → patch iterations", "3")
    .option("--auto-apply-min-confidence <n>", "Suggestions at or above this confidence may auto-apply when review is off (0-1)", "0.75")
    .option("--no-human-review", "Do not require a human to approve each patch (suggestors may still require it)")
    .option("--max-attempts-per-chunk <n>", "Give up on a gap after this many attempts; it is then escalated")
    .option("--json", "Output raw JSON")
    .action(async (suiteId: string, opts, cmd)=>{
      try {
        const ctx = await context(cmd);
        const vectors: string[] = opts.vector;
        const additionIndexes = await withSpinner("Resolving vectors...", async ()=>Promise.all(vectors.map(async (id)=>{
          let toolId: string | undefined = opts.embeddingTool;
          if(!toolId){
            const vec = await call(ctx, "GET", `/rag-vector/${id}`);
            toolId = (vec?.data ?? vec)?.embeddingModel;
            if(!toolId) throw new Error(`Vector ${id} has no embeddingModel; pass --embedding-tool`);
          }
          return { ragIndexId: id, embeddingTool: { id: toolId, authId: "", config: {} } };
        })));
        const body = {
          suiteId,
          releaseId: opts.release,
          additionIndexes,
          config: {
            lowScoreConfig: { overall: Number(opts.lowScore), individual: {} },
            autoApplyMinConfidence: Number(opts.autoApplyMinConfidence),
            maxIterations: parseInt(opts.maxIterations, 10),
            humanReviewRequired: opts.humanReview !== false,
            ...(opts.maxAttemptsPerChunk ? { maxAttemptsPerChunk: parseInt(opts.maxAttemptsPerChunk, 10) } : {}),
          },
        };
        const result = await withSpinner("Starting auto-fix loop...", ()=>call(ctx, "POST", AUTO_FIX, body));
        print(result, ()=>{
          const id = result?._id ?? result?.loopId ?? result?.loop?._id;
          // eslint-disable-next-line no-console
          console.log(`Auto-fix loop started${id ? `: ${id}` : ""}.\nFollow it with \`divinci qa auto-fix status ${id ?? "<loopId>"}\`.`);
        }, opts.json);
      } catch(error){
        handleCommandError(error);
      }
    });

  autoFix
    .command("list")
    .alias("ls")
    .description("List auto-fix loops in this workspace")
    .option("--status <statuses>", "Comma-separated statuses, e.g. requires-review,running")
    .option("--suite <suiteId>", "Only loops for this suite")
    .option("--release <releaseId>", "Only loops for this release")
    .option("--json", "Output raw JSON")
    .action(async (opts, cmd)=>{
      try {
        const ctx = await context(cmd);
        const q = new URLSearchParams();
        if(opts.status) q.set("status", opts.status);
        if(opts.suite) q.set("suiteId", opts.suite);
        if(opts.release) q.set("releaseId", opts.release);
        const loops = await withSpinner("Fetching auto-fix loops...", ()=>call(ctx, "GET", `${AUTO_FIX}${q.size ? `?${q}` : ""}`));
        print(loops, ()=>{
          const list = Array.isArray(loops) ? loops : (loops?.docs ?? []);
          if(list.length === 0){
            // eslint-disable-next-line no-console
            console.log("No auto-fix loops found.");
            return;
          }
          for(const l of list){
            // eslint-disable-next-line no-console
            console.log(`${l._id}  ${String(l.status).padEnd(16)}  suite ${l.suiteId}  release ${l.releaseId}`);
          }
        }, opts.json);
      } catch(error){
        handleCommandError(error);
      }
    });

  autoFix
    .command("status <loopId>")
    .description("Show a loop's status, and whether a patch is waiting for human review")
    .option("--json", "Output raw JSON")
    .action(async (loopId: string, opts, cmd)=>{
      try {
        const ctx = await context(cmd);
        const loop = await withSpinner("Fetching loop...", ()=>call(ctx, "GET", `${AUTO_FIX}/${loopId}`));
        print(loop, ()=>summarizeLoop(loop), opts.json);
      } catch(error){
        handleCommandError(error);
      }
    });

  autoFix
    .command("iterations <loopId>")
    .description("List a loop's iterations: overall score, and how many tests were gaps")
    .option("--json", "Output raw JSON")
    .action(async (loopId: string, opts, cmd)=>{
      try {
        const ctx = await context(cmd);
        const its = await withSpinner("Fetching iterations...", ()=>call(ctx, "GET", `${AUTO_FIX}/${loopId}/iteration`));
        print(its, ()=>{
          const list = Array.isArray(its) ? its : (its?.docs ?? []);
          if(list.length === 0){
            // eslint-disable-next-line no-console
            console.log("No iterations yet.");
            return;
          }
          for(const it of list){
            const results: any[] = it.results ?? [];
            const failures: any[] = it.failures ?? [];
            // eslint-disable-next-line no-console
            console.log(`${it._id}  ${String(it.status).padEnd(10)}  overall ${pct(it.overallScore)}  tests ${results.length}  failed-to-run ${failures.length}`);
          }
        }, opts.json);
      } catch(error){
        handleCommandError(error);
      }
    });

  autoFix
    .command("patch <iterationId>")
    .description("Show the patch an iteration proposes: chunks to add and chunks flagged for removal")
    .option("--json", "Output raw JSON")
    .action(async (iterationId: string, opts, cmd)=>{
      try {
        const ctx = await context(cmd);
        const [patch, flagged, testResults] = await withSpinner("Fetching patch...", ()=>Promise.all([
          // An iteration that escalated everything has an empty patch (or none).
          call(ctx, "GET", `${AUTO_FIX}/iteration/${iterationId}/patch`).catch(()=>null),
          call(ctx, "GET", `${AUTO_FIX}/iteration/${iterationId}/flagged-chunks`).catch(()=>null),
          call(ctx, "GET", `${AUTO_FIX}/iteration/${iterationId}/test-results`).catch(()=>null),
        ]));
        const escalated = escalatedQuestions(testResults);
        // The patch document does not carry its chunks; they live behind the
        // rag-vector patch chunks route, which requires offset AND length.
        const patchId = patch?._id;
        const chunks = patchId
          ? await withSpinner("Fetching proposed chunks...", ()=>call(
            ctx, "GET", `/rag-vector/patch/${patchId}/chunks?offset=0&length=${PATCH_CHUNK_PAGE}`,
          ))
          : null;
        print({ patch, chunks, flagged, escalated }, ()=>{
          const added = pagedList(chunks);
          // eslint-disable-next-line no-console
          console.log(`Chunks proposed for addition: ${added.total}`);
          for(const c of added.items.slice(0, 20)){
            const text = String(c.text ?? c.content ?? "").replace(/\s+/g, " ").slice(0, 160);
            const confidence = c.metadata?.scoredQaInfo?.confidence ?? c.confidence;
            // eslint-disable-next-line no-console
            console.log(`  + ${text}${confidence !== undefined ? `  (confidence ${pct(confidence)})` : ""}`);
          }
          const flaggedList = pagedList(flagged).items;
          // eslint-disable-next-line no-console
          console.log(`Chunks flagged for removal: ${flaggedList.length}`);
          for(const c of flaggedList.slice(0, 20)){
            const text = String(c.text ?? c.content ?? "").replace(/\s+/g, " ").slice(0, 160);
            // eslint-disable-next-line no-console
            console.log(`  - ${text}${c.shouldRemove === false ? "  (kept)" : ""}`);
          }
          // eslint-disable-next-line no-console
          console.log(`Questions escalated to a human (no corpus passage states the answer): ${escalated.length}`);
          for(const e of escalated.slice(0, 20)){
            // eslint-disable-next-line no-console
            console.log(`  ? ${e.prompt.replace(/\s+/g, " ").slice(0, 160)}  (P(answer in corpus) ${pct(e.confidence)})`);
          }
          // eslint-disable-next-line no-console
          console.log("\nUse --json for the full patch.");
        }, opts.json);
      } catch(error){
        handleCommandError(error);
      }
    });

  autoFix
    .command("approve <loopId>")
    .description("Approve the patch waiting for review (a live release needs a second, different approver)")
    .option("--json", "Output raw JSON")
    .action(async (loopId: string, opts, cmd)=>{
      try {
        const ctx = await context(cmd);
        const r = await withSpinner("Approving patch...", ()=>call(ctx, "POST", `${AUTO_FIX}/${loopId}/human`));
        print(r, ()=>{
          // eslint-disable-next-line no-console
          console.log(r?.awaitingSecondApproval
            ? `Approval recorded (${r.approvals}). This release is live, so a second, different person must also approve.`
            : `Approved. Loop status: ${r?.loopStatus ?? "unknown"}.`);
        }, opts.json);
      } catch(error){
        handleCommandError(error);
      }
    });

  for(const [verb, description] of [
    ["pause", "Pause a running loop after its current step"],
    ["resume", "Resume a paused loop"],
    ["cancel", "Cancel a loop"],
  ] as const){
    autoFix
      .command(`${verb} <loopId>`)
      .description(description)
      .action(async (loopId: string, _opts, cmd)=>{
        try {
          const ctx = await context(cmd);
          await withSpinner(`${verb}…`, ()=>call(ctx, "POST", `${AUTO_FIX}/${loopId}/${verb}`));
          // eslint-disable-next-line no-console
          console.log(`Loop ${loopId}: ${verb} requested.`);
        } catch(error){
          handleCommandError(error);
        }
      });
  }
}
