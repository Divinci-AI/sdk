/**
 * Pure core of `divinci docs generate` (Mode B). Turns a project's discovered
 * markdown (README + docs/**) into a Starlight "site plan": the content pages
 * to write, a sidebar tree, and the __DIVINCI_*__ placeholder substitutions for
 * the docs-site template. DOM/FS-free so it's unit-testable; the command does
 * the filesystem discovery + template copy around it.
 */

export interface DiscoveredPage {
  /** Path relative to the repo root, e.g. "README.md" or "docs/cli.md". */
  relPath: string;
  /** Raw file contents. */
  body: string;
}

export interface SitePlanInput {
  projectName: string;
  description: string;
  githubUrl: string;
  siteUrl: string;
  workerName: string;
  assistantTitle: string;
  greeting: string;
  placeholder: string;
  webAppUrl: string;
  intro: string;
  defaultBranch: string;
  sourceGlob: string;
  pages: DiscoveredPage[];
}

export interface PlannedFile {
  /** Path relative to the generated site root. */
  path: string;
  content: string;
}

export interface SidebarItem {
  label: string;
  slug: string;
}
export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export interface SitePlan {
  placeholders: Record<string, string>;
  contentFiles: PlannedFile[];
  sidebar: SidebarGroup[];
}

/**
 * "docs/Foo Bar.md" → "docs/foo-bar"; "README.md" → "index".
 * A nested `<dir>/index.md` maps to `<dir>` (Starlight collapses index files to
 * their directory — a sidebar slug of `<dir>/index` errors as "does not exist").
 */
export function slugForPath(relPath: string): string {
  const noExt = relPath.replace(/\.(md|mdx)$/i, "");
  if (/^readme$/i.test(noExt)) return "index";
  const slug = noExt
    .replace(/^docs\//i, "")
    .split("/")
    .map((seg) =>
      seg
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .join("/");
  // Collapse a trailing `/index` to its directory (Starlight slug semantics).
  return slug.replace(/\/index$/, "") || "index";
}

/** First Markdown H1, else a humanized filename. */
export function titleForPage(body: string, relPath: string): string {
  const h1 = body.match(/^\s{0,3}#\s+(.+?)\s*$/m);
  if (h1 && h1[1].trim()) return h1[1].trim();
  const base = relPath.replace(/\.(md|mdx)$/i, "").split("/").pop() || "Untitled";
  if (/^readme$/i.test(base)) return "Overview";
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Does the body already start with YAML frontmatter? */
function hasFrontmatter(body: string): boolean {
  return /^---\s*\n[\s\S]*?\n---\s*\n/.test(body);
}

/** Ensure a Starlight content page has a `title:` frontmatter. */
export function withFrontmatter(body: string, title: string): string {
  if (hasFrontmatter(body)) return body;
  // Drop a leading H1 that duplicates the title we're about to set as frontmatter
  // (Starlight renders the frontmatter title as the page H1).
  const stripped = body.replace(/^\s{0,3}#\s+.+?\s*\n+/, "");
  const safeTitle = title.replace(/"/g, '\\"');
  return `---\ntitle: "${safeTitle}"\n---\n\n${stripped}`;
}

/**
 * Build the full site plan: content files (with frontmatter), the sidebar (the
 * README becomes the home page and is omitted from the sidebar; docs pages are
 * grouped — by their first sub-directory under docs/, else a flat "Documentation"
 * group), and the template placeholder map.
 */
export function buildSitePlan(input: SitePlanInput): SitePlan {
  const contentFiles: PlannedFile[] = [];
  const grouped = new Map<string, SidebarItem[]>();

  for (const page of input.pages) {
    const slug = slugForPath(page.relPath);
    const title = titleForPage(page.body, page.relPath);
    contentFiles.push({
      path: `src/content/docs/${slug}.md`,
      content: withFrontmatter(page.body, title),
    });
    if (slug === "index") continue; // home page, not a sidebar entry
    // Group label = first path segment of the slug if nested, else "Documentation".
    const parts = slug.split("/");
    const groupLabel =
      parts.length > 1
        ? parts[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Documentation";
    if (!grouped.has(groupLabel)) grouped.set(groupLabel, []);
    grouped.get(groupLabel)!.push({ label: title, slug });
  }

  const sidebar: SidebarGroup[] = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }));

  // Every site needs a home page. If the repo had no README (→ no "index" slug),
  // synthesize a landing from the title + intro + a link list of the doc pages,
  // so `/` serves (200) instead of 404.
  if (!contentFiles.some((f) => f.path === "src/content/docs/index.md")) {
    const links = sidebar
      .flatMap((g) => g.items)
      .map((it) => `- [${it.label}](/${it.slug}/)`)
      .join("\n");
    const safeTitle = input.projectName.replace(/"/g, '\\"');
    contentFiles.unshift({
      path: "src/content/docs/index.md",
      content: `---\ntitle: "${safeTitle}"\n---\n\n${input.intro}\n\n## Documentation\n\n${links}\n`,
    });
  }

  const placeholders: Record<string, string> = {
    __DIVINCI_PKG_NAME__: input.projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") + "-docs",
    __DIVINCI_TITLE__: input.projectName,
    __DIVINCI_DESCRIPTION__: input.description,
    __DIVINCI_SITE_URL__: input.siteUrl,
    __DIVINCI_GITHUB_URL__: input.githubUrl,
    __DIVINCI_SIDEBAR__: JSON.stringify(sidebar, null, 2),
    __DIVINCI_ASSISTANT_TITLE__: input.assistantTitle,
    __DIVINCI_GREETING__: input.greeting,
    __DIVINCI_PLACEHOLDER__: input.placeholder,
    __DIVINCI_WEBAPP_URL__: input.webAppUrl,
    __DIVINCI_INTRO__: input.intro,
    __DIVINCI_WORKER_NAME__: input.workerName,
    __DIVINCI_DEFAULT_BRANCH__: input.defaultBranch,
    __DIVINCI_SOURCE_GLOB__: input.sourceGlob,
  };

  return { placeholders, contentFiles, sidebar };
}

/** Replace every __DIVINCI_*__ token in a template file's text. */
export function applyPlaceholders(text: string, placeholders: Record<string, string>): string {
  return text.replace(/__DIVINCI_[A-Z_]+__/g, (tok) =>
    Object.prototype.hasOwnProperty.call(placeholders, tok) ? placeholders[tok] : tok,
  );
}
