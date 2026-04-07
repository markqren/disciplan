#!/usr/bin/env bash
# Regenerates ROADMAP.md from roadmap/ split files.
# The splits are the source of truth — Claude edits them directly.
# Run after editing any split: bash scripts/build-roadmap.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/ROADMAP.md"
DATE=$(date '+%b %-d, %Y')

# Strip the HTML comment block + top-level # heading from a split file
content() { sed '/^<!--/,/^-->/d' "$1" | grep -v '^# '; }

COUNT=$(grep -c '^| [A-Z][A-Z]*-' "$ROOT/roadmap/COMPLETED.md" 2>/dev/null || echo 0)

{
  echo "# Disciplan — Roadmap & Feedback Tracker"
  echo ""
  echo "**Last updated:** $DATE | [disciplan.netlify.app](https://disciplan.netlify.app) | Stack: index.html + js/*.js modules + Chart.js + Supabase"
  echo ""
  echo "---"
  echo ""
  content "$ROOT/roadmap/RELEASES.md"
  echo ""
  echo "---"
  echo ""
  content "$ROOT/roadmap/ACTIVE.md"
  echo ""
  echo "---"
  echo ""
  echo "<details>"
  echo "<summary><strong>✅ Completed</strong> ($COUNT items)</summary>"
  echo ""
  content "$ROOT/roadmap/COMPLETED.md"
  echo ""
  echo "</details>"
} > "$OUT"

echo "✓ ROADMAP.md regenerated ($(wc -l < "$OUT") lines, $COUNT completed items)"
