# Reusable readiness-wait and rollback-decision helpers for
# scripts/deploy-production.sh. Meant to be `source`d, never executed
# directly. Kept in its own file so scripts/__tests__/deploy-health-check.test.ts
# can exercise the real retry/backoff loop and rollback branching with fake
# `curl`/`pm2` stand-ins on PATH, without ever touching a real PM2 process.

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
      if [[ "$online" == "dyo-api,dyo-web" ]]; then
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
