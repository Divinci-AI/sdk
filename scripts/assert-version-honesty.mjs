// Publish guard: refuse to pack a package whose workspace dependencies claim a
// version number that is already published with DIFFERENT content.
//
// Why this exists (the cli@0.3.0 incident, 2026-08-11):
//
//   `pnpm pack` rewrites `workspace:*` to the depended-on package's LOCAL
//   version number. That is only safe if the version number is honest — i.e.
//   if "0.1.10" on the registry is the same code as "0.1.10" in this checkout.
//   Nothing enforced that. @divinci-ai/types sat at 0.1.10 from 2026-03-28
//   while 48 commits grew it from 196 to 210 exports, so `cli@0.3.0` shipped
//   pinned to a published types@0.1.10 that lacked VOICE_TRANSPORTS. Every
//   command died at module load.
//
//   assert-packed-deps.mjs could not catch it: no `workspace:` spec survived,
//   which is all that guard checks. A registry-EXISTENCE check would not have
//   caught it either — 0.1.10 exists. The violated invariant is version
//   honesty, so that is what this checks.
//
// What it compares: the EXPORTED SURFACE of the local build vs the published
// tarball, not bytes. Byte comparison would false-positive on any build
// nondeterminism, and a blocking guard that cries wolf gets bypassed — which
// is how the smoke test it sits next to came to be documented-but-never-run.
//
// Failure policy: a genuine mismatch FAILS. An unmeasurable check (registry
// unreachable, package never published, no dist) WARNS and passes. A guard
// that blocks every release because it could not measure something is the
// failure mode this repo has removed twice before (the index flock, the
// verification lock).
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const RE_EXPORT = /export\s+(?:declare\s+)?(?:const|let|var|function|class|enum|type|interface|namespace)\s+([A-Za-z0-9_$]+)/g;
const RE_EXPORT_LIST = /export\s*\{([^}]*)\}/g;

/** Collect exported identifier names from every .d.ts under a directory. */
function exportedNames(dir) {
  const names = new Set();
  if (!existsSync(dir)) return names;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".d.ts")) continue;
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(RE_EXPORT)) names.add(m[1]);
      for (const m of src.matchAll(RE_EXPORT_LIST)) {
        for (const part of m[1].split(",")) {
          // `export { X as Y }` — the consumer-visible name is Y.
          const name = part.split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "");
          if (name && /^[A-Za-z0-9_$]+$/.test(name)) names.add(name);
        }
      }
    }
  };
  walk(dir);
  return names;
}

function warn(msg) { console.warn(`⚠️  version-honesty: ${msg}`); }

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const deps = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
const workspaceDeps = Object.entries(deps).filter(([, s]) => String(s).startsWith("workspace:"));

if (workspaceDeps.length === 0) process.exit(0);

// Map dependency name -> sibling package directory, by reading each sibling's
// name rather than guessing from the scope (the directory need not match).
const packagesRoot = path.resolve(process.cwd(), "..");
const siblings = new Map();
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = path.join(packagesRoot, entry.name, "package.json");
  if (!existsSync(manifest)) continue;
  try {
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    if (m.name) siblings.set(m.name, path.join(packagesRoot, entry.name));
  } catch { /* unreadable sibling manifest — not our problem to report */ }
}

const violations = [];

for (const [name] of workspaceDeps) {
  const dir = siblings.get(name);
  if (!dir) { warn(`${name}: no sibling package directory found — skipped`); continue; }

  const local = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const version = local.version;

  let published;
  try {
    published = execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
    }).trim();
  } catch {
    // Not published at this version (or registry unreachable). Either way the
    // pack is safe: pnpm will pin a version that does not yet exist, which the
    // separate resolvability check is responsible for.
    continue;
  }
  if (!published) continue;

  const localDist = path.join(dir, "dist");
  const localNames = exportedNames(localDist);
  if (localNames.size === 0) { warn(`${name}: no local dist/ .d.ts to compare — run the build first`); continue; }

  let tmp;
  try {
    tmp = mkdtempSync(path.join(tmpdir(), "vh-"));
    execFileSync("npm", ["pack", `${name}@${version}`, "--pack-destination", tmp], {
      stdio: "ignore", timeout: 120_000,
    });
    const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) { warn(`${name}@${version}: registry tarball not retrievable — skipped`); continue; }
    execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", tmp], { stdio: "ignore" });

    const publishedNames = exportedNames(path.join(tmp, "package", "dist"));
    if (publishedNames.size === 0) { warn(`${name}@${version}: published tarball has no .d.ts — skipped`); continue; }

    const missing = [...localNames].filter((n) => !publishedNames.has(n)).sort();
    if (missing.length > 0) violations.push({ name, version, missing });
  } catch (e) {
    warn(`${name}@${version}: could not compare against the registry (${e.code ?? e.message}) — skipped`);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (violations.length > 0) {
  console.error(
    `\n✗ Refusing to pack ${pkg.name}@${pkg.version}: a workspace dependency's version number is not honest.\n`
  );
  for (const v of violations) {
    console.error(
      `  ${v.name}@${v.version} is ALREADY PUBLISHED, but this checkout exports ` +
      `${v.missing.length} name(s) the published copy does not:\n` +
      `    ${v.missing.slice(0, 12).join(", ")}${v.missing.length > 12 ? `, … (+${v.missing.length - 12} more)` : ""}\n`
    );
  }
  console.error(
    `  Packing now would pin a version whose published content is missing those\n` +
    `  exports — the classic "dead on arrival at module load" release.\n\n` +
    `  Fix: bump the dependency's version and publish it FIRST, then pack this package.\n`
  );
  process.exit(1);
}

process.exit(0);
