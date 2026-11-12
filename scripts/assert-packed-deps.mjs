// Publish guard: refuse npm-driven pack/publish while the manifest still
// contains pnpm `workspace:*` dependency specs.
//
// pnpm rewrites `workspace:*` to the real version inside the tarball at
// `pnpm pack` / `pnpm publish` time, but plain `npm publish` from the package
// directory does not — it uploads the manifest verbatim, producing a package
// that can never be installed from the registry (this shipped broken
// cli@0.2.6/0.2.7/0.2.9/0.2.15, server@0.1.12, embed-chat-ui@0.1.3).
//
// Wired into `prepublishOnly`, so it runs for `npm pack` / `npm publish` in
// the package dir (npm user agent → enforced) and is skipped when pnpm is
// driving (pnpm user agent → pnpm's own rewrite makes it safe). Publishing a
// pre-packed tarball (`npm publish ./pkg.tgz`) runs no lifecycle scripts and
// needs no guard — the tarball was already rewritten by `pnpm pack`.
import { readFileSync } from "node:fs";

const userAgent = process.env.npm_config_user_agent ?? "";
if (userAgent.startsWith("pnpm")) {
  process.exit(0);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const deps = {
  ...pkg.dependencies,
  ...pkg.optionalDependencies,
  ...pkg.peerDependencies,
};
const unresolved = Object.entries(deps).filter(([, spec]) =>
  String(spec).startsWith("workspace:"),
);

if (unresolved.length > 0) {
  console.error(
    `✗ Refusing to pack/publish ${pkg.name}@${pkg.version} via npm: ` +
      `unresolved workspace deps: ${unresolved.map(([name]) => name).join(", ")}\n` +
      `  Publish from a pnpm-packed tarball instead:\n` +
      `    pnpm pack && npm publish ./<tarball>.tgz --access public`,
  );
  process.exit(1);
}
