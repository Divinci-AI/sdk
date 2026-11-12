// Master-book synthesis — orchestrator.
//
// Drives the per-chapter pipeline: for each master-outline chapter, retrieve the
// relevant passages across the whole corpus, synthesize one deduplicated chapter,
// collect the result. Retrieval + generation are INJECTED so this orchestration
// is fully unit-testable without a live API or model. The CLI command supplies
// real implementations (RAG search + a GLM-5.2 call).
//
// Sequential by design: GLM-5.2 / Kimi on Workers AI share capacity and 429-storm
// under parallel load (see the RAG ingestion notes), and each chapter is a large
// long-context call — back-to-back is the safe cadence.

import { type SourcePassage } from "./recency.js";
import { buildChapterSynthesisPrompt } from "./chapter.js";
import { type OutlineChapter } from "./outline.js";
import { type SynthesizedChapter } from "./assemble.js";
import { expandChapterQueries, mergePassages } from "./queries.js";

export type RetrieveFn = (query: string, k: number) => Promise<SourcePassage[]>;
export type GenerateFn = (prompt: { system: string, user: string }) => Promise<string>;

export interface SynthesisDeps {
  retrieve: RetrieveFn,
  generate: GenerateFn,
}

export interface SynthesisOptions {
  passagesPerChapter?: number,
  voiceName?: string,
  maxPassageChars?: number,
  /** Progress callback (one per chapter lifecycle event). */
  onProgress?: (event: SynthesisProgress)=>void,
}

export interface SynthesisProgress {
  chapter: number,
  total: number,
  title: string,
  phase: "retrieving" | "synthesizing" | "done" | "skipped-empty" | "failed",
  retrieved?: number,
  droppedForBudget?: number,
  /** Present on phase "failed" — why the chapter's model call failed. */
  error?: string,
}

const DEFAULT_PASSAGES_PER_CHAPTER = 24;

/**
 * Synthesize every outline chapter into finished prose. Returns the chapters in
 * outline order. A chapter whose retrieval yields nothing is skipped (reported
 * via onProgress) rather than hallucinated.
 */
export async function synthesizeMasterBook(
  outline: ReadonlyArray<OutlineChapter>,
  deps: SynthesisDeps,
  opts: SynthesisOptions = {},
): Promise<SynthesizedChapter[]>{
  const k = opts.passagesPerChapter ?? DEFAULT_PASSAGES_PER_CHAPTER;
  const total = outline.length;
  const result: SynthesizedChapter[] = [];

  for(let idx = 0; idx < outline.length; idx++){
    const ch = outline[idx];
    // Recall: fan out over focused sub-queries (summary + its sub-topics + title)
    // and merge. A single combined query dilutes the embedding below the vector's
    // similarity threshold; each sub-topic surfaces its own above-threshold passages
    // (verified live: title+summary returned 0 where the summary alone hit 1.0).
    const queries = expandChapterQueries(ch);

    opts.onProgress?.({ chapter: idx + 1, total, title: ch.title, phase: "retrieving" });
    let passages: SourcePassage[];
    try {
      const lists = await Promise.all(queries.map((q)=>deps.retrieve(q, k)));
      passages = mergePassages(lists, k);
    } catch (e) {
      // A failed/slow search must not abort the whole run — skip this chapter.
      opts.onProgress?.({
        chapter: idx + 1, total, title: ch.title, phase: "failed",
        error: `retrieval failed: ${(e as Error)?.message ?? "unknown error"}`,
      });
      continue;
    }

    if(!passages || passages.length === 0){
      opts.onProgress?.({ chapter: idx + 1, total, title: ch.title, phase: "skipped-empty", retrieved: 0 });
      continue;
    }

    const prompt = buildChapterSynthesisPrompt({
      chapterTitle: ch.title,
      chapterSummary: ch.summary,
      passages,
      voiceName: opts.voiceName,
      maxPassageChars: opts.maxPassageChars,
    });

    opts.onProgress?.({
      chapter: idx + 1, total, title: ch.title, phase: "synthesizing",
      retrieved: passages.length, droppedForBudget: prompt.droppedForBudget,
    });

    // Resilience: a single chapter's model call can fail (timeout on a large
    // long-context prompt, transient capacity). Don't let it discard every
    // already-synthesized chapter — log, skip, keep going. The assembled book
    // contains whatever succeeded.
    let body: string;
    try {
      body = await deps.generate({ system: prompt.system, user: prompt.user });
    } catch (e) {
      opts.onProgress?.({
        chapter: idx + 1, total, title: ch.title, phase: "failed",
        error: (e as Error)?.message ?? "unknown error",
      });
      continue;
    }
    result.push({ number: result.length + 1, title: ch.title, body: (body ?? "").trim() });

    opts.onProgress?.({ chapter: idx + 1, total, title: ch.title, phase: "done" });
  }

  return result;
}
