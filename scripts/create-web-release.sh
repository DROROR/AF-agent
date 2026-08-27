#!/usr/bin/env bash
set -Eeuo pipefail

# Builds an isolated, immutable release of apps/web for one exact commit
# SHA. NEVER builds inside the canonical checkout - see
# scripts/lib/web-release.sh's own module doc comment for the incident
# this exists to prevent from recurring. Idempotent: if a release for this
# SHA already completed successfully (`.release-complete` marker present),
# this exits immediately without rebuilding.
#
# Usage: create-web-release.sh <40-character-commit-sha>

readonly CANONICAL_REPO="${DYO_CANONICAL_REPO:-/opt/AF-agent}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
# shellcheck source=scripts/lib/web-release.sh
source "$SCRIPT_DIR/lib/web-release.sh"

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: create-web-release.sh <40-character-commit-sha>' >&2
  exit 64
fi
readonly SHA="$1"

readonly RELEASE_DIR="$(web_release_dir "$SHA")"
readonly COMPLETE_MARKER="$(web_release_complete_marker "$SHA")"

mkdir -p -m 700 "$DYO_WEB_RELEASES_ROOT"

if [[ -f "$COMPLETE_MARKER" ]]; then
  echo "Release $SHA already built and verified at $RELEASE_DIR - reusing it."
  exit 0
fi

# A prior attempt may have left a partial directory (failed build, killed
# mid-way) - remove it before retrying. Never touches anything else under
# DYO_WEB_RELEASES_ROOT, in particular never touches `current` or any
# OTHER release directory - a failed/retried build for one SHA can never
# affect the release currently live or any other previously-built release.
if [[ -e "$RELEASE_DIR" ]]; then
  echo "Removing incomplete previous release attempt at $RELEASE_DIR"
  git -C "$CANONICAL_REPO" worktree remove --force "$RELEASE_DIR" 2>/dev/null || rm -rf "$RELEASE_DIR"
fi

echo "Creating isolated worktree for $SHA at $RELEASE_DIR"
git -C "$CANONICAL_REPO" worktree add --detach "$RELEASE_DIR" "$SHA"

echo "Installing dependencies in the isolated release (a real, separate npm ci - never a symlinked node_modules, which Turbopack's project-root sandboxing rejects)"
(cd "$RELEASE_DIR" && npm ci --no-audit --no-fund)

echo "Building apps/web in the isolated release"
(cd "$RELEASE_DIR/apps/web" && npm run build)

readonly WEB_DIR="$RELEASE_DIR/apps/web"
if ! verify_release_build_artifacts "$WEB_DIR"; then
  exit 74
fi
if ! verify_prerendered_login_assets_on_disk "$WEB_DIR"; then
  exit 74
fi

printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SHA" >"$COMPLETE_MARKER"
echo "Release $SHA built and verified at $RELEASE_DIR"
