#!/usr/bin/env bash
set -Eeuo pipefail

# Atomically points the `current` web-release symlink at an already-built,
# already-verified release for the given SHA, then reloads ONLY dyo-web.
# Never builds anything itself - refuses if the named release has no
# .release-complete marker (see create-web-release.sh). The exact same
# operation serves both a forward deploy and a rollback: rolling back is
# just switching to the previous SHA's still-on-disk release.
#
# Reloads via `pm2 delete dyo-web` (tolerating "not found" the very first
# time) followed by `pm2 start <ecosystem-file> --only dyo-web` - NEVER
# `pm2 reload`/`startOrReload`. Verified empirically (2026-08-27, against
# a real PM2 instance) that neither `reload` nor `restart` - even when
# passed the ecosystem FILE - ever re-reads a CHANGED `cwd`/`script` for an
# app that already exists in PM2's process list; only env vars refresh.
# Since `current` is a symlink whose TARGET changes every switch while its
# own path string never does, a plain `pm2 reload dyo-web` (which this
# script used at first) silently keeps respawning against whatever cwd/
# script PM2 registered the very first time dyo-web was ever started -
# never picking up the release mechanism at all, while still reporting
# healthy because the OLD path happened to still hold a valid build. A
# genuine delete+start is required to make PM2 re-resolve cwd/script from
# the file. dyo-web runs in fork mode with a single instance, so this
# carries no additional downtime beyond what a fork-mode reload already
# has - there is no second instance to keep serving traffic either way.
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

# `|| true`: pm2 delete exits non-zero if dyo-web isn't registered yet
# (the very first cutover) - that's expected, not a failure.
pm2 delete dyo-web 2>/dev/null || true
pm2 start "$ECOSYSTEM_FILE" --only dyo-web
echo "dyo-web (re)started against release $SHA"
