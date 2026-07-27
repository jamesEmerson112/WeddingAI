#!/usr/bin/env bash
# Upload the example 3D reconstruction onto the backend's storage volume.
#
# The scene is a 30 MB LichtFeld Studio export. It USED to be committed at
# frontend/public/demo/scene-3041.html so the demo would "just work", but Vercel
# silently refused to publish a file that size and every deployed viewer got a
# 404. Scenes now live on the backend's volume and are served from /artifacts,
# so they have to be uploaded once per fresh volume — that is what this does.
#
#   scripts/seed-demo-scene.sh                              # seeds the live backend
#   scripts/seed-demo-scene.sh http://localhost:8080        # seeds a local one
#   SCENE_FILE=/path/to/other.html scripts/seed-demo-scene.sh
#
# Requires ADMIN_TOKEN in the environment, matching the backend's own. After
# this succeeds, set DEMO_SCENE_KEY=<the name below> on the backend so finished
# mock jobs point at the scene. The backend repoints already-finished jobs on
# its next boot (see db::relabel_legacy_demo_jobs), so no reseed is needed.
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

API="${1:-https://weddingai-production.up.railway.app}"
NAME="${SCENE_NAME:-scene-3041.html}"

# Where to find the scene, in order of preference. The git blob is the reliable
# one: the file is gitignored and deleted from the working tree, so on a fresh
# clone this is the ONLY copy that exists — recorded here so recovering it is a
# documented step rather than archaeology.
SCENE_BLOB_REV="${SCENE_BLOB_REV:-60ba0c1}"
SCENE_BLOB_PATH="frontend/public/demo/scene-3041.html"

command -v curl >/dev/null || { echo "error: curl not found" >&2; exit 1; }
command -v gzip >/dev/null || { echo "error: gzip not found" >&2; exit 1; }

: "${ADMIN_TOKEN:?set ADMIN_TOKEN to the value configured on the backend}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
scene="$work/$NAME"

if [ -n "${SCENE_FILE:-}" ]; then
  echo "using SCENE_FILE=$SCENE_FILE"
  cp "$SCENE_FILE" "$scene"
elif [ -f "$SCENE_BLOB_PATH" ]; then
  echo "using working-tree copy $SCENE_BLOB_PATH"
  cp "$SCENE_BLOB_PATH" "$scene"
else
  echo "recovering from git blob $SCENE_BLOB_REV:$SCENE_BLOB_PATH"
  git show "$SCENE_BLOB_REV:$SCENE_BLOB_PATH" > "$scene" || {
    echo "error: could not recover the scene from git. Pass SCENE_FILE=... instead." >&2
    exit 1
  }
fi

bytes=$(wc -c < "$scene" | tr -d ' ')
[ "$bytes" -gt 1000000 ] || {
  echo "error: $scene is only $bytes bytes — that is not a real scene export." >&2
  exit 1
}
echo "scene: $bytes bytes"

# Serve compressed as well as plain: this file is ~30 MB raw and ~21 MB gzipped,
# and every browser sends Accept-Encoding: gzip, so the .gz is what almost all
# real traffic actually downloads.
gzip -kf "$scene"
echo "gzipped: $(wc -c < "$scene.gz" | tr -d ' ') bytes"

put() {
  local file="$1" name="$2" code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 600 \
    -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
    --data-binary "@$file" "$API/api/artifacts/$name")
  case "$code" in
    200) echo "  PUT $name -> 200" ;;
    401) echo "error: 401 — ADMIN_TOKEN does not match the backend's." >&2; exit 1 ;;
    404) echo "error: 404 — the backend has no ADMIN_TOKEN set, so ingest is disabled." >&2; exit 1 ;;
    413) echo "error: 413 — scene exceeds the backend's upload limit." >&2; exit 1 ;;
    507) echo "error: 507 — the storage volume is full." >&2; exit 1 ;;
    *)   echo "error: PUT $name returned $code" >&2; exit 1 ;;
  esac
}

# Order matters: PUT the plain file first. Uploading a plain artifact deletes any
# stale .gz sibling (so ServeDir can't serve outdated compressed content), so
# doing it the other way round would throw away the .gz we just uploaded.
echo "uploading to $API ..."
put "$scene" "$NAME"
put "$scene.gz" "$NAME.gz"

echo "verifying ..."
plain=$(curl -s -H 'Accept-Encoding: identity' -o /dev/null -w '%{size_download}' "$API/artifacts/$NAME")
comp=$(curl -s --compressed -o /dev/null -w '%{size_download}' "$API/artifacts/$NAME")
echo "  identity: $plain bytes"
echo "  gzip:     $comp bytes"
[ "$plain" = "$bytes" ] || { echo "error: served size does not match what was uploaded." >&2; exit 1; }
[ "$comp" -lt "$plain" ] || echo "  warning: gzip did not shrink the response — is the .gz in place?"

echo
echo "done. Now set DEMO_SCENE_KEY=$NAME on the backend if it isn't already;"
echo "finished jobs are repointed automatically on the next boot."
