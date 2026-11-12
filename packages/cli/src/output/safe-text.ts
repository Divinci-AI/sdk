/**
 * Strip terminal control bytes from text we did not author.
 *
 * Almost everything this CLI prints originates server-side, and a good deal of
 * THAT originates outside Divinci entirely: a RAG document's `title` is the
 * <title> of a crawled web page, so `divinci rag files` renders text supplied
 * by whatever site was ingested. Writing it to a terminal unescaped lets that
 * site drive the terminal.
 *
 * The interesting sequences are not colours. ESC[2J clears the screen and
 * ESC[1;1H homes the cursor, so a crafted title can erase and rewrite what was
 * printed above it — including the numbers a human is about to act on. A bare
 * newline is milder but still corrupts every table it lands in.
 *
 * Applied to DATA only, never to the assembled line: our own colour helpers
 * emit ESC deliberately, so this must run before colouring, not after.
 *
 * Not a general sanitiser. It removes C0, DEL and C1 and nothing else — all
 * printable Unicode survives, because mangling a legitimate title to defend a
 * terminal trades a real cost for an imagined one.
 */
export function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

/**
 * stripControlChars plus a length cap, for single-line labels.
 *
 * The cap is layout, not safety: a 10,000-character title pushes everything
 * after it off screen, which hides information just as effectively as
 * overwriting it.
 */
export function safeLabel(value: unknown, maxLength = 120): string {
  const s = stripControlChars(String(value ?? ""));
  return s.length > maxLength ? s.slice(0, maxLength - 1) + "\u2026" : s;
}
