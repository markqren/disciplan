#!/usr/bin/env bash
#
# dbq.sh — run SQL against the linked Supabase project via the Management API.
#
# Auth: a Supabase Personal Access Token (PAT, starts with "sbp_"). It is read
# from .secrets/supabase-pat (gitignored) or the SUPABASE_PAT env var. The token
# is NEVER committed and should never be pasted into shared logs. Create it at
# https://supabase.com/dashboard/account/tokens and save it with:
#
#   mkdir -p .secrets && printf '%s' 'sbp_xxx' > .secrets/supabase-pat
#
# Usage:
#   scripts/dbq.sh "select count(*) from disciplan.transactions"
#   echo "select * from disciplan.profiles" | scripts/dbq.sh
#   scripts/dbq.sh -f path/to/query.sql
#
# Runs as the postgres role (bypasses RLS) — fine for validation and admin
# corrections. Be deliberate with writes.

set -euo pipefail

REF="mjuannepfodstbsxweuc"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PAT="${SUPABASE_PAT:-}"
if [ -z "$PAT" ] && [ -f "$ROOT/.secrets/supabase-pat" ]; then
  PAT="$(tr -d '[:space:]' < "$ROOT/.secrets/supabase-pat")"
fi
if [ -z "$PAT" ]; then
  echo "No Supabase PAT found. Save one to .secrets/supabase-pat or export SUPABASE_PAT." >&2
  echo "Generate at: https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

# Resolve the SQL: -f FILE, first arg, or stdin.
if [ "${1:-}" = "-f" ]; then
  [ -n "${2:-}" ] || { echo "usage: dbq.sh -f FILE" >&2; exit 1; }
  SQL="$(cat "$2")"
elif [ -n "${1:-}" ]; then
  SQL="$1"
else
  SQL="$(cat)"
fi
[ -n "$SQL" ] || { echo "No SQL provided." >&2; exit 1; }

BODY="$(SQL="$SQL" python3 -c 'import json,os;print(json.dumps({"query":os.environ["SQL"]}))')"

RESP="$(curl -s -w $'\n%{http_code}' -X POST \
  "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d "$BODY")"

CODE="${RESP##*$'\n'}"
JSON="${RESP%$'\n'*}"

if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
  echo "HTTP $CODE" >&2
  echo "$JSON" >&2
  exit 1
fi

echo "$JSON" | python3 -m json.tool 2>/dev/null || echo "$JSON"
