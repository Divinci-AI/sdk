// `divinci rag synthesize` — master-book synthesis command.
//
// Consolidates an author's collected works (already ingested into a RAG vector)
// into ONE deduplicated, recency-resolved master volume. Pipeline:
//   1. Outline — load a provided outline, or generate a unified one from book summaries.
//   2. Per chapter — RAG-search the corpus, synthesize one merged chapter (GLM-5.2, 262K).
//   3. Assemble — stitch into a single Markdown book.
//
// The synthesis ENGINE (recency / chapter / outline / assemble / run) is pure and
// unit-tested; this command supplies the real retrieve (RAG search) + generate
// (a long-context model call) implementations.

import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { requireConfig, ensureValidToken, requireWorkspaceId, getRouteBase } from "../../../config/config-manager.js";
import { createClient } from "../../../client/create-client.js";
import { colors } from "../../../output/colors.js";
import { handleCommandError } from "../../../utils/errors.js";
import { waitForAssistantReply, getTranscriptMessageCount } from "../../chat/wait-for-reply.js";
import { getTermsGateFromError, acceptTerms } from "../../../utils/terms.js";
import { type SourcePassage } from "./recency.js";
import { buildOutlinePrompt, parseOutline, dedupeOutlineChapters, type BookInput, type OutlineChapter } from "./outline.js";
import { synthesizeMasterBook, type GenerateFn, type RetrieveFn } from "./run.js";
import { assembleMasterBook } from "./assemble.js";

/** GLM-5.2 (262K context) — the long-context default for whole-corpus synthesis. */
const DEFAULT_MODEL_ID = "@cf/zai-org/glm-5.2";
/** Fallback when the primary model exhausts its retries on a chapter — Kimi K2.7-Code
 *  (262K context, separate Workers-AI capacity pool) so a transient GLM-5.2 failure
 *  doesn't drop a chapter. Pass --fallback-model "" to disable. */
const DEFAULT_FALLBACK_MODEL_ID = "@cf/moonshotai/kimi-k2.7-code";

interface RagSearchResult {
  content: string,
  score?: number,
  source?: string,
  metadata?: Record<string, unknown>,
}

/** Pull a publication year out of a result's source string / metadata, if present. */
function extractYear(r: RagSearchResult): number | undefined{
  const fromMeta = r.metadata?.year ?? r.metadata?.publicationYear;
  if(typeof fromMeta === "number" && fromMeta > 1000) return fromMeta;
  const hay = `${r.source ?? ""} ${typeof fromMeta === "string" ? fromMeta : ""}`;
  const m = /\b(19|20)\d{2}\b/.exec(hay);
  return m ? Number(m[0]) : undefined;
}

export function registerRagSynthesizeCommand(parent: Command): void{
  parent
    .command("synthesize")
    .description("Consolidate ingested books into one deduplicated, up-to-date master volume")
    .option("--outline <file>", "Pre-made outline file (one `n. Title — scope` per line). If omitted, --books generates one.")
    .option("--books <file>", "JSON array of { title, year?, outlineOrSummary } used to generate a unified outline")
    .option("--title <title>", "Title for the master volume", "Master Volume")
    .option("--subtitle <subtitle>", "Subtitle for the master volume")
    .option("--voice <name>", "Author voice to preserve (e.g. \"Dr. Joel Fuhrman\")")
    .option("--model <id>", "Model for outline + synthesis", DEFAULT_MODEL_ID)
    .option("--passages-per-chapter <n>", "RAG passages retrieved per chapter", "24")
    .option("--max-chapters <n>", "Cap the number of chapters synthesized (0 = all)", "0")
    .option("--reply-timeout <seconds>", "Max wait for each model reply", "240")
    .option("--retries <n>", "Retry a failed chapter model call this many times (transient capacity/timeouts)", "2")
    .option("--fallback-model <id>", "Model to try when the primary exhausts its retries on a chapter (\"\" to disable)", DEFAULT_FALLBACK_MODEL_ID)
    .option("--via-chat", "Generate via the chat transcript path (ToS-gated, slower, full pipeline) instead of the direct endpoint")
    .option("--accept-terms", "Auto-accept the release's Terms of Service if gated (only with --via-chat)")
    .option("--out <file>", "Write the assembled Markdown book to this file (default: stdout)")
    .action(async (opts, cmd)=>{
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const routeBase = getRouteBase(config);

        const modelId: string = opts.model;
        const perChapter = Math.max(1, parseInt(opts.passagesPerChapter, 10) || 24);
        const maxChapters = Math.max(0, parseInt(opts.maxChapters, 10) || 0);
        const replyTimeoutMs = Math.max(10, parseInt(opts.replyTimeout, 10) || 240) * 1000;
        // The direct /generate endpoint is synchronous and a chapter can take well over
        // the SDK's 30s default; raise the client-wide timeout (the SDK's post() can't set
        // a per-call one). Retrieval uses the same client, so this also covers slow searches.
        const client = createClient(config, { timeoutMs: replyTimeoutMs });
        const httpClient = client.getHttpClient();

        // --- retrieve: RAG search the workspace corpus -----------------------------
        const retrieve: RetrieveFn = async (query, k)=>{
          const data = await httpClient.get<{ results: RagSearchResult[] }>(
            `${routeBase}/rag/search`,
            { q: query, limit: k },
          );
          return (data.results ?? []).map((r): SourcePassage=>({
            content: r.content,
            source: r.source,
            year: extractYear(r),
            score: r.score,
          }));
        };

        // --- generate (default): direct, stateless model call ----------------------
        // POST /white-label/:wl/generate runs the model DIRECTLY — no de-identification,
        // moderation, RAG re-injection, or transcript. That per-message chat pipeline was
        // the chapter-synthesis latency bottleneck (a 20-passage prompt timed out at 540s
        // through it). Owner-gated + billing-exempt v1.
        type Prompt = { system: string, user: string };
        const generateDirectWith = async (model: string, { system, user }: Prompt): Promise<string>=>{
          const r = await httpClient.post<{ text?: string }>(
            `/white-label/${workspaceId}/generate`,
            { assistantName: model, system, user },
          );
          const text = (r?.text ?? "").trim();
          if(!text) throw new Error(`Empty response from direct generate (model ${model}).`);
          return text;
        };

        // --- generate (--via-chat): transcript message path ------------------------
        // The original path: fresh transcript per call, polled reply, ToS-gated. Slower
        // (full chat pipeline) but works for non-owners. Kept for flexibility.
        let termsAccepted = false; // accept at most once per run
        const sendMessage = async (model: string, transcriptId: string, content: string): Promise<void>=>{
          try {
            await httpClient.post(
              `/white-label/${workspaceId}/transcript/${transcriptId}/message`,
              { content, assistantName: model },
            );
          } catch (err) {
            const gate = getTermsGateFromError(err);
            if(gate && opts.acceptTerms && !termsAccepted){
              await acceptTerms(httpClient, gate);
              termsAccepted = true;
              console.error(colors.dim(`Accepted release Terms of Service v${gate.version}.`));
              await httpClient.post(
                `/white-label/${workspaceId}/transcript/${transcriptId}/message`,
                { content, assistantName: model },
              );
              return;
            }
            throw err;
          }
        };
        const generateViaChatWith = async (model: string, { system, user }: Prompt): Promise<string>=>{
          const { _id: transcriptId } = await httpClient.post<{ _id: string }>(
            `/white-label/${workspaceId}/transcript`,
            { title: "Master-book synthesis" },
          );
          const before = await getTranscriptMessageCount(httpClient, workspaceId, transcriptId);
          await sendMessage(model, transcriptId, `${system}\n\n${user}`);
          const reply = await waitForAssistantReply({
            httpClient, workspaceId, transcriptId, messageCountBefore: before, timeoutMs: replyTimeoutMs,
          });
          if(!reply || !reply.content){
            throw new Error(`No model reply within ${replyTimeoutMs / 1000}s (model ${model}).`);
          }
          return reply.content;
        };

        const generateWith = (model: string, prompt: Prompt): Promise<string>=>
          opts.viaChat ? generateViaChatWith(model, prompt) : generateDirectWith(model, prompt);

        // Retry transient model failures (GLM-5.2 / Workers AI share capacity → 429s,
        // 5xx, edge timeouts under back-to-back load). Backoff also spaces calls out,
        // easing the capacity pressure.
        const retries = Math.max(0, parseInt(opts.retries, 10) || 0);
        const retryDelayMs = 4000;
        const attemptModel = async (model: string, prompt: Prompt): Promise<string>=>{
          let lastErr: unknown;
          for(let attempt = 0; attempt <= retries; attempt++){
            try {
              return await generateWith(model, prompt);
            } catch (e) {
              lastErr = e;
              if(attempt < retries){
                const wait = retryDelayMs * (attempt + 1);
                console.error(colors.dim(`  ${model} failed (${(e as Error)?.message || "transient"}); retry ${attempt + 1}/${retries} in ${wait / 1000}s…`));
                await new Promise((r)=>setTimeout(r, wait));
              }
            }
          }
          throw lastErr;
        };

        // Primary model with retries → fallback model with retries → (orchestrator skips).
        // A chapter that exhausts GLM-5.2 (transient capacity) still completes on Kimi.
        const fallbackModelId = (opts.fallbackModel ?? "").trim();
        const generate: GenerateFn = async (prompt)=>{
          try {
            return await attemptModel(modelId, prompt);
          } catch (primaryErr) {
            if(!fallbackModelId || fallbackModelId === modelId) throw primaryErr;
            console.error(colors.yellow(`  ${modelId} exhausted ${retries} retries; falling back to ${fallbackModelId}…`));
            return await attemptModel(fallbackModelId, prompt);
          }
        };

        // --- 1. Outline ------------------------------------------------------------
        let outline: OutlineChapter[];
        if(opts.outline){
          outline = parseOutline(await readFile(opts.outline, "utf8"));
          if(outline.length === 0) throw new Error(`No chapters parsed from outline file: ${opts.outline}`);
          console.error(colors.dim(`Loaded ${outline.length} chapters from ${opts.outline}`));
        }else if(opts.books){
          const books = JSON.parse(await readFile(opts.books, "utf8")) as BookInput[];
          if(!Array.isArray(books) || books.length === 0) throw new Error("--books must be a non-empty JSON array");
          console.error(colors.dim(`Generating unified outline from ${books.length} books via ${modelId}…`));
          const outlineText = await generate({
            system: "You output ONLY the requested outline lines, nothing else.",
            user: buildOutlinePrompt(books, { voiceName: opts.voice }),
          });
          outline = dedupeOutlineChapters(parseOutline(outlineText));
          if(outline.length === 0) throw new Error("Model produced no parseable outline; provide --outline instead.");
          console.error(colors.dim(`Unified outline: ${outline.length} chapters`));
        }else{
          throw new Error("Provide --outline <file> or --books <file> to define the master structure.");
        }

        if(maxChapters > 0 && outline.length > maxChapters){
          console.error(colors.yellow(`Capping to first ${maxChapters} of ${outline.length} chapters (--max-chapters).`));
          outline = outline.slice(0, maxChapters);
        }

        // --- 2. Synthesize chapters ------------------------------------------------
        const chapters = await synthesizeMasterBook(outline, { retrieve, generate }, {
          passagesPerChapter: perChapter,
          voiceName: opts.voice,
          onProgress: (e)=>{
            if(e.phase === "retrieving") console.error(colors.dim(`[${e.chapter}/${e.total}] ${e.title} — retrieving…`));
            else if(e.phase === "synthesizing") console.error(colors.dim(`[${e.chapter}/${e.total}] ${e.title} — synthesizing (${e.retrieved} passages${e.droppedForBudget ? `, ${e.droppedForBudget} dropped for budget` : ""})…`));
            else if(e.phase === "skipped-empty") console.error(colors.yellow(`[${e.chapter}/${e.total}] ${e.title} — no passages found, skipped`));
            else if(e.phase === "failed") console.error(colors.red(`[${e.chapter}/${e.total}] ${e.title} — model call failed (${e.error}); skipped, continuing`));
            else if(e.phase === "done") console.error(colors.green(`[${e.chapter}/${e.total}] ${e.title} — done`));
          },
        });

        if(chapters.length === 0) throw new Error("No chapters synthesized (retrieval returned nothing for every chapter — check the vector has the books ingested).");

        // --- 3. Assemble + output --------------------------------------------------
        const book = assembleMasterBook({
          title: opts.title,
          subtitle: opts.subtitle,
          author: opts.voice,
          chapters,
          colophon: `Synthesized from the ingested corpus with ${modelId} — ${chapters.length} chapters, deduplicated and recency-resolved.`,
        });

        if(opts.out){
          await writeFile(opts.out, book, "utf8");
          console.error(colors.green(`\n✓ Wrote ${chapters.length}-chapter master volume to ${opts.out}`));
        }else{
          process.stdout.write(book);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
