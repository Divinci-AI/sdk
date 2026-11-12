// Master-book synthesis — unified outline.
//
// Before merging chapters we need ONE non-redundant table of contents spanning
// every book. These helpers build the outline-generation prompt, parse the
// model's outline back into structured chapters, and dedupe near-identical
// chapter titles (two books both have an "Introduction to Nutritarian Eating").
// Pure + testable; the model call itself lives in the orchestrator.

export interface BookInput {
  title: string,
  year?: number,
  /** The book's own table of contents or a short summary of what it covers. */
  outlineOrSummary: string,
}

export interface OutlineChapter {
  number: number,
  title: string,
  /** One-line scope used as the retrieval query + chapter prompt scope. */
  summary?: string,
}

/**
 * Build the prompt that asks a model to unify N books' outlines into one
 * non-redundant master table of contents. Emits a strict, parseable format.
 */
export function buildOutlinePrompt(books: ReadonlyArray<BookInput>, opts?: { voiceName?: string }): string{
  const voice = opts?.voiceName?.trim();
  const bookBlocks = books
    .map((b, i)=>`### Book ${i + 1}: ${b.title}${typeof b.year === "number" ? ` (${b.year})` : ""}\n${b.outlineOrSummary.trim()}`)
    .join("\n\n");
  return (
    "You are designing the table of contents for a SINGLE master volume that consolidates " +
    `the author's${voice ? ` (${voice})` : ""} collected books below into one comprehensive book ` +
    "that does NOT repeat itself.\n\n" +
    "Produce a unified, logically ordered chapter list where each topic appears EXACTLY ONCE. " +
    "Merge overlapping chapters across books into a single chapter. Prefer the structure that " +
    "best teaches the material to a new reader.\n\n" +
    "OUTPUT FORMAT — one chapter per line, nothing else:\n" +
    "`<n>. <Chapter Title> — <one-line scope>`\n" +
    "Example:\n" +
    "1. Why Most Diets Fail — the science of hunger, cravings, and nutrient density\n\n" +
    "SOURCE BOOKS:\n\n" +
    bookBlocks
  );
}

const LINE_RE = /^\s*(\d+)[.)]\s*(.+?)\s*(?:[—–-]\s*(.+))?\s*$/;

/**
 * Parse a model-produced outline into structured chapters. Tolerant of `1.`/`1)`
 * numbering and `—`/`–`/`-` scope separators; ignores blank lines and any prose
 * the model wraps around the list. Renumbers sequentially from 1.
 */
export function parseOutline(modelText: string): OutlineChapter[]{
  const out: OutlineChapter[] = [];
  for(const rawLine of (modelText ?? "").split(/\r?\n/)){
    const m = LINE_RE.exec(rawLine);
    if(!m) continue;
    const title = m[2]?.trim();
    if(!title) continue;
    out.push({ number: out.length + 1, title, summary: m[3]?.trim() || undefined });
  }
  return out;
}

function normalizeTitle(t: string): string{
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Drop near-duplicate chapters (same normalized title). Keeps the first
 * occurrence and renumbers. Pure.
 */
export function dedupeOutlineChapters(chapters: ReadonlyArray<OutlineChapter>): OutlineChapter[]{
  const seen = new Set<string>();
  const out: OutlineChapter[] = [];
  for(const c of chapters){
    const key = normalizeTitle(c.title);
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, number: out.length + 1 });
  }
  return out;
}
