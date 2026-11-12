#!/usr/bin/env node
/**
 * Post-build: write robots.txt, and add the pages Astro's sitemap cannot see.
 *
 * Two gaps this closes.
 *
 * 1. There was no robots.txt at all — /robots.txt served the 404 page. And it
 *    has to be generated rather than committed to public/, because the correct
 *    contents differ per environment: staging is a *.workers.dev host serving a
 *    complete copy of the docs, which must NOT be indexed. A committed
 *    robots.txt would hardcode one origin and advertise the production sitemap
 *    from staging — the same class of bug astro.config.mjs's resolveSiteUrl()
 *    exists to prevent.
 *
 * 2. /pipeline lives in public/, so @astrojs/sitemap never sees it: that
 *    integration enumerates Astro pages, and public/ is copied verbatim. The
 *    page is indexable, so without this it is live but undiscoverable.
 *    Injecting into the built XML avoids adding @astrojs/sitemap as a direct
 *    dependency, which in this monorepo means a lockfile change.
 *
 * Idempotent: safe to run against an already-patched dist.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SITE = (process.env.PUBLIC_SITE_URL || "https://sdk.divinci.ai").replace(/\/$/, "");
const IS_PROD = SITE === "https://sdk.divinci.ai";

/** Pages served from public/, which the sitemap integration cannot enumerate. */
const PUBLIC_PAGES = ["/pipeline/"];

// ── robots.txt ────────────────────────────────────────────────────────────
const robots = IS_PROD
  ? `# ${SITE}\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap-index.xml\n`
  : `# ${SITE}\n` +
    `# Non-production copy of the SDK docs. Every page here duplicates\n` +
    `# sdk.divinci.ai, so it must never be indexed.\n` +
    `User-agent: *\nDisallow: /\n`;
writeFileSync(join(DIST, "robots.txt"), robots);
console.log(`robots.txt: ${IS_PROD ? "Allow + sitemap" : "Disallow (non-production copy)"} for ${SITE}`);

// ── standalone pages: point their canonical/og at THIS origin ─────────────
// The page in public/pipeline/ is a committed static file, so its canonical,
// og:url and og:image are baked with the production origin. On any other
// deploy that would make a staging copy advertise sdk.divinci.ai — the same
// cross-origin leak resolveSiteUrl() guards the sitemap against.
if (!IS_PROD) {
  for (const page of PUBLIC_PAGES) {
    const file = join(DIST, page.replace(/^\/|\/$/g, ""), "index.html");
    if (!existsSync(file)) continue;
    const before = readFileSync(file, "utf8");
    const after = before.replaceAll("https://sdk.divinci.ai", SITE);
    if (after !== before) {
      writeFileSync(file, after);
      console.log(`${page}: canonical/og origin rewritten to ${SITE}`);
    }
  }
}

// ── sitemap extras ────────────────────────────────────────────────────────
const sitemapPath = join(DIST, "sitemap-0.xml");
if (!existsSync(sitemapPath)) {
  console.log("sitemap-0.xml not found — skipping public-page injection");
  process.exit(0);
}

let xml = readFileSync(sitemapPath, "utf8");
const today = new Date().toISOString().slice(0, 10);
let added = 0;
for (const page of PUBLIC_PAGES) {
  const loc = `${SITE}${page}`;
  if (xml.includes(`<loc>${loc}</loc>`)) continue;
  const entry =
    `<url><loc>${loc}</loc><lastmod>${today}</lastmod>` +
    `<changefreq>monthly</changefreq><priority>0.8</priority></url>`;
  xml = xml.replace("</urlset>", `${entry}</urlset>`);
  added++;
}
if (added) writeFileSync(sitemapPath, xml);

const total = (xml.match(/<loc>/g) || []).length;
console.log(`sitemap: ${added} public page(s) added, ${total} urls total`);
