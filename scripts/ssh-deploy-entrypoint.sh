#!/usr/bin/env bash
set -Eeuo pipefail

# Forced-command entrypoint for AF-agent's dedicated production deploy SSH
# key (installed in ~fahad/.ssh/authorized_keys with
# restrict,command="<this file>" - see .deploy-tools/README for the exact
# line). Mirrors /opt/dashboard-dyo-app/scripts/ssh-deploy-entrypoint.sh's
# proven design: the key can NEVER open an interactive shell, forward a
# port, or run any command other than exactly what this file execs -
# "restrict" already disables pty/agent/X11/port-forwarding at the sshd
# level; this script is the second, independent layer that also rejects
# anything except a single well-formed "deploy <40-hex-sha>" command.

readonly APP_DIR='/opt/AF-agent'

# SSH_ORIGINAL_COMMAND is only set when a forced-command key is used and
# the client requested a command - normal `ssh host` (no command) leaves it
# unset, which read defaults to empty and correctly falls through to the
# rejection below (no interactive shell is ever reachable through this key).
read -r ACTION SHA EXTRA <<<"${SSH_ORIGINAL_COMMAND:-}"

if [[ "$ACTION" != 'deploy' || ! "$SHA" =~ ^[0-9a-f]{40}$ || -n "${EXTRA:-}" ]]; then
  echo 'Only "deploy <40-character-sha>" is allowed through this key.' >&2
  exit 64
fi

exec "$APP_DIR/scripts/deploy-production.sh" "$SHA"
