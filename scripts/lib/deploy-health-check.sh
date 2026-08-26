# Reusable readiness-wait, rollback-decision, and port-ownership helpers for
# scripts/deploy-production.sh. Meant to be `source`d, never executed
# directly. Kept in its own file so scripts/__tests__/deploy-health-check.test.ts
# can exercise the real retry/backoff loop, rollback branching, and
# port-ownership checks with fake `curl`/`pm2`/`ss`/`ps` stand-ins on PATH,
# without ever touching a real PM2 process.
#
# The port-ownership functions exist because of the 2026-08-26 incident: a
# manually-launched, PM2-unmanaged `tsx apps/api/src/index.ts` process
# occupied port 4000. Every subsequent PM2-managed deploy then failed to
# bind that port (EADDRINUSE) and crash-looped invisibly in the
# background, while the stale manual process kept answering
# curl/pm2-status checks and real traffic with old code - an HTTP 200 and
# a "pm2 status: online" from the WRONG process both looked healthy.
# These functions make that specific failure mode detectable: never trust
# "the port answers" or "PM2 says online" alone - confirm the process
# actually listening on the port is the one PM2 is actually managing.

# Tolerates connection-refused (the process may still be booting) - only a
# real non-2xx/timeout/refused response counts as "not ready yet". Prints
# nothing on failure so a retry loop calling this repeatedly doesn't spam
# curl's own error text; the caller decides what (if anything) to log.
curl_ok() {
  curl --fail --silent --max-time 5 "$1" >/dev/null 2>&1
}

# Prints the comma-joined, sorted list of {dyo-api, dyo-web} PM2 app names
# currently reporting status "online". Always exits 0, even if `pm2 jlist`
# itself fails - callers compare the printed string, they don't rely on this
# function's exit status.
pm2_apps_online() {
  pm2 jlist 2>/dev/null | node -e '
    let data = "";
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try {
        const apps = JSON.parse(data);
        const online = apps
          .filter((app) => ["dyo-api", "dyo-web"].includes(app.name) && app.pm2_env.status === "online")
          .map((app) => app.name)
          .sort();
        process.stdout.write(online.join(","));
      } catch {
        process.stdout.write("");
      }
    });
  ' 2>/dev/null || true
}

# The OS PID currently listening on 127.0.0.1:<port>, or empty if nothing
# is. Uses `ss` (present on every target Ubuntu image this deploys to,
# unlike `lsof`/`fuser` which aren't guaranteed installed). Deliberately
# tolerant of `ss` printing multiple matching lines or an unexpected
# format - only ever returns the first pid it can parse, never throws.
get_port_listener_pid() {
  local port="${1:?port required}"
  ss -ltnp 2>/dev/null | { grep -F ":${port} " || true; } | { grep -oP 'pid=\K[0-9]+' || true; } | head -1
}

# The real OS pid PM2 currently reports for the named app, or empty if PM2
# doesn't know about it or doesn't report it "online". Looks the app up by
# name rather than assuming array position.
get_pm2_managed_pid() {
  local app_name="${1:?app_name required}"
  pm2 jlist 2>/dev/null | node -e '
    const appName = process.argv[1];
    let data = "";
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try {
        const apps = JSON.parse(data);
        const app = apps.find((a) => a.name === appName && a.pm2_env && a.pm2_env.status === "online");
        process.stdout.write(app && app.pid ? String(app.pid) : "");
      } catch {
        process.stdout.write("");
      }
    });
  ' "$app_name" 2>/dev/null || true
}

# Parent PID of the given pid, or empty if it no longer exists.
get_parent_pid() {
  local pid="${1:?pid required}"
  { ps -o ppid= -p "$pid" 2>/dev/null || true; } | tr -d ' '
}

# True (exit 0) only when `listener_pid` IS `expected_pid`, or is a direct
# child of it - PM2 tracks the interpreter wrapper's own pid (e.g. tsx),
# which itself spawns a child node process that actually binds the port.
# Never true for an unrelated process, no matter how "online" PM2 or curl
# claims things are - this is the exact check the 2026-08-26 incident was
# missing.
port_owned_by_pid_or_child() {
  local listener_pid="$1"
  local expected_pid="$2"
  [[ -z "$listener_pid" || -z "$expected_pid" ]] && return 1
  [[ "$listener_pid" == "$expected_pid" ]] && return 0
  [[ "$(get_parent_pid "$listener_pid")" == "$expected_pid" ]] && return 0
  return 1
}

# Pre-deploy guard: fails closed (clear message, non-zero exit) - NEVER
# kills anything - if the target port already has an owner that isn't the
# current PM2-managed instance of `app_name`. A free port, or a port
# already owned by the app's own current PM2 pid (the normal
# about-to-be-reloaded case), both pass.
verify_no_unexpected_port_owner() {
  local port="${1:?port required}"
  local app_name="${2:?app_name required}"
  local listener_pid
  listener_pid="$(get_port_listener_pid "$port")"
  if [[ -z "$listener_pid" ]]; then
    echo "Port $port is free - no pre-existing owner to verify."
    return 0
  fi
  local expected_pid
  expected_pid="$(get_pm2_managed_pid "$app_name")"
  if port_owned_by_pid_or_child "$listener_pid" "$expected_pid"; then
    echo "Port $port is owned by the current PM2-managed $app_name (pid $expected_pid) - safe to redeploy."
    return 0
  fi
  echo "Refusing to deploy: port $port is already occupied by pid $listener_pid, which is NOT the PM2-managed $app_name (pm2-reported pid: ${expected_pid:-none}). This process was NOT killed. Identify it (e.g. \`ps -p $listener_pid -o pid,ppid,user,cmd\`) and stop it deliberately before deploying - see docs/engineering/PRODUCTION_SAFETY.md." >&2
  return 1
}

# Post-reload gate: PM2 must report `app_name` online AND the real port
# listener must be that exact pid or its direct child. An HTTP 200 or a
# "pm2 status: online" from the wrong process must never count as
# healthy - this runs BEFORE such checks are trusted.
verify_port_owned_by_pm2() {
  local port="${1:?port required}"
  local app_name="${2:?app_name required}"
  local pm2_pid
  pm2_pid="$(get_pm2_managed_pid "$app_name")"
  if [[ -z "$pm2_pid" ]]; then
    return 1
  fi
  local listener_pid
  listener_pid="$(get_port_listener_pid "$port")"
  if [[ -z "$listener_pid" ]]; then
    return 1
  fi
  port_owned_by_pid_or_child "$listener_pid" "$pm2_pid"
}

# Bounded retry/backoff readiness wait - never a blind fixed sleep, and never
# gives up on the first connection-refused response (dyo-api needs a moment
# for tsx boot + migrations + app.listen()). Polls dyo-api's /health/live and
# /health/ready and dyo-web's root, then confirms both PM2 processes report
# "online", before declaring success. Prints one concise line per attempt -
# no raw curl error spam.
#
# Usage: wait_for_healthy <max_wait_seconds> <retry_interval_seconds>
wait_for_healthy() {
  local max_wait_seconds="${1:?max_wait_seconds required}"
  local retry_interval_seconds="${2:?retry_interval_seconds required}"
  local max_attempts=$((max_wait_seconds / retry_interval_seconds))
  local attempt=1
  local api_ready=0
  local web_ready=0

  echo 'Waiting for dyo-api readiness...'

  while [[ "$attempt" -le "$max_attempts" ]]; do
    echo "attempt $attempt/$max_attempts"

    if [[ "$api_ready" -eq 0 ]] && curl_ok 'http://127.0.0.1:4000/health/live' && curl_ok 'http://127.0.0.1:4000/health/ready'; then
      api_ready=1
      echo 'dyo-api ready'
    fi

    if [[ "$web_ready" -eq 0 ]] && curl_ok 'http://127.0.0.1:4100'; then
      web_ready=1
      echo 'dyo-web ready'
    fi

    if [[ "$api_ready" -eq 1 && "$web_ready" -eq 1 ]]; then
      local online
      online="$(pm2_apps_online)"
      # An HTTP 200 and "pm2 status: online" are NOT enough on their own -
      # see this file's own module doc comment for why. Only once the real
      # port-4000 listener is verified to actually be the PM2-managed
      # dyo-api (or its direct child) does a "healthy" response get
      # trusted at all.
      if [[ "$online" == "dyo-api,dyo-web" ]] && verify_port_owned_by_pm2 4000 dyo-api; then
        echo 'deployment healthy'
        return 0
      fi
    fi

    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$retry_interval_seconds"
    fi
    attempt=$((attempt + 1))
  done

  echo "Health check timed out after ${max_wait_seconds}s." >&2
  echo "  dyo-api ready: $([[ "$api_ready" -eq 1 ]] && echo yes || echo no)" >&2
  echo "  dyo-web ready: $([[ "$web_ready" -eq 1 ]] && echo yes || echo no)" >&2
  echo "  pm2 online: $(pm2_apps_online)" >&2
  if ! verify_port_owned_by_pm2 4000 dyo-api; then
    echo "  port 4000 ownership: NOT verified as the PM2-managed dyo-api (listener pid: $(get_port_listener_pid 4000), pm2-reported pid: $(get_pm2_managed_pid dyo-api)) - an unmanaged process may be answering health checks instead of the real deploy." >&2
  fi
  return 1
}

# Pure decision logic for what the rollback path should do, kept separate
# from the actual git/npm/pm2 side effects so it can be unit tested without
# touching a real checkout or process manager.
#
# Usage: describe_rollback_decision <previous_sha> <expected_sha> <schema_changed 0|1>
# Prints exactly one of: SCHEMA_CHANGED_STOP | SAME_SHA_STOP | ATTEMPT_ROLLBACK
describe_rollback_decision() {
  local previous_sha="$1"
  local expected_sha="$2"
  local schema_changed="$3"

  if [[ "$schema_changed" -eq 1 ]]; then
    echo 'SCHEMA_CHANGED_STOP'
    return 0
  fi

  if [[ "$previous_sha" == "$expected_sha" ]]; then
    echo 'SAME_SHA_STOP'
    return 0
  fi

  echo 'ATTEMPT_ROLLBACK'
}
