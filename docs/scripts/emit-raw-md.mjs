#!/usr/bin/env node
/**
 * Post-build: mirror every docs page as plain Markdown into dist/, plus an
 * llms.txt index — so AI assistants (and the "Copy page" dropdown) can fetch
 * clean page source instead of scraping HTML.
 *
 *   /client/chat        → /client/chat.md
 *   /                   → /index.md
 *   /llms.txt           → index of all pages with absolute .md URLs
 *
 * Runs as part of `pnpm build` (see package.json).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "src", "content", "docs");
const distDir = join(root, "dist");
const SITE = "https://sdk.divinci.ai";

if (!existsSync(distDir)) {
  console.error("dist/ not found — run astro build first.");
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

/** Extract frontmatter fields + body from an .mdx/.md source. */
function parse(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  let title = "";
  let description = "";
  let body = source;
  if (match) {
    body = source.slice(match[0].length);
    const fm = match[1];
    title = (fm.match(/^title:\s*(.+)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    description = (fm.match(/^description:\s*(.+)$/m)?.[1] ?? "")
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  // Strip top-level component import lines — noise for readers/LLMs.
  body = body.replace(/^import\s.+from\s+["'].+["'];?\s*$/gm, "").replace(/^\n{2,}/, "\n");
  return { title, description, body };
}

const pages = [];
for (const file of walk(contentDir)) {
  if (!/\.(mdx?|md)$/.test(file)) continue;
  const rel = relative(contentDir, file).replace(/\\/g, "/");
  const slug = rel.replace(/\.(mdx?|md)$/, "").replace(/\/index$/, "") || "index";
  const { title, description, body } = parse(readFileSync(file, "utf8"));

  const md = `# ${title}\n\n> ${description}\n${body}`;
  const outPath = join(distDir, `${slug}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md);
  pages.push({ slug, title, description });
}

// llms.txt — https://llmstxt.org convention.
pages.sort((a, b) => a.slug.localeCompare(b.slug));
const llms = [
  "# Divinci AI SDK Documentation",
  "",
  "> Official SDKs for integrating Divinci AI — client (browser chat), server",
  "> (Node.js platform management), MCP (AI-assistant tools), embed widget, and CLI.",
  "",
  "Connect an AI assistant directly instead of copying pages:",
  "- MCP server (SSE): https://mcp.divinci.app/sse — see /mcp/overview.md",
  "- CLI: `npm install -g @divinci-ai/cli && divinci auth login` — see /cli/overview.md",
  "",
  "## Pages",
  "",
  ...pages.map((p) => `- [${p.title}](${SITE}/${p.slug}.md)${p.description ? `: ${p.description}` : ""}`),
  "",
].join("\n");
writeFileSync(join(distDir, "llms.txt"), llms);

console.log(`emit-raw-md: wrote ${pages.length} .md pages + llms.txt`);
