#!/usr/bin/env node
/**
 * Per-page Open Graph images for the SDK docs.
 *
 * Every docs route (and every changelog entry) gets a 1200×630 card:
 *   navy studio ground + the 3D robot mascot + the page TITLE set in type.
 *
 * Why type is drawn here, not by an image model: unfurlers show these at
 * thumbnail size, and the title is the only thing that tells two pages
 * apart. Image models garble words. Sharp + SVG does not.
 *
 * Why the robot is a photographed 3D plate, not the old 2D SVG mark:
 * the live hero is the three.js LogoRobot. The plates in
 * src/assets/og/robots/ were derived from that hero so Slack/X/LinkedIn
 * show the same character the site does.
 *
 * Run before `astro build`. Output is gitignored (public/og/pages/).
 */
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DOCS = join(ROOT, "src", "content", "docs");
const ROBOTS = join(ROOT, "src", "assets", "og", "robots");
const OUT = join(ROOT, "public", "og", "pages");

const W = 1200;
const H = 630;

const SECTIONS = {
  index: { label: "Documentation", accent: "#a99df5", robot: "look.jpg" },
  "getting-started": { label: "Getting Started", accent: "#818cf8", robot: "wave.jpg" },
  guides: { label: "Guides", accent: "#67e8f9", robot: "point.jpg" },
  client: { label: "Client SDK", accent: "#c4b5fd", robot: "chat.jpg" },
  embed: { label: "Embed", accent: "#f0abfc", robot: "chat.jpg" },
  server: { label: "Server SDK", accent: "#818cf8", robot: "point.jpg" },
  mcp: { label: "MCP", accent: "#34d399", robot: "chat.jpg" },
  cli: { label: "CLI", accent: "#fbbf24", robot: "point.jpg" },
  reference: { label: "Reference", accent: "#94a3b8", robot: "book.jpg" },
  changelog: { label: "Changelog", accent: "#c4b5fd", robot: "book.jpg" },
};

/**
 * Pages served from public/ rather than as Astro content.
 *
 * collectPages() walks src/content/docs for .md/.mdx, so a standalone page
 * copied into public/ is invisible to it and would unfurl as a bare link with
 * no card at all. Listed here so it gets the same 1200×630 treatment as every
 * docs route.
 */
const STANDALONE = [
  {
    slug: "pipeline",
    title: "One document. The whole pipeline.",
    subtitle:
      "Follow a single PDF from upload to a grounded answer — parsed, chunked, " +
      "quizzed, embedded, routed, attacked, guarded, and served.",
    section: "Pipeline",
    // warm gold, echoing the page's own --accent against the navy studio ground
    accent: "#d8b26a",
    // he is holding a document open, which is the whole subject of the page
    robot: "book.jpg",
  },
];

/** Pages whose topic should use the shield plate even inside another section. */
const SHIELD_SLUGS = new Set([
  "server/safety",
  "server/security",
  "server/red-team",
  "server/de-identification",
  "server/spend-guard",
  "server/trustbench",
]);

const PHONE_SLUGS = new Set(["cli/phone", "guides/voice-phone"]);

/** Per-page plate overrides. Home / intro / chat look at the viewer;
 *  intro keeps the wave, chat keeps the bubbles. */
const ROBOT_OVERRIDE = {
  index: "look.jpg",
  "getting-started/introduction": "look-wave.jpg",
  "client/chat": "look-chat.jpg",
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function wrap(text, maxWidth, fontSize, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length * fontSize * 0.52 > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[,.;:]?$/, "")}…`;
  }
  return lines;
}

function sectionOf(slug) {
  if (!slug || slug === "index") return "index";
  const top = slug.split("/")[0];
  return SECTIONS[top] ? top : "index";
}

function robotFileFor(slug) {
  if (ROBOT_OVERRIDE[slug]) return ROBOT_OVERRIDE[slug];
  if (SHIELD_SLUGS.has(slug)) return "shield.jpg";
  if (PHONE_SLUGS.has(slug)) return "phone.jpg";
  return SECTIONS[sectionOf(slug)].robot;
}

function textSvg({ title, subtitle, section, accent, date }) {
  const size = title.length > 70 ? 46 : title.length > 42 ? 54 : 62;
  const lines = wrap(title, 640, size, 3);
  const startY = 200;
  const titleBottom = startY + (lines.length - 1) * size * 1.22;

  const subSize = 24;
  const subLines = subtitle ? wrap(subtitle, 640, subSize, 5) : [];
  const subStart = titleBottom + 40;

  const dateLine = date
    ? `<text x="72" y="${H - 58}" font-family="Helvetica,Arial,sans-serif" font-size="22" fill="#8f86b8">${esc(date)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#16132a" stop-opacity="1"/>
      <stop offset="42%" stop-color="#16132a" stop-opacity="0.95"/>
      <stop offset="56%" stop-color="#16132a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${esc(accent)}"/>
      <stop offset="100%" stop-color="${esc(accent)}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <rect x="72" y="118" width="280" height="3" fill="url(#rule)"/>
  <text x="72" y="100" font-family="Helvetica,Arial,sans-serif" font-size="22"
        font-weight="600" fill="${esc(accent)}" letter-spacing="3">${esc(section.toUpperCase())}</text>
  ${lines
    .map(
      (l, i) =>
        `<text x="72" y="${startY + i * size * 1.22}" font-family="Helvetica,Arial,sans-serif" ` +
        `font-size="${size}" font-weight="700" fill="#ffffff">${esc(l)}</text>`,
    )
    .join("\n  ")}
  ${subLines
    .map(
      (l, i) =>
        `<text x="72" y="${subStart + i * subSize * 1.38}" font-family="Helvetica,Arial,sans-serif" ` +
        `font-size="${subSize}" fill="#c5bddc">${esc(l)}</text>`,
    )
    .join("\n  ")}
  ${dateLine}
  <text x="72" y="${H - 28}" font-family="Helvetica,Arial,sans-serif" font-size="22"
        font-weight="600" fill="${esc(accent)}">sdk.divinci.ai</text>
</svg>`;
}

async function compose({ slug, title, subtitle, section, accent, robot, date }) {
  const platePath = join(ROBOTS, robot);
  if (!existsSync(platePath)) {
    throw new Error(`missing robot plate: ${platePath}`);
  }

  // Plates are ~2:1 with the robot centered. Scale up so we can crop a
  // 1200×630 window that puts the character on the right, then overlay type.
  const SCALE_H = 880;
  const fitted = sharp(platePath).resize({ height: SCALE_H });
  const meta = await fitted.metadata();
  const fittedW = meta.width ?? Math.round((1456 / 704) * SCALE_H);
  const robotX = fittedW / 2;
  // Wave / chat-bubble plates need a bit more of the figure in frame.
  const targetX = robot === "look-wave.jpg" || robot === "look-chat.jpg" ? 760 : 900;
  const extractLeft = Math.max(0, Math.min(fittedW - W, Math.round(robotX - targetX)));
  const extractTop = Math.max(0, Math.round((SCALE_H - H) / 2));
  const scene = await fitted
    .extract({ left: extractLeft, top: extractTop, width: W, height: H })
    .toBuffer();

  const card = await sharp(scene)
    .composite([{ input: Buffer.from(textSvg({ title, subtitle, section, accent, date })) }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const dest = join(OUT, `${slug}.png`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, card);
}

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const block = m[1];
  const title = block.match(/^title:\s*(?:"([^"]+)"|'([^']+)'|(.+))$/m);
  const description = block.match(/^description:\s*(?:"([^"]+)"|'([^']+)'|(.+))$/m);
  return {
    title: (title?.[1] ?? title?.[2] ?? title?.[3] ?? "").trim(),
    description: (description?.[1] ?? description?.[2] ?? description?.[3] ?? "").trim(),
  };
}

async function walkMdx(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walkMdx(p, out);
    else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

async function readChangelogEntries() {
  const src = await readFile(join(ROOT, "src", "data", "changelog.ts"), "utf8");
  const entries = [];
  const re =
    /id:\s*"([^"]+)",\s*\n\s*date:\s*"([^"]+)",\s*\n\s*title:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index);
    const bodyMatch = rest.match(/body:\s*"((?:[^"\\]|\\.)*)"/);
    entries.push({
      id: m[1],
      date: m[2],
      title: m[3].replace(/\\"/g, '"'),
      body: bodyMatch ? bodyMatch[1].replace(/\\"/g, '"') : "",
    });
  }
  return entries;
}

async function collectPages() {
  const pages = [];
  for (const file of await walkMdx(DOCS)) {
    const rel = relative(DOCS, file).replace(/\\/g, "/");
    const slug = rel.replace(/\.(mdx|md)$/, "").replace(/\/index$/, "index");
    const { title, description } = parseFrontmatter(await readFile(file, "utf8"));
    if (!title) {
      console.warn(`gen-og-images: no title in ${rel} — skipping`);
      continue;
    }
    const sectionKey = sectionOf(slug === "index" ? "index" : slug);
    const section = SECTIONS[sectionKey];
    pages.push({
      slug: slug === "index" ? "index" : slug,
      title,
      subtitle: description,
      section: section.label,
      accent: section.accent,
      robot: robotFileFor(slug === "index" ? "index" : slug),
    });
  }

  pages.push(...STANDALONE);

  for (const e of await readChangelogEntries()) {
    pages.push({
      slug: `changelog/${e.id}`,
      title: e.title,
      subtitle: e.body,
      section: "Changelog",
      accent: SECTIONS.changelog.accent,
      robot: "book.jpg",
      date: e.date,
    });
  }

  if (pages.length === 0) {
    console.error("gen-og-images: collected ZERO pages — refusing to continue");
    process.exit(1);
  }
  return pages;
}

const pages = await collectPages();
await mkdir(OUT, { recursive: true });

for (const page of pages) {
  await compose(page);
}

// Site-wide fallback used by check-links / older unfurls that still
// hard-code /og-image.png. Same bytes as the home card.
const home = join(OUT, "index.png");
if (!existsSync(home)) {
  console.error("gen-og-images: home card missing after compose");
  process.exit(1);
}
await writeFile(join(ROOT, "public", "og-image.png"), await readFile(home));

console.log(`gen-og-images: wrote ${pages.length} page card(s) → public/og/pages/`);
