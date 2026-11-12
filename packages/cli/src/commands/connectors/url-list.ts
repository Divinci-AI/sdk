/**
 * Parse a local URL list for `connectors web-crawl --urls-file`.
 *
 * One URL per line; blank lines and `#` comments are skipped, duplicates are
 * dropped (first occurrence wins, so order is kept). A JSON array of strings is
 * accepted too. Anything that is not an http(s) URL is an error naming the line,
 * because silently skipping a typo'd URL produces a crawl that looks complete.
 */
export const MAX_URL_LIST = 5000; // the server's WEB_CRAWL_MAX_LIMIT

export function parseUrlList(text: string): string[] {
  const trimmed = text.trim();
  let entries: Array<{ value: string; where: string }>;
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("URL list looks like JSON but does not parse");
    }
    if (!Array.isArray(parsed)) throw new Error("A JSON URL list must be an array of strings");
    entries = parsed.map((v, i) => ({ value: String(v).trim(), where: `item ${i + 1}` }));
  } else {
    entries = text
      .split(/\r?\n/)
      .map((line, i) => ({ value: line.trim(), where: `line ${i + 1}` }))
      .filter((e) => e.value && !e.value.startsWith("#"));
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const { value, where } of entries) {
    let ok = false;
    try {
      const u = new URL(value);
      ok = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`Not an http(s) URL at ${where}: ${value.slice(0, 80)}`);
    if (!seen.has(value)) {
      seen.add(value);
      urls.push(value);
    }
  }
  if (urls.length === 0) throw new Error("The URL list is empty");
  if (urls.length > MAX_URL_LIST) {
    throw new Error(`The URL list has ${urls.length} URLs; at most ${MAX_URL_LIST} are allowed per connector`);
  }
  return urls;
}
