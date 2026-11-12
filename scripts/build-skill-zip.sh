#!/usr/bin/env bash
# Package the Divinci agent skill into a downloadable zip served by the docs site.
set -euo pipefail

SDK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$SDK_ROOT/docs/public/divinci-skill.zip"

cd "$SDK_ROOT/skills"
rm -f "$OUT"
zip -r -X "$OUT" divinci -x "*/.DS_Store"
echo "Wrote $OUT"
