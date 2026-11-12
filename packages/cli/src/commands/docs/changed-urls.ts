/**
 * Map git-changed Starlight content paths to deployed page URLs.
 * Pure helper shared by `divinci docs sync` (report-only).
 */
export function mapDocsChangesToUrls(
  changed: string[],
  baseUrl: string,
): string[] {
  const origin = baseUrl.replace(/\/+$/, "");
  return changed.map((rel) => {
    const slug = rel.replace(/^.*src\/content\/docs\//, "").replace(/\.(md|mdx)$/i, "");
    const path = slug === "index" ? "/" : `/${slug}/`;
    return origin ? `${origin}${path}` : path;
  });
}

/** Always-on message: docs sync does not re-ingest into live vectors. */
export const DOCS_SYNC_INGEST_DISABLED_HINT =
  "divinci docs sync is report-only. For a published Release, re-ingest via " +
  "`divinci connectors web-crawl <site-or-sitemap-url> --vector <id> --swap` " +
  "(add --recurring for the daily keep-in-sync schedule). Direct rag crawl " +
  "into a live vector is rejected by isVectorUsed().";
