// Master-book synthesis — per-chapter prompt construction.
//
// The heart of "one giant book that doesn't repeat itself, using the latest
// info": given all passages across every book that pertain to one master-outline
// chapter, build the prompt that makes a long-context model (GLM-5.2, 262K) write
// ONE cohesive chapter — deduplicated, recency-resolved, in the author's voice.
//
// Pure + dependency-free so the prompt is unit-testable. A token-budget guard
// trims the lowest-relevance passages so a heavy chapter still fits the window.

import { type SourcePassage, orderByRecency, recencyDirective } from "./recency.js";

export interface ChapterSynthesisInput {
  chapterTitle: string,
  /** Optional one-line description of what this chapter should cover. */
  chapterSummary?: string,
  /** All passages retrieved across the corpus for this chapter. */
  passages: ReadonlyArray<SourcePassage>,
  /** Author whose voice to preserve, e.g. "Dr. Joel Fuhrman". */
  voiceName?: string,
  /** Max total characters of passage text to include (budget guard). Default 480k
   *  (~120k tokens) — well under GLM-5.2's 262k window, leaving room for output. */
  maxPassageChars?: number,
}

export interface ChapterSynthesisPrompt {
  system: string,
  user: string,
  /** Passages actually included after the budget trim, newest-first. */
  usedPassages: SourcePassage[],
  /** How many passages were dropped by the budget guard (0 = none). */
  droppedForBudget: number,
}

const DEFAULT_MAX_PASSAGE_CHARS = 480_000;

function sourceTag(p: SourcePassage, i: number): string{
  const src = p.source ? p.source : "unknown source";
  const yr = typeof p.year === "number" ? `, ${p.year}` : "";
  return `[Passage ${i + 1} — ${src}${yr}]`;
}

/**
 * Build the system+user prompt for synthesizing one master-volume chapter.
 *
 * Ordering matters: passages are sorted newest-first so the model reads current
 * guidance before older guidance. The budget guard keeps the highest-RELEVANCE
 * passages (by score) when trimming, but the included set is then re-ordered by
 * recency for presentation.
 */
export function buildChapterSynthesisPrompt(input: ChapterSynthesisInput): ChapterSynthesisPrompt{
  const maxChars = input.maxPassageChars ?? DEFAULT_MAX_PASSAGE_CHARS;
  const voice = input.voiceName?.trim();

  // Trim by relevance (keep highest score first), then present newest-first.
  const byRelevance = [...input.passages].sort((a, b)=>(b.score ?? 0) - (a.score ?? 0));
  const kept: SourcePassage[] = [];
  let used = 0;
  let dropped = 0;
  for(const p of byRelevance){
    const len = (p.content ?? "").length;
    if(used + len > maxChars && kept.length > 0){
      dropped++;
      continue;
    }
    kept.push(p);
    used += len;
  }
  const ordered = orderByRecency(kept);

  const system =
    "You are a meticulous book editor compiling a SINGLE master volume from an author's " +
    "collected works. Your job is to merge overlapping source passages into ONE cohesive, " +
    "non-repetitive chapter that reads as original prose — not a summary, not a list of " +
    "excerpts, and never a 'according to passage 3' narration." +
    (voice ? ` Write in the established voice of ${voice}.` : "") +
    "\n\nRULES:\n" +
    "1. DEDUPLICATE ruthlessly: if several passages make the same point, state it ONCE, well.\n" +
    "2. PREFER THE LATEST: when sources differ, follow the most recent (see recency note); " +
    "never present superseded guidance as current.\n" +
    "3. COVER the chapter's scope completely using only what the passages support — do not " +
    "invent facts, studies, or numbers that aren't in the passages.\n" +
    "4. PRODUCE finished chapter prose with a short intro and natural section flow. No inline " +
    "citations or passage references (this is a book, not a paper).\n" +
    "5. Output ONLY the chapter body in Markdown (no preamble, no 'Here is the chapter').";

  const recency = recencyDirective(ordered);
  const passagesBlock = ordered
    .map((p, i)=>`${sourceTag(p, i)}\n${(p.content ?? "").trim()}`)
    .join("\n\n");

  const user =
    `# Chapter to write: ${input.chapterTitle}\n` +
    (input.chapterSummary ? `\nScope: ${input.chapterSummary}\n` : "") +
    (recency ? `\n${recency}\n` : "") +
    `\n---\nSOURCE PASSAGES (newest first; merge these into the chapter):\n\n${passagesBlock}\n---\n` +
    `\nWrite the complete, deduplicated "${input.chapterTitle}" chapter now.`;

  return { system, user, usedPassages: ordered, droppedForBudget: dropped };
}
