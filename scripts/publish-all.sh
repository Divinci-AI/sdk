#!/usr/bin/env bash
# publish-all.sh — the ONLY supported way to publish @divinci-ai SDK packages.
#
# For each package (dependency order), this script:
#   1. builds + packs via `pnpm pack` (rewrites workspace:* → real versions)
#   2. verifies the TARBALL manifest has no workspace:* (aborts if it does)
#   3. publishes THE TARBALL with `npm publish` (interactive OTP prompt)
#   4. verifies the REGISTRY manifest has no workspace:* (loud failure if not)
#
# Why this exists: plain `npm publish` (and `npm pack` + publish-the-tarball)
# uploads the manifest verbatim — literal `workspace:*` deps that can never be
# installed. This shipped broken cli 0.2.9/0.2.10/0.2.11/0.2.15/0.2.16,
# server 0.1.12/0.1.13, embed-chat-ui 0.1.3/0.1.4, mcp 0.1.1. Only pnpm's
# pack rewrites the protocol.
#
# Usage (from workspace/sdk):
#   ./scripts/publish-all.sh                  # publish every out-of-date package
#   ./scripts/publish-all.sh cli server       # publish a subset
#
# Requires: npm login as a user with publish rights; an authenticator for the
# per-publish OTP prompts (the org enforces 2FA auth-and-writes).

set -euo pipefail
cd "$(dirname "$0")/.."

# Dependency order matters: types → server/client → cli, embed-chat-ui after
# client, mcp after types.
DEFAULT_ORDER=(types server client trustbench-verifier mcp embed-chat-ui cli robot-avatar)
PACKAGES=("${@:-${DEFAULT_ORDER[@]}}")

fail() { echo "✗ $*" >&2; exit 1; }

for name in "${PACKAGES[@]}"; do
  dir="packages/$name"
  [ -f "$dir/package.json" ] || fail "no such package: $name"
  pkg="@divinci-ai/$name"
  local_version=$(node -p "require('./$dir/package.json').version")
  published=$(npm view "$pkg" version 2>/dev/null || echo "none")

  if [ "$published" = "$local_version" ]; then
    echo "• $pkg@$local_version already published — skipping"
    continue
  fi

  echo ""
  echo "── $pkg: $published → $local_version ──────────────────────"
  (
    cd "$dir"
    rm -f ./divinci-ai-*.tgz

    # 1. pack via pnpm (runs build; rewrites workspace:*)
    pnpm pack >/dev/null
    tarball=$(ls divinci-ai-*-"$local_version".tgz 2>/dev/null | head -1)
    [ -n "$tarball" ] || tarball=$(ls divinci-ai-*.tgz | head -1)
    [ -n "$tarball" ] || fail "$pkg: pnpm pack produced no tarball"

    # 2. verify the tarball manifest
    if tar -xzOf "$tarball" package/package.json | grep -q '"workspace:'; then
      fail "$pkg: tarball $tarball still contains workspace:* deps — refusing to publish"
    fi
    echo "  ✓ tarball manifest clean ($tarball)"

    # 3. publish the tarball (npm prompts for OTP)
    npm publish "./$tarball" --access public
    rm -f "./$tarball"
  )

  # 4. verify what the registry actually serves. A 404 must not read as
  # "clean" (that hole once let a failed publish print success) — but
  # brand-new package names can take a couple of minutes to replicate to the
  # public read API even after a successful `+ pkg@version`, so retry with
  # backoff before declaring failure.
  registry_version=""
  for wait_s in 3 10 20 30 60; do
    sleep "$wait_s"
    registry_version=$(npm view "$pkg@$local_version" version 2>/dev/null || true)
    [ "$registry_version" = "$local_version" ] && break
    echo "  … not visible on the read API yet (waited ${wait_s}s), retrying"
  done
  if [ "$registry_version" != "$local_version" ]; then
    fail "$pkg@$local_version is NOT on the registry ~2min after publish (got: '${registry_version:-404}') — check https://www.npmjs.com/package/$pkg before re-running"
  fi
  registry_deps=$(npm view "$pkg@$local_version" dependencies --json 2>/dev/null || echo "{}")
  if echo "$registry_deps" | grep -q "workspace:"; then
    fail "$pkg@$local_version is BROKEN ON THE REGISTRY (workspace:* deps) — deprecate it and re-run"
  fi
  echo "  ✓ registry manifest verified for $pkg@$local_version"
done

echo ""
echo "🎯 PUBLISH-ALL-SUCCESS — every package verified on the registry"
