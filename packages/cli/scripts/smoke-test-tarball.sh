#!/usr/bin/env bash
# smoke-test-tarball.sh — verify the packed CLI tarball actually runs
# once installed, the way a real npm user would experience it.
#
# Runs from the CLI package root and does the following:
#
#   1. Builds the package (pnpm build)
#   2. Packs it via `npm pack` into a temp dir
#   3. Creates a fresh empty project in another temp dir
#   4. `npm install`s the tarball into that project (pulls dependencies)
#   5. Runs `node_modules/.bin/divinci --version` from the test project
#   6. Runs `node_modules/.bin/divinci --help` and checks it exits 0
#   7. Verifies --version matches package.json
#   8. Extracts and inspects the tarball for required files
#   9. Cleans up all temp dirs
#
# Used as a final pre-publish check to catch packaging regressions that
# `npm publish --dry-run` doesn't surface (e.g., missing files in the
# `files` allowlist, broken shebang, wrong permissions on the bin entry,
# native deps that don't unpack correctly).
#
# Usage:
#   cd workspace/sdk/packages/cli && ./scripts/smoke-test-tarball.sh
#
# Exit codes:
#   0 — tarball runs, --version matches package.json, --help exits 0
#   1 — any step failed; stderr/stdout is preserved for debugging

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PACKAGE_DIR"

# Read expected version from package.json so we can verify the binary
# ends up reporting it. Uses node instead of jq so there's one fewer
# dependency for devs running this locally.
EXPECTED_VERSION="$(node -e "console.log(require('./package.json').version)")"
PACKAGE_NAME="$(node -e "console.log(require('./package.json').name)")"

echo "→ Smoke-testing tarball for $PACKAGE_NAME@$EXPECTED_VERSION"

# Build the package before packing — catches stale dist/
echo "→ Building..."
pnpm run build >/dev/null

# Pack into a dedicated temp dir so we don't leave stray tarballs
# cluttering the working tree.
PACK_DIR="$(mktemp -d -t divinci-cli-pack-XXXXXX)"
trap 'rm -rf "$PACK_DIR"' EXIT

echo "→ Packing into $PACK_DIR"
# Use `pnpm pack` (not `npm pack`) because it rewrites workspace: protocol
# references to concrete versions. npm pack leaves them as "workspace:*"
# which then fails on install with EUNSUPPORTEDPROTOCOL.
#
# Do NOT send this to /dev/null. `pnpm pack` runs the package's `prepack`
# hook, which is where assert-packed-deps and assert-version-honesty live —
# the two checks that refuse a dishonest release and EXPLAIN why. Discarding
# their output means the one thing worth reading is the one thing thrown away:
# from 2026-09-07 to 2026-09-11 the SDK release job failed four times showing
# only "→ Packing into /tmp/..." followed by a bare "exit code 1", while the
# real message ("@divinci-ai/server@0.5.0 is ALREADY PUBLISHED, but this
# checkout exports 7 names the published copy does not") was being written to
# /dev/null on every run.
if ! pnpm pack --pack-destination "$PACK_DIR" > "$PACK_DIR/.pack.log" 2>&1; then
  echo "XX pnpm pack failed. Its output, including any prepack guard:" >&2
  sed 's/^/   /' "$PACK_DIR/.pack.log" >&2
  exit 1
fi
rm -f "$PACK_DIR/.pack.log"

TARBALL="$(ls "$PACK_DIR"/*.tgz 2>/dev/null | head -n 1)"
if [ -z "$TARBALL" ]; then
  echo "XX No tarball produced by pnpm pack" >&2
  exit 1
fi

PACK_SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
echo "→ Tarball: $(basename "$TARBALL") ($PACK_SIZE)"

# Extract into a second temp dir so we can inspect file contents
EXTRACT_DIR="$(mktemp -d -t divinci-cli-extract-XXXXXX)"
# Install the tarball into a third temp dir so we get real node_modules
INSTALL_DIR="$(mktemp -d -t divinci-cli-install-XXXXXX)"
trap 'rm -rf "$PACK_DIR" "$EXTRACT_DIR" "$INSTALL_DIR"' EXIT

tar -xzf "$TARBALL" -C "$EXTRACT_DIR"
EXTRACTED_ROOT="$EXTRACT_DIR/package"

if [ ! -d "$EXTRACTED_ROOT" ]; then
  echo "XX Tarball did not contain a package/ directory" >&2
  exit 1
fi

# Expected files — the minimal set that makes the CLI actually work.
for required in package.json README.md dist/bin/divinci.js dist/src/index.js; do
  if [ ! -f "$EXTRACTED_ROOT/$required" ]; then
    echo "XX Missing required file: $required" >&2
    echo "XX Tarball contents:" >&2
    find "$EXTRACTED_ROOT" -type f | sed "s|$EXTRACTED_ROOT/||" | head -30 >&2
    exit 1
  fi
done
echo "→ Required files present in tarball"

# Guardrail: no tsbuildinfo, no .env, no local dev artifacts
if find "$EXTRACTED_ROOT" -name "*.tsbuildinfo" | grep -q .; then
  echo "XX Tarball contains tsbuildinfo files (should be excluded)" >&2
  find "$EXTRACTED_ROOT" -name "*.tsbuildinfo" >&2
  exit 1
fi
if find "$EXTRACTED_ROOT" -name ".env*" | grep -q .; then
  echo "XX Tarball contains .env files (secret leak risk)" >&2
  find "$EXTRACTED_ROOT" -name ".env*" >&2
  exit 1
fi
echo "→ No build-cache or secret artifacts in tarball"

# Sibling @divinci-ai packages released in the SAME batch are not on the
# registry yet — this script gates the job that publishes them.
#
# Run pre-publish, `cli@0.4.0` pins `server@0.2.1`, and npm answers
# `ETARGET No matching version found` because 0.2.1 is exactly what the next
# step is about to push. The first version of this gate did not account for
# that and blocked a perfectly good release (2026-08-12) — a false positive on
# a blocking check is worse than no check, because it is what teaches people to
# bypass it.
#
# So: anything already ON the registry resolves from the registry (the property
# this test exists to verify), and only versions that do not exist yet are
# supplied from local tarballs. That verifies the artifact SET about to be
# published, self-consistently, instead of demanding the future already exist.
SIBLING_TARBALLS=()
SUPPLIED_LOCALLY=""
DIVINCI_DEPS="$(node -e "
const p = require('$EXTRACTED_ROOT/package.json');
for (const [n, v] of Object.entries(p.dependencies || {})) {
  if (n.startsWith('@divinci-ai/')) console.log(n + '\t' + v);
}
")"

while IFS=$'\t' read -r dep_name dep_version; do
  [ -z "$dep_name" ] && continue
  if npm view "${dep_name}@${dep_version}" version >/dev/null 2>&1; then
    echo "→ ${dep_name}@${dep_version} resolves from the registry"
    continue
  fi

  # Not published (yet). Find the sibling by NAME, not by directory — the
  # directory need not match the package name.
  sibling_dir=""
  for candidate in "$PACKAGE_DIR"/../*/; do
    [ -f "$candidate/package.json" ] || continue
    if [ "$(node -e "try{console.log(require('$candidate/package.json').name)}catch(e){}")" = "$dep_name" ]; then
      sibling_dir="$candidate"
      break
    fi
  done

  if [ -z "$sibling_dir" ]; then
    echo "XX ${dep_name}@${dep_version} is not on the registry and no sibling package provides it" >&2
    echo "XX A published tarball pinning it would be uninstallable." >&2
    exit 1
  fi

  if [ ! -d "$sibling_dir/dist" ]; then
    echo "XX ${dep_name} has no dist/ — build the workspace before packing" >&2
    exit 1
  fi

  echo "→ ${dep_name}@${dep_version} is UNPUBLISHED — packing it from $sibling_dir"
  # Same reasoning as the main pack above: the sibling has prepack guards too,
  # and a silent failure here surfaces as the misleading "Failed to pack
  # sibling" below rather than as the guard's own explanation.
  if ! ( cd "$sibling_dir" && pnpm pack --pack-destination "$PACK_DIR" > "$PACK_DIR/.sibling.log" 2>&1 ); then
    echo "XX pnpm pack failed for sibling $dep_name. Its output:" >&2
    sed 's/^/   /' "$PACK_DIR/.sibling.log" >&2
    exit 1
  fi
  rm -f "$PACK_DIR/.sibling.log"
  sibling_tarball="$(ls -t "$PACK_DIR"/*.tgz 2>/dev/null | head -n 1)"
  if [ -z "$sibling_tarball" ] || [ "$sibling_tarball" = "$TARBALL" ]; then
    echo "XX Failed to pack sibling $dep_name" >&2
    exit 1
  fi
  SIBLING_TARBALLS+=("$sibling_tarball")
  SUPPLIED_LOCALLY="$SUPPLIED_LOCALLY ${dep_name}@${dep_version}"
done <<< "$DIVINCI_DEPS"

# Install the tarball into a fresh project, so dependencies get pulled.
# This is what a real `npm install @divinci-ai/cli` does at a user site.
echo "→ Installing tarball into $INSTALL_DIR (pulls runtime deps)..."
(
  cd "$INSTALL_DIR"
  printf '{"name":"cli-smoke-test","private":true,"version":"0.0.0"}\n' > package.json
  # `"${arr[@]}"` on an EMPTY array is an unbound-variable error under `set -u`
  # in bash 3.2, which is what macOS ships. The `+` form expands to nothing when
  # the array is unset/empty and to the elements otherwise.
  #
  # This bit on 2026-08-13, in the exact mirror of the bug before it: the first
  # version of this block failed when siblings were UNPUBLISHED, and this one
  # failed once they were ALL published and the array went empty. Both were
  # false positives on a blocking gate — worth stating plainly, because a gate
  # that fails for its own reasons is the thing that teaches people to skip it.
  if ! npm install --no-audit --no-fund \
      ${SIBLING_TARBALLS[@]+"${SIBLING_TARBALLS[@]}"} "$TARBALL" 2>&1 | tail -10; then
    echo "XX npm install of the tarball failed" >&2
    exit 1
  fi
)

if [ -n "$SUPPLIED_LOCALLY" ]; then
  # Say it out loud: for these, "installs cleanly" was verified against the
  # about-to-be-published build, not against the registry.
  echo "→ NOTE: supplied from local tarballs (not yet on the registry):$SUPPLIED_LOCALLY"
fi

BIN="$INSTALL_DIR/node_modules/.bin/divinci"
if [ ! -x "$BIN" ]; then
  echo "XX Installed package did not produce the divinci binary at $BIN" >&2
  ls -la "$INSTALL_DIR/node_modules/.bin/" 2>/dev/null >&2
  exit 1
fi

ACTUAL_VERSION="$("$BIN" --version)"
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "XX Version mismatch:" >&2
  echo "   expected: $EXPECTED_VERSION" >&2
  echo "   actual:   $ACTUAL_VERSION" >&2
  exit 1
fi
echo "→ --version reports $ACTUAL_VERSION"

HELP_OUTPUT="$("$BIN" --help)"
HELP_LINES="$(echo "$HELP_OUTPUT" | wc -l | tr -d ' ')"
if [ "$HELP_LINES" -lt 10 ]; then
  echo "XX --help output looks suspiciously short ($HELP_LINES lines)" >&2
  echo "$HELP_OUTPUT" >&2
  exit 1
fi
echo "→ --help exits 0 with $HELP_LINES lines of output"

# Walk EVERY command group and load its module graph.
#
# `--version` and `--help` alone are not enough. cli@0.3.0 died on an eager
# `import { VOICE_TRANSPORTS }` inside ONE command (release/update) — it was
# caught by --help only because the command registry happens to import that
# module at startup. A command whose broken import is reached lazily would sail
# straight through a --help check and break in the user's hands instead.
#
# Running `<group> --help` forces each group's module graph to link, which is
# exactly the failure this whole script exists to prevent.
COMMANDS="$(echo "$HELP_OUTPUT" \
  | awk '/^Commands:/{flag=1; next} flag && /^  [a-z]/{print $1}' \
  | cut -d'|' -f1 \
  | grep -vx 'help' || true)"

if [ -z "$COMMANDS" ]; then
  echo "XX Could not parse any command groups out of --help" >&2
  echo "$HELP_OUTPUT" >&2
  exit 1
fi

COMMAND_COUNT="$(echo "$COMMANDS" | wc -l | tr -d ' ')"
echo "→ Loading module graph for $COMMAND_COUNT command groups..."

FAILED_COMMANDS=""
for cmd in $COMMANDS; do
  if ! CMD_OUT="$("$BIN" "$cmd" --help 2>&1)"; then
    FAILED_COMMANDS="$FAILED_COMMANDS $cmd"
    echo "XX \`divinci $cmd --help\` failed:" >&2
    echo "$CMD_OUT" | tail -15 >&2
  fi
done

if [ -n "$FAILED_COMMANDS" ]; then
  echo "XX Command groups failed to load:$FAILED_COMMANDS" >&2
  echo "XX This is the cli@0.3.0 failure class — a module that does not link." >&2
  exit 1
fi
echo "→ All $COMMAND_COUNT command groups load and respond to --help"

echo ""
echo "OK  $PACKAGE_NAME@$EXPECTED_VERSION packs and runs cleanly when installed."
echo "    Tarball: $(basename "$TARBALL")  ($PACK_SIZE)"
echo "    Verified: $COMMAND_COUNT command groups link at runtime"
