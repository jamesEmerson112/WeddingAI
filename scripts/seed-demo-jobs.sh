#!/usr/bin/env bash
# Seed finished demo scenes so the Memories gallery isn't empty for a demo.
#
# Creates N jobs; the mock poller walks each to `done` in ~25s (one state every
# ~5s), stamping the placeholder scene so the viewer has something to show.
#
#   scripts/seed-demo-jobs.sh                      # seeds the live backend
#   scripts/seed-demo-jobs.sh http://localhost:8080 5
#
# NOTE: this used to be required after EVERY push, because the backend ran
# SQLite on Railway's ephemeral filesystem and each redeploy wiped it. Since the
# move to Postgres (2026-07-20) data survives deploys, so this is only needed
# for a genuinely fresh database.
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

API="${1:-https://weddingai-production.up.railway.app}"
COUNT="${2:-3}"

command -v curl >/dev/null || { echo "error: curl not found" >&2; exit 1; }

health=$(curl -sf --max-time 15 "$API/api/health") || {
  echo "error: $API/api/health is not responding — is the backend up?" >&2
  exit 1
}
echo "health: $health"
case "$health" in
  *'"db":"ok"'*) ;;
  *) echo "error: backend reports an unhealthy database; not seeding." >&2; exit 1 ;;
esac
echo

# The mock upload sink only counts bytes and discards them, so any small
# payload works — the demo scene is a placeholder regardless of what's sent.
payload=$(mktemp)
printf 'weddingai-demo-seed' > "$payload"
trap 'rm -f "$payload"' EXIT

for i in $(seq 1 "$COUNT"); do
  up=$(curl -sf --max-time 20 -X POST "$API/api/uploads")
  url=$(printf '%s' "$up" | sed -n 's/.*"upload_url":"\([^"]*\)".*/\1/p')
  key=$(printf '%s' "$up" | sed -n 's/.*"upload_key":"\([^"]*\)".*/\1/p')
  [ -n "$url" ] && [ -n "$key" ] || { echo "error: unexpected /api/uploads response" >&2; exit 1; }

  curl -sf --max-time 60 -X PUT "$url" --data-binary "@$payload" -o /dev/null
  job=$(curl -sf --max-time 20 -X POST "$API/api/jobs" \
    -H "Content-Type: application/json" \
    -d "{\"upload_key\":\"$key\",\"iters\":7000}")
  echo "seeded job $i: $(printf '%s' "$job" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
done

echo
echo "The mock poller walks each job to 'done' in ~25s. Verify with:"
echo "  curl -s $API/api/jobs | grep -o '\"state\":\"[a-z]*\"' | sort | uniq -c"
echo
echo "(Use that tally form, NOT 'grep -c' — the API returns ONE line of JSON,"
echo " so grep -c can only ever print 0 or 1, never the job count.)"
