#!/usr/bin/env node
/**
 * Internal link checker for the built docs site.
 *
 * Cross-checks every internal link in src/content/docs against the routes
 * actually emitted into dist/ (pages + redirects). Run after `astro build`:
 *
 *   pnpm build && node scripts/check-links.mjs
 *
 * Exits non-zero on any broken internal link, so it can gate a deploy.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const contentDir = join(root, "src", "content", "docs");

if (!existsSync(distDir)) {
  console.error("dist/ not found — run `pnpm build` first.");
  process.exit(2);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1. Collect emitted routes (every dist/**/index.html is a route).
const routes = new Set(["/"]);
for (const file of walk(distDir)) {
  if (file.endsWith("/index.html")) {
    const route = "/" + relative(distDir, dirname(file)).replaceAll("\\", "/");
    routes.add(route === "/." ? "/" : route);
  }
}

// 2. Collect internal links from source content.
const linkRe = /(?:\]\(|href=")(\/[^)"\s]*)/g;
const broken = [];
for (const file of walk(contentDir)) {
  if (!/\.(mdx?|md)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(linkRe)) {
    const raw = match[1];
    const link = raw.split("#")[0].replace(/\/+$/, "") || "/";
    if (link.startsWith("/_") || link.startsWith("/api")) continue;
    if (routes.has(link)) continue;
    // Static assets (e.g. /divinci-skill.zip from public/) are valid link
    // targets but never appear as routes — accept any file present in dist.
    if (existsSync(join(distDir, link.slice(1)))) continue;
    broken.push({ file: relative(root, file), link: raw });
  }
}

// 3. Check head-referenced assets + raw-markdown artifacts exist in dist.
const assetChecks = [
  "/favicon.png",
  "/og-image.png",
  "/og/pages/index.png",
  "/og/pages/server/red-team.png",
  "/og/pages/client/chat.png",
  "/_headers",
  "/llms.txt",
  "/index.md",
  "/client/chat.md",
];
const missingAssets = assetChecks.filter(
  (asset) => !existsSync(join(distDir, asset.slice(1)))
);

console.log(`routes emitted: ${routes.size}`);
if (broken.length === 0 && missingAssets.length === 0) {
  console.log("✓ no broken internal links, all expected assets present");
  process.exit(0);
}
for (const { file, link } of broken) console.error(`✗ broken link ${link} in ${file}`);
for (const asset of missingAssets) console.error(`✗ missing dist asset ${asset}`);
process.exit(1);
