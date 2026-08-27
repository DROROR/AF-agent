# Shared path conventions and build-artifact verification for isolated web
# releases (2026-08-27 incident: a developer/validation `npm run build` run
# directly in the live checkout overwrote the exact .next directory the
# already-running production dyo-web process was serving static assets
# from). Sourced by scripts/create-web-release.sh and
# scripts/switch-web-release.sh - never executed directly.
#
# A release is a full `git worktree` of the monorepo at one exact commit
# SHA, with its OWN `npm ci` (never a symlinked node_modules - Turbopack's
# project-root sandboxing rejects a symlink that resolves outside the
# worktree), built independently of whatever is currently checked out or
# being edited in the canonical repo. dyo-web serves only
# $DYO_WEB_RELEASES_ROOT/current, a symlink to one such release directory -
# never the canonical checkout's own apps/web/.next.

# Overridable for tests/dry-runs - defaults to the real, restrictive,
# fahad-owned production path (created with mode 700, matching the
# convention used for /home/fahad/dyo-asset-storage). Never created by
# anything other than create-web-release.sh's own `mkdir -p -m 700`.
: "${DYO_WEB_RELEASES_ROOT:=/home/fahad/dyo-web-releases}"

web_release_dir() {
  local sha="${1:?sha required}"
  echo "${DYO_WEB_RELEASES_ROOT}/${sha}"
}

web_current_symlink() {
  echo "${DYO_WEB_RELEASES_ROOT}/current"
}

# Written only once a release has been built AND had its artifacts
# verified - its mere presence is what switch-web-release.sh trusts to
# decide a release is safe to switch to, so nothing may create it early.
web_release_complete_marker() {
  local sha
  sha="${1:?sha required}"
  echo "$(web_release_dir "$sha")/.release-complete"
}

# Fails closed if the artifacts a running `next start` actually needs are
# not all present - a build that exits 0 but produced an incomplete .next
# (e.g. killed mid-write, disk full) must never be considered usable.
verify_release_build_artifacts() {
  local web_dir="${1:?web_dir required}"
  local required
  for required in ".next/BUILD_ID" ".next/static" ".next/server"; do
    if [[ ! -e "$web_dir/$required" ]]; then
      echo "Release build verification failed: $web_dir/$required is missing." >&2
      return 1
    fi
  done
  if [[ -z "$(ls -A "$web_dir/.next/static" 2>/dev/null)" ]]; then
    echo "Release build verification failed: $web_dir/.next/static is empty." >&2
    return 1
  fi
  return 0
}

# Filesystem-only check (no live server needed - this runs BEFORE the
# release is ever switched to): reads the prerendered /login HTML Next
# already wrote to disk during build, and confirms every /_next/static/
# CSS/JS asset it references is actually present under .next/static in
# THIS SAME release - never trusts that "the build succeeded" implies "the
# HTML it produced is internally consistent". Requires at least one CSS
# and one JS reference; an asset-free page fails closed.
verify_prerendered_login_assets_on_disk() {
  local web_dir="${1:?web_dir required}"
  local html_path="$web_dir/.next/server/app/login.html"

  if [[ ! -f "$html_path" ]]; then
    echo "Release build verification failed: $html_path does not exist." >&2
    return 1
  fi

  local assets
  # `|| true` guards against `pipefail`+`set -e` aborting here when grep
  # legitimately finds zero matches (its normal "no match" exit status is
  # 1) - that exact case must fall through to the explicit, diagnosed
  # failure below, never abort silently before it can be reported.
  assets="$(grep -oE '/_next/static/[^\"'"'"'<>[:space:]]+\.(css|js)' "$html_path" | sort -u || true)"
  local css_count js_count
  css_count="$(printf '%s\n' "$assets" | grep -c '\.css$' || true)"
  js_count="$(printf '%s\n' "$assets" | grep -c '\.js$' || true)"
  if [[ -z "$assets" || "$css_count" -eq 0 || "$js_count" -eq 0 ]]; then
    echo "Release build verification failed: $html_path references no usable CSS/JS assets." >&2
    return 1
  fi

  local asset relative
  while IFS= read -r asset; do
    [[ -z "$asset" ]] && continue
    relative="${asset#/_next/static/}"
    if [[ ! -f "$web_dir/.next/static/$relative" ]]; then
      echo "Release build verification failed: $html_path references $asset, which does not exist at $web_dir/.next/static/$relative." >&2
      return 1
    fi
  done <<<"$assets"

  return 0
}
