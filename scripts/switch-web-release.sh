#!/usr/bin/env bash
set -Eeuo pipefail

# Atomically points the `current` web-release symlink at an already-built,
# already-verified release for the given SHA, then reloads ONLY dyo-web.
# Never builds anything itself - refuses if the named release has no
# .release-complete marker (see create-web-release.sh). The exact same
# operation serves both a forward deploy and a rollback: rolling back is
# just switching to the previous SHA's still-on-disk release.
#
# Reloads via `pm2 startOrReload <ecosystem-file> --only dyo-web`, NEVER a
# bare `pm2 reload dyo-web` - deliberately, for the first-ever cutover: PM2
# only re-reads `cwd`/`script` from the ecosystem file when the file itself
# is the reload target. Before the very first switch, PM2 has dyo-web
# registered with its OLD literal cwd (the canonical checkout's own
# apps/web) from whatever last started it - a bare `pm2 reload dyo-web`
# would reload that STALE definition and never pick up the new
# release-symlink-based cwd/script at all. Passing the ecosystem file every
# time re-syncs PM2's registration on every switch, not just the first.
#
# Usage: switch-web-release.sh <40-character-commit-sha>

readonly APP_DIR="${DYO_CANONICAL_REPO:-/opt/AF-agent}"
readonly ECOSYSTEM_FILE="$APP_DIR/deploy/pm2/ecosystem.config.cjs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
# shellcheck source=scripts/lib/web-release.sh
source "$SCRIPT_DIR/lib/web-release.sh"

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: switch-web-release.sh <40-character-commit-sha>' >&2
  exit 64
fi
readonly SHA="$1"

readonly RELEASE_DIR="$(web_release_dir "$SHA")"
readonly COMPLETE_MARKER="$(web_release_complete_marker "$SHA")"
readonly CURRENT_LINK="$(web_current_symlink)"

if [[ ! -f "$COMPLETE_MARKER" ]]; then
  echo "Refusing to switch: release $SHA at $RELEASE_DIR has no .release-complete marker - it was never fully built and verified. Run create-web-release.sh first." >&2
  exit 74
fi

# Atomic replace: create the new symlink under a temp name in the SAME
# directory, then `mv -T` it over the real name - a same-filesystem
# rename, so `current` is never observably half-updated. dyo-web is only
# ever reloaded AFTER this succeeds.
readonly TMP_LINK="${CURRENT_LINK}.tmp.$$"
ln -sfn "$RELEASE_DIR" "$TMP_LINK"
mv -T "$TMP_LINK" "$CURRENT_LINK"

echo "Switched current web release to $SHA ($RELEASE_DIR)"

pm2 startOrReload "$ECOSYSTEM_FILE" --only dyo-web --update-env
echo "dyo-web reloaded against release $SHA"
