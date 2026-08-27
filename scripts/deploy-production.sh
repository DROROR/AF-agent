#!/usr/bin/env bash
set -Eeuo pipefail

# AF-agent production deploy script - invoked only via
# scripts/ssh-deploy-entrypoint.sh (which validates the caller and the SHA
# argument before exec'ing this). Modeled on the proven design in
# /opt/dashboard-dyo-app/scripts/deploy-production.sh (flock lock,
# dirty-tree guard, exact-remote-SHA verification, fast-forward-only
# checkout, no `reset --hard`/`clean -fd`, deployed-SHA recording), adapted
# for AF-agent's own stack: two PM2 apps (dyo-api, dyo-web) instead of one
# static build, and - the one thing dashboard's deploy never has to
# consider - real database migrations, which changes what "safe rollback"
# means (see the ROLLBACK section near the bottom).

readonly APP_DIR='/opt/AF-agent'
readonly EXPECTED_BRANCH='main'
readonly EXPECTED_USER='fahad'
readonly EXPECTED_REMOTE_PATTERN='github\.com[:/]DROROR/AF-agent(\.git)?$'

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: deploy-production.sh <40-character-commit-sha>' >&2
  exit 64
fi
readonly EXPECTED_SHA="$1"

# Bounded retry/backoff readiness wait, not a blind fixed sleep - see
# scripts/lib/deploy-health-check.sh (also gives scripts/__tests__ a
# fake-curl/fake-pm2 seam to exercise the real retry loop and rollback
# decision logic without ever touching a real PM2 process).
readonly HEALTH_MAX_WAIT_SECONDS=60
readonly HEALTH_RETRY_INTERVAL_SECONDS=2
# shellcheck source=scripts/lib/deploy-health-check.sh
source "$APP_DIR/scripts/lib/deploy-health-check.sh"
# shellcheck source=scripts/lib/web-release.sh
source "$APP_DIR/scripts/lib/web-release.sh"

# ---- Pre-flight identity/environment checks - fail closed, before anything else ----

if [[ "$(whoami)" != "$EXPECTED_USER" ]]; then
  echo "Refusing to deploy: expected to run as $EXPECTED_USER, got $(whoami)." >&2
  exit 77
fi

cd "$APP_DIR"

REMOTE_URL="$(git remote get-url origin)"
if [[ ! "$REMOTE_URL" =~ $EXPECTED_REMOTE_PATTERN ]]; then
  echo "Refusing to deploy: origin remote ($REMOTE_URL) does not look like DROROR/AF-agent." >&2
  exit 77
fi

if [[ ! -s "$APP_DIR/.env" ]]; then
  echo "Refusing to deploy: $APP_DIR/.env is missing or empty. Production secrets/config must already be on the server - this script never creates or fetches them." >&2
  exit 78
fi

readonly NVM_DIR='/home/fahad/.nvm'
# SSH forced-command sessions do not load the interactive shell profile -
# load the server-managed default Node.js version explicitly, same as
# dashboard's deploy script.
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "NVM is not installed at $NVM_DIR." >&2
  exit 69
fi
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use --silent default >/dev/null
command -v npm >/dev/null

# ---- One deployment at a time ----

exec 9>"$APP_DIR/.deploy.lock"
if ! flock -n 9; then
  echo 'Another AF-agent production deployment is already running.' >&2
  exit 75
fi

# ---- Refuse to deploy if port 4000 is already owned by something PM2
#      isn't managing (2026-08-26 incident: a stray manual process
#      answered health checks while the real PM2-managed dyo-api
#      crash-looped on EADDRINUSE, invisibly, in the background). Never
#      kills the unexpected process - just fails loudly with its pid so a
#      human investigates. A free port, or one already owned by dyo-api's
#      own current PM2 pid (the normal about-to-be-reloaded case), both
#      pass. ----

if ! verify_no_unexpected_port_owner 4000 dyo-api; then
  exit 79
fi

# ---- Never deploy over uncommitted local changes, never discard anything ----
# (No `git reset --hard` and no `git clean -fd` anywhere in this script -
# a dirty tree is a hard stop, not something to be silently discarded.)

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo 'Refusing to deploy: working tree has uncommitted tracked changes.' >&2
  exit 65
fi

readonly PREVIOUS_SHA="$(git rev-parse HEAD)"

# ---- Fetch exactly the branch we deploy from, verify the exact requested commit ----

git fetch --quiet origin "$EXPECTED_BRANCH"
readonly REMOTE_SHA="$(git rev-parse "origin/$EXPECTED_BRANCH")"
if [[ "$REMOTE_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Refusing stale deployment: $EXPECTED_BRANCH is $REMOTE_SHA, requested $EXPECTED_SHA." >&2
  exit 66
fi

git switch --quiet "$EXPECTED_BRANCH"
git merge --quiet --ff-only "$EXPECTED_SHA"

# ---- Install dependencies (workspaces-aware) ----

npm ci --no-audit --no-fund

# ---- Apply committed DB migrations via the project's own established
#      mechanism (packages/database's drizzle migrator, run through the
#      root `npm run db:migrate` script - the exact same code path
#      dyo-api itself runs on boot via runMigrations(), see
#      apps/api/src/index.ts). DATABASE_URL is read from the same .env
#      the running apps already use - parsed the same simple way
#      deploy/pm2/ecosystem.config.cjs's loadEnvFile() does (not a raw
#      `source`, so a stray shell metacharacter in .env can't execute
#      anything). ----

set -a
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  export "$key=$value"
done <"$APP_DIR/.env"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo 'Refusing to deploy: DATABASE_URL is not set in .env.' >&2
  exit 78
fi

MIGRATIONS_BEFORE="$(psql "$DATABASE_URL" -tAc 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo 0)"

npm run db:migrate

MIGRATIONS_AFTER="$(psql "$DATABASE_URL" -tAc 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo 0)"
if [[ "$MIGRATIONS_AFTER" -gt "$MIGRATIONS_BEFORE" ]]; then
  readonly SCHEMA_CHANGED=1
  echo "Schema changed this deployment: $MIGRATIONS_BEFORE -> $MIGRATIONS_AFTER migrations applied."
else
  readonly SCHEMA_CHANGED=0
fi

# ---- Build web in an ISOLATED release, never in this checkout. ----
#
# dyo-api needs no build step (it runs `apps/api/src/index.ts` directly
# via tsx - the checkout above already IS its running code). dyo-web is
# different: `next start` serves a compiled `.next` directory, and this
# checkout is also where a developer might run `npm run build` to
# validate other work - see scripts/lib/web-release.sh's own doc comment
# for the 2026-08-27 incident that caused. create-web-release.sh builds
# entirely in its own isolated `git worktree` + `npm ci`, verifies the
# result (BUILD_ID/static/server present, referenced /login CSS+JS assets
# actually exist on disk), and never touches whatever dyo-web currently
# serves until explicitly switched to below. If this (or the migration
# step above) fails, `set -e` has already aborted the script here -
# nothing is ever reloaded against a broken/half-verified release.

"$APP_DIR/scripts/create-web-release.sh" "$EXPECTED_SHA"

# ---- Reload dyo-api only - never `pm2 restart/reload all`, never touch
#      dashboard-anthropic-proxy, dashboard-task-email-worker, or any
#      other PM2 app. `pm2 save` is deliberately NOT run: it would persist
#      the full current process list (including unrelated apps) into
#      PM2's resurrect file, which is unnecessary for this deploy and out
#      of scope for what this script owns. ----

pm2 startOrReload "$APP_DIR/deploy/pm2/ecosystem.config.cjs" --only dyo-api --update-env

# ---- Atomically switch web to the new, already-verified release and
#      reload ONLY dyo-web. The previous release directory is left
#      untouched on disk (never deleted here) - see the ROLLBACK section
#      below, which switches straight back to it without rebuilding. ----

"$APP_DIR/scripts/switch-web-release.sh" "$EXPECTED_SHA"

# ---- Health checks ----
#
# Bounded retry/backoff, not an immediate one-shot check: dyo-api needs a
# short startup window for tsx boot + migrations + app.listen(), so an
# instant curl right after `pm2 startOrReload` reliably hits connection-
# refused even on a perfectly healthy deploy. Rollback/failure handling below
# only runs once this has genuinely exhausted its full timeout - never on
# the first failed attempt. An HTML 200 from dyo-web is NOT sufficient on
# its own (the exact 2026-08-27 incident) - verify_static_assets_healthy
# additionally confirms every CSS/JS asset the live /login page references
# actually resolves with the right content-type.

if wait_for_healthy "$HEALTH_MAX_WAIT_SECONDS" "$HEALTH_RETRY_INTERVAL_SECONDS" \
  && verify_static_assets_healthy 'http://127.0.0.1:4100' '/login'; then
  printf '%s\n' "$EXPECTED_SHA" >"$APP_DIR/.deployed-sha"
  echo "AF-agent production deployed successfully: $EXPECTED_SHA"
  exit 0
fi

# ---- ROLLBACK ----
#
# dashboard's rollback only ever swaps a static index.html back - trivially
# safe because nothing it deploys ever changes shared state. AF-agent's
# deploy can apply real, forward-only DB migrations, so the same
# "just put the old code back" trick is only safe when THIS deployment
# didn't change the schema. Automatic migration rollback is never
# attempted, per instruction - only application code can be rolled back,
# and only when doing so can't leave the app pointed at a schema it
# predates.

echo 'Health checks failed after deployment.' >&2

readonly ROLLBACK_DECISION="$(describe_rollback_decision "$PREVIOUS_SHA" "$EXPECTED_SHA" "$SCHEMA_CHANGED")"

if [[ "$ROLLBACK_DECISION" == 'SCHEMA_CHANGED_STOP' ]]; then
  cat >&2 <<EOF
STOP: this deployment applied new database migrations before the health
check failed. Automatic rollback is refused - reverting the application
code to $PREVIOUS_SHA while the schema is already at $EXPECTED_SHA's
migrations could run old code against a schema it was never written for.
No automatic database migration rollback was attempted, and none will be.

Current state: code and schema are BOTH at $EXPECTED_SHA. dyo-api/dyo-web
are running the new code but failed their health check.
Manual review is required before taking any further action.
EOF
  exit 70
fi

if [[ "$ROLLBACK_DECISION" == 'SAME_SHA_STOP' ]]; then
  cat >&2 <<EOF
STOP: no prior code revision is available to roll back to. The checkout at
$APP_DIR was already at $EXPECTED_SHA before this deployment ran (this
happens when the same working copy is used both to develop/push the commit
and to deploy it), so PREVIOUS_SHA and EXPECTED_SHA are identical. Reloading
this same commit again would not be a meaningful rollback, so none was
attempted - no destructive git action was taken.

Current state: dyo-api/dyo-web are running $EXPECTED_SHA and failed their
health check. Manual review is required before taking any further action.
EOF
  exit 73
fi

echo "No schema change this deployment - attempting a safe rollback to $PREVIOUS_SHA." >&2

# API: a code-only rollback - detached checkout, not `reset --hard` (the
# working tree was already clean, so this cannot discard anything, and it
# deliberately does not move the local `main` branch ref backward - the
# next deployment attempt still starts from main's real tip and
# fast-forwards from there, same as always).
git checkout --quiet --detach "$PREVIOUS_SHA"
npm ci --no-audit --no-fund
pm2 startOrReload "$APP_DIR/deploy/pm2/ecosystem.config.cjs" --only dyo-api --update-env

# Web: switch straight back to the previous release, which this same
# mechanism guarantees is still on disk from the last successful deploy
# (releases are never deleted here) - never rebuilt on rollback, which is
# exactly what makes this fast and reliable even if the new SHA's build
# environment is itself what's broken.
if [[ -f "$(web_release_complete_marker "$PREVIOUS_SHA")" ]]; then
  "$APP_DIR/scripts/switch-web-release.sh" "$PREVIOUS_SHA"
else
  echo "No previous web release is available on disk for $PREVIOUS_SHA - web could not be rolled back automatically; investigate manually." >&2
fi

if wait_for_healthy "$HEALTH_MAX_WAIT_SECONDS" "$HEALTH_RETRY_INTERVAL_SECONDS" \
  && verify_static_assets_healthy 'http://127.0.0.1:4100' '/login'; then
  echo "Rolled back successfully to $PREVIOUS_SHA. Investigate $EXPECTED_SHA before retrying." >&2
  exit 71
fi

cat >&2 <<EOF
STOP: rollback to $PREVIOUS_SHA ALSO failed its health check. Manual
intervention is required now - do not retry automatically.
EOF
exit 72
