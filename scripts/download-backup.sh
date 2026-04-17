#!/bin/bash
# Downloads the latest successful weekly backup artifact from GitHub Actions
# to data/backups/disciplan_backup_YYYYMMDD/
# Run manually or via monthly cron job.

set -e

REPO="markqren/disciplan"
WORKFLOW="weekly-backup.yml"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/backups"
DATE=$(date +%Y%m%d)
DEST="${OUT_DIR}/disciplan_backup_${DATE}"

notify() {
  osascript -e "display notification \"$1\" with title \"Disciplan Backup\""
}

echo "Fetching latest successful backup run..."
RUN_ID=$(/usr/local/bin/gh run list --repo "$REPO" --workflow "$WORKFLOW" --status success --limit 1 --json databaseId --jq '.[0].databaseId')

if [ -z "$RUN_ID" ]; then
  notify "Failed — no successful backup run found on GitHub."
  echo "Error: no successful backup run found." >&2
  exit 1
fi

mkdir -p "$DEST"
echo "Downloading artifact from run $RUN_ID..."
/usr/local/bin/gh run download "$RUN_ID" --repo "$REPO" --dir "$DEST" --pattern "*"

echo "Saved to: $DEST"
ls -lh "$DEST"/

notify "Downloaded successfully to data/backups/disciplan_backup_${DATE}"
