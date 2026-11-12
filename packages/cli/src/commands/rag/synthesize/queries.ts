// Master-book synthesis — retrieval recall expansion.
//
// A single query per chapter under-retrieves: the vector applies a server-side
// similarity threshold (e.g. 0.62), so one phrasing surfaces only the passages
// that clear the bar for THAT phrasing. We can't lower the threshold from the
// client, but we can cast a wider net — derive several focused sub-queries from
// a chapter's title + summary (each sub-topic surfaces its own above-threshold
// passages), retrieve all, then merge + dedupe by relevance. Pure + testable;
// the orchestrator does the actual fan-out retrieval.

import { type SourcePassage } from "./recency.js";

const MIN_QUERY_CHARS = 3;
const DEFAULT_MAX_QUERIES = 5;
// Split a summary into sub-topics on connectives / list separators.
const SPLIT_RE = /[,;/]|\sand\s|\s&\s|\s[—–-]\s/i;

/**
 * Expand a chapter into focused retrieval sub-queries: the full summary, each
 * sub-topic within it, and the title. De-duplicated (case-insensitive), short
 * fragments dropped, capped. Querying on each separately raises recall vs a
 * single combined query that dilutes below the vector's similarity threshold.
 */
export function expandChapterQueries(
  ch: { title: string, summary?: string },
  maxQueries: number = DEFAULT_MAX_QUERIES,
): string[]{
  const raw: string[] = [];
  const push = (s?: string)=>{ const t = (s ?? "").trim(); if(t.length >= MIN_QUERY_CHARS) raw.push(t); };

  if(ch.summary && ch.summary.trim()){
    push(ch.summary);
    for(const part of ch.summary.split(SPLIT_RE)) push(part);
  }
  push(ch.title);

  const seen = new Set<string>();
  const out: string[] = [];
  for(const q of raw){
    const key = q.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out.slice(0, Math.max(1, maxQueries));
}

function dedupeKey(content: string): string{
  return content.trim().slice(0, 200).toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge passage lists from several sub-queries into one relevance-ranked set,
 * de-duplicating passages that appear under multiple queries (keeping the
 * highest score). Optionally caps to the top `limit` by score.
 */
export function mergePassages(lists: ReadonlyArray<ReadonlyArray<SourcePassage>>, limit?: number): SourcePassage[]{
  const byKey = new Map<string, SourcePassage>();
  for(const list of lists){
    for(const p of list ?? []){
      const key = dedupeKey(p.content ?? "");
      if(!key) continue;
      const existing = byKey.get(key);
      if(!existing || (p.score ?? 0) > (existing.score ?? 0)) byKey.set(key, p);
    }
  }
  const merged = [...byKey.values()].sort((a, b)=>(b.score ?? 0) - (a.score ?? 0));
  return typeof limit === "number" && limit > 0 ? merged.slice(0, limit) : merged;
}
