#!/usr/bin/env bash
# deprecate-broken.sh — find and deprecate every published @divinci-ai version
# whose manifest still contains pnpm `workspace:*` dependency specs (published
# from a package dir without the pnpm rewrite — such versions can never be
# installed).
#
# Detection is automatic: no hardcoded version lists to fall out of date.
# Each `npm deprecate` prompts for an OTP (the org enforces 2FA auth-and-writes).
#
# Usage (from workspace/sdk):
#   ./scripts/deprecate-broken.sh            # dry-run: list what WOULD be deprecated
#   ./scripts/deprecate-broken.sh --apply    # actually deprecate (OTP prompts)

set -euo pipefail
cd "$(dirname "$0")/.."

APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

PACKAGES=(types server client cli embed-chat-ui mcp trustbench-verifier robot-avatar)

found_any=false
for name in "${PACKAGES[@]}"; do
  pkg="@divinci-ai/$name"
  latest=$(npm view "$pkg" version 2>/dev/null || true)
  [ -n "$latest" ] || { echo "• $pkg: not on registry — skipping"; continue; }

  versions=$(npm view "$pkg" versions --json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).join('\n')")

  broken=()
  for v in $versions; do
    deps=$(npm view "$pkg@$v" dependencies --json 2>/dev/null || echo "{}")
    if echo "$deps" | grep -q '"workspace:'; then
      already=$(npm view "$pkg@$v" deprecated 2>/dev/null || true)
      if [ -n "$already" ]; then
        echo "• $pkg@$v: broken but already deprecated (\"$already\")"
      else
        broken+=("$v")
      fi
    fi
  done

  if [ ${#broken[@]} -eq 0 ]; then
    echo "✓ $pkg: no undeprecated broken versions"
    continue
  fi

  found_any=true
  msg="Broken publish (unresolved workspace:* deps) — install ${pkg}@${latest} or later"
  # Deprecate ONE exact version per call. A compound `a || b || c` range makes
  # `npm deprecate` PUT a range the registry can't resolve → a misleading
  # E404 "is not in this registry" (seen 2026-07-03). Exact versions always
  # resolve; if the org's 2FA needs an OTP, npm prompts per call.
  for v in "${broken[@]}"; do
    if $APPLY; then
      echo "→ deprecating $pkg@$v"
      npm deprecate "$pkg@$v" "$msg" || echo "  ⚠️  failed for $pkg@$v (continuing)"
    else
      echo "WOULD deprecate: npm deprecate '$pkg@$v' \"$msg\""
    fi
  done
done

if ! $APPLY && $found_any; then
  echo ""
  echo "Dry-run only. Re-run with --apply to deprecate (one exact version per"
  echo "call; if 2FA prompts, enter a fresh OTP each time)."
fi
