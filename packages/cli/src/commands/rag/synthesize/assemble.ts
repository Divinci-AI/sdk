// Master-book synthesis — final assembly.
//
// Stitch the synthesized chapters into one Markdown document with a title page
// and a table of contents. Pure + testable.

export interface SynthesizedChapter {
  number: number,
  title: string,
  /** The finished chapter prose (Markdown). */
  body: string,
}

export interface AssembleOptions {
  title: string,
  subtitle?: string,
  author?: string,
  chapters: ReadonlyArray<SynthesizedChapter>,
  /** Optional note appended to the title page (e.g. provenance / generation date). */
  colophon?: string,
}

function slugAnchor(title: string): string{
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Assemble the master volume into a single Markdown string. */
export function assembleMasterBook(opts: AssembleOptions): string{
  const parts: string[] = [];

  parts.push(`# ${opts.title}`);
  if(opts.subtitle) parts.push(`### ${opts.subtitle}`);
  if(opts.author) parts.push(`*${opts.author}*`);
  if(opts.colophon) parts.push(`\n> ${opts.colophon}`);

  // Table of contents
  parts.push("\n## Contents\n");
  parts.push(
    opts.chapters
      .map((c)=>`${c.number}. [${c.title}](#${slugAnchor(c.title)})`)
      .join("\n"),
  );

  // Chapters
  for(const c of opts.chapters){
    parts.push(`\n\n---\n\n## ${c.number}. ${c.title}\n`);
    parts.push(c.body.trim());
  }

  return parts.join("\n") + "\n";
}
