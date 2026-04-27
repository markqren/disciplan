#!/usr/bin/env bash
# replay-newsletter.sh — fire a dry-run of the daily-insight edge function
# against one or more historical "fixture" dates. Triggers the per-request
# `?dry_run=1` path, which short-circuits the Postmark send and skips
# strategy-aggregate updates so the replay never touches production state.
#
# Required env:
#   SUPABASE_PROJECT_REF   project reference (e.g. mjuannepfodstbsxweuc)
#   CRON_SECRET            same value the cron job passes via X-Cron-Secret
#   SUPABASE_ANON_KEY      anon JWT — Supabase's gateway requires this for
#                          external invocations even when the function gates
#                          itself with CRON_SECRET (the cron runs from inside
#                          Postgres via pg_net so it bypasses the gateway).
#
# Optional env:
#   FUNCTION_URL  override the default https://<ref>.supabase.co/functions/v1/daily-insight
#
# Output: JSON response per fixture, one per line, including:
#   insight_type, subject, key_stat, write_up, exploration_taken, eligible_count,
#   insight_log_id (use this to fetch html_body from insight_log).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 YYYY-MM-DD [YYYY-MM-DD ...]" >&2
  exit 1
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "CRON_SECRET env var is required" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ANON_KEY:-}" ]]; then
  echo "SUPABASE_ANON_KEY env var is required (Supabase gateway rejects external invocations without it)" >&2
  exit 1
fi

URL="${FUNCTION_URL:-https://${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF or FUNCTION_URL is required}.supabase.co/functions/v1/daily-insight}"

for d in "$@"; do
  if [[ ! "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "skip: '$d' is not YYYY-MM-DD" >&2
    continue
  fi
  echo "▸ replay $d ..." >&2
  curl -s -X POST \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "X-Cron-Secret: $CRON_SECRET" \
    -H "Content-Type: application/json" \
    "${URL}?dry_run=1&fixture=${d}" \
    | jq -c '{
        fixture: (.fixture // .today),
        type: .insight_type,
        subject: .subject,
        key_stat: .key_stat,
        eligible: .eligible_count,
        explore: .exploration_taken,
        fallback: .parse_fallback,
        log_id: .insight_log_id
      }' || echo "{\"fixture\":\"$d\",\"error\":\"request_failed\"}"
done
