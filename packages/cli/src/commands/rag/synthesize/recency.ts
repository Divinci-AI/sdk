// Master-book synthesis — recency resolution.
//
// A "master volume" merges many books written across years. Where two sources
// disagree (an updated supplement stance, a revised protein guideline), the
// synthesized chapter must prefer the MOST RECENT source. These pure helpers
// order retrieved passages newest-first and build the recency instruction the
// synthesis prompt embeds, so the model resolves conflicts deterministically
// rather than averaging stale and current guidance.

/** One retrieved passage from the ingested corpus, tagged with its source + year. */
export interface SourcePassage {
  content: string,
  /** Book / document title the passage came from. */
  source?: string,
  /** Publication year of the source — the recency key. */
  year?: number,
  /** Retrieval similarity score (higher = more relevant). */
  score?: number,
}

/**
 * Order passages newest-first. Passages with a known year sort by descending
 * year; ties (and undated passages) keep their input order (stable), and dated
 * passages always precede undated ones so the model sees the latest guidance up
 * top. Pure — returns a new array.
 */
export function orderByRecency(passages: ReadonlyArray<SourcePassage>): SourcePassage[]{
  return passages
    .map((p, i)=>({ p, i }))
    .sort((a, b)=>{
      const ay = a.p.year, by = b.p.year;
      const aHas = typeof ay === "number", bHas = typeof by === "number";
      if(aHas && bHas && ay !== by) return by - ay; // newer first
      if(aHas !== bHas) return aHas ? -1 : 1;       // dated before undated
      return a.i - b.i;                              // stable
    })
    .map((x)=>x.p);
}

/**
 * Build a compact recency directive listing the distinct sources oldest→newest,
 * with an explicit instruction to prefer the newest on conflict. Returns "" when
 * no passage carries a year (nothing to resolve).
 */
export function recencyDirective(passages: ReadonlyArray<SourcePassage>): string{
  const years = new Map<string, number>();
  for(const p of passages){
    if(typeof p.year === "number"){
      const key = p.source ?? `(${p.year})`;
      // keep the latest year seen for a given source name
      years.set(key, Math.max(years.get(key) ?? p.year, p.year));
    }
  }
  if(years.size === 0) return "";
  const ordered = [...years.entries()].sort((a, b)=>a[1] - b[1]); // oldest first
  const list = ordered.map(([src, yr])=>`- ${src} (${yr})`).join("\n");
  const newest = ordered[ordered.length - 1];
  return (
    "SOURCE RECENCY (oldest → newest):\n" +
    `${list}\n` +
    `When sources conflict, follow the MOST RECENT source (${newest[0]}, ${newest[1]}) and ` +
    "do not present superseded guidance as current. If a change is noteworthy, state the " +
    "current position plainly rather than narrating the history."
  );
}
