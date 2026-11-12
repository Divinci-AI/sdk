import { Command } from "commander";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { output, isJsonMode } from "../../output/formatter.js";
import { handleCommandError } from "../../utils/errors.js";
import {
  buildSitePlan,
  applyPlaceholders,
  type DiscoveredPage,
} from "./generate-plan.js";

const DOC_EXT = /\.(md|mdx)$/i;
// Dev-internal markdown we never publish as docs pages.
const SKIP_TOP = new Set(["CLAUDE.md", "AGENTS.md", "CHANGELOG.md"]);

function findReadme(repoPath: string): string | null {
  for (const name of readdirSync(repoPath)) {
    if (/^readme\.(md|mdx)$/i.test(name)) return name;
  }
  return null;
}

function walkDocs(dir: string, repoPath: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walkDocs(abs, repoPath, acc);
    else if (DOC_EXT.test(entry)) acc.push(relative(repoPath, abs));
  }
}

function discoverPages(repoPath: string): DiscoveredPage[] {
  const pages: DiscoveredPage[] = [];
  const readme = findReadme(repoPath);
  if (readme) pages.push({ relPath: readme, body: readFileSync(join(repoPath, readme), "utf8") });
  // Top-level *.md (e.g. INTEGRATION.md) except dev-internal ones.
  for (const name of readdirSync(repoPath)) {
    if (DOC_EXT.test(name) && !/^readme\./i.test(name) && !SKIP_TOP.has(name)) {
      pages.push({ relPath: name, body: readFileSync(join(repoPath, name), "utf8") });
    }
  }
  // docs/**
  const docPaths: string[] = [];
  walkDocs(join(repoPath, "docs"), repoPath, docPaths);
  for (const rel of docPaths.sort()) {
    pages.push({ relPath: rel, body: readFileSync(join(repoPath, rel), "utf8") });
  }
  return pages;
}

function projectMeta(repoPath: string): { name: string; description: string } {
  const pkg = join(repoPath, "package.json");
  if (existsSync(pkg)) {
    try {
      const j = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; description?: string };
      if (j.name) return { name: j.name.replace(/^@[^/]+\//, ""), description: j.description || "" };
    } catch { /* ignore */ }
  }
  for (const f of ["Cargo.toml", "pyproject.toml"]) {
    const p = join(repoPath, f);
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8");
      const name = t.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      const desc = t.match(/^\s*description\s*=\s*"([^"]+)"/m)?.[1];
      if (name) return { name, description: desc || "" };
    }
  }
  return { name: repoPath.split("/").filter(Boolean).pop() || "Project", description: "" };
}

function gitInfo(repoPath: string): { githubUrl: string; branch: string } {
  let githubUrl = "";
  let branch = "main";
  try {
    githubUrl = execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"], { encoding: "utf8" })
      .trim()
      .replace(/\.git$/, "")
      .replace(/^git@github\.com:/, "https://github.com/");
  } catch { /* no remote */ }
  try {
    branch = execFileSync("git", ["-C", repoPath, "branch", "--show-current"], { encoding: "utf8" }).trim() || "main";
  } catch { /* not a repo */ }
  return { githubUrl, branch };
}

/** Locate the docs-site template: --template-dir, env, or the monorepo path. */
function resolveTemplateDir(explicit?: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit,
    process.env.DIVINCI_DOCS_TEMPLATE_DIR,
    // dist/src/commands/docs/generate.js → up 6 → workspace/sdk/templates/docs-site
    resolve(here, "../../../../../../templates/docs-site"),
    // when the template ships inside the published CLI package (cli/templates/...)
    resolve(here, "../../../../templates/docs-site"),
    resolve(process.cwd(), "workspace/sdk/templates/docs-site"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(join(c, "astro.config.mjs"))) return c;
  }
  throw new Error(
    "Could not find the docs-site template. Pass --template-dir <path> or set DIVINCI_DOCS_TEMPLATE_DIR.",
  );
}

/** Locate the standalone widget bundle (@divinci-ai/embed-chat-ui dist/standalone). */
function resolveStandaloneBundle(explicit?: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const rel = "divinci-embed.js";
  const candidates = [
    explicit,
    process.env.DIVINCI_EMBED_BUNDLE,
    // dist/src/commands/docs → up to cli root → ../embed-chat-ui/dist/standalone
    resolve(here, `../../../../../embed-chat-ui/dist/standalone/${rel}`),
    resolve(process.cwd(), `workspace/sdk/packages/embed-chat-ui/dist/standalone/${rel}`),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "Standalone bundle not found. Build it (cd packages/embed-chat-ui && pnpm build) or pass --bundle <file>.",
  );
}

export function registerDocsGenerateCommand(parent: Command): void {
  parent
    .command("generate <repoPath>")
    .description("Mode B: generate a Starlight docs site (with the assistant) from a local repo's README + docs/")
    .requiredOption("--out <dir>", "Output directory for the generated site")
    .option("--template-dir <dir>", "Path to the docs-site template")
    .option("--title <title>", "Site title (default: project name)")
    .option("--release-id <id>", "Divinci Release id to bind the assistant to (can be set later via env)")
    .option("--api-url <url>", "Divinci API origin", "https://api.divinci.app")
    .option("--web-app-url <url>", "The project's signed-in app (handoff/sign-up target)", "")
    .option("--self-host", "Vendor the standalone widget bundle so the site deploys without the npm package", false)
    .option("--bundle <file>", "Path to the standalone widget bundle (default: resolved from @divinci-ai/embed-chat-ui)")
    .option("--force", "Overwrite the output directory if it exists", false)
    .action((repoPath, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const repo = resolve(repoPath);
        if (!existsSync(repo)) throw new Error(`Repo path not found: ${repo}`);
        const out = resolve(opts.out);
        if (existsSync(out)) {
          if (!opts.force) throw new Error(`Output dir exists: ${out} (use --force to overwrite)`);
          rmSync(out, { recursive: true, force: true });
        }
        const templateDir = resolveTemplateDir(opts.templateDir);

        const meta = projectMeta(repo);
        const { githubUrl, branch } = gitInfo(repo);
        const title = opts.title || meta.name;
        const pages = discoverPages(repo);
        if (pages.length === 0) throw new Error(`No README or docs/ markdown found in ${repo}`);

        const plan = buildSitePlan({
          projectName: title,
          description: meta.description || `${title} documentation`,
          githubUrl,
          siteUrl: "https://example.com",
          workerName: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-docs`,
          assistantTitle: `Ask ${title}`,
          greeting: `Hi! Ask me anything about ${title} — I answer from this documentation.`,
          placeholder: "Ask a question…",
          webAppUrl: opts.webAppUrl || "",
          intro: meta.description || `Documentation for ${title}, with an AI assistant built in.`,
          defaultBranch: branch,
          sourceGlob: "docs/**",
          pages,
        });

        // 1. Copy the template, applying placeholders to every text file.
        copyTemplate(templateDir, out, plan.placeholders);
        // 2. Overwrite the placeholder content/docs with the generated pages.
        rmSync(join(out, "src/content/docs"), { recursive: true, force: true });
        for (const file of plan.contentFiles) {
          const dest = join(out, file.path);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, file.content);
        }

        // --self-host: vendor the standalone widget bundle so the site builds +
        // deploys with NO npm dependency on @divinci-ai/embed-chat-ui (works
        // before the package is published). Verified end-to-end on cloud-kill-switch.
        if (opts.selfHost) {
          const bundle = resolveStandaloneBundle(opts.bundle);
          mkdirSync(join(out, "public"), { recursive: true });
          cpSync(bundle, join(out, "public/divinci-embed.js"));
          // Rewrite the widget shell to load the static bundle (is:inline → Astro
          // won't try to resolve the npm import at build).
          const da = join(out, "src/components/DocsAssistant.astro");
          let s = readFileSync(da, "utf8")
            .replace("<script>", '<script type="module" is:inline>')
            .replace(/from "@divinci-ai\/embed-chat-ui"/, 'from "/divinci-embed.js"');
          writeFileSync(da, s);
          // Drop the now-unused @divinci-ai deps so install doesn't hit npm.
          const pkgPath = join(out, "package.json");
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string> };
          if (pkg.dependencies) {
            delete pkg.dependencies["@divinci-ai/client"];
            delete pkg.dependencies["@divinci-ai/embed-chat-ui"];
          }
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        }

        const summary = {
          repo,
          out,
          title,
          pages: plan.contentFiles.length,
          sidebarGroups: plan.sidebar.length,
          releaseId: opts.releaseId || null,
          nextSteps: [
            `cd ${out} && pnpm install`,
            `PUBLIC_DIVINCI_RELEASE_ID=${opts.releaseId || "<releaseId>"} PUBLIC_DIVINCI_API_URL=${globalOpts.apiUrl || opts.apiUrl} pnpm build`,
            `# bind the assistant: divinci docs add <docsUrl>  (or set the Release id above)`,
            `pnpm deploy   # Cloudflare Workers static assets`,
          ],
        };
        if (isJsonMode()) output(summary);
        else
          output(
            [
              `Generated ${plan.contentFiles.length} page(s) into ${out}`,
              `  title: ${title}`,
              `  sidebar groups: ${plan.sidebar.length}`,
              ``,
              `Next:`,
              ...summary.nextSteps.map((s) => `  ${s}`),
            ].join("\n"),
          );
      } catch (error) {
        handleCommandError(error);
      }
    });
}

const TEXT_FILE = /\.(mjs|js|ts|json|astro|md|mdx|toml|yml|yaml|html|css)$/i;

/** Recursively copy a template dir, substituting placeholders in text files. */
function copyTemplate(src: string, dest: string, placeholders: Record<string, string>): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyTemplate(s, d, placeholders);
    } else if (TEXT_FILE.test(entry)) {
      writeFileSync(d, applyPlaceholders(readFileSync(s, "utf8"), placeholders));
    } else {
      cpSync(s, d);
    }
  }
}
