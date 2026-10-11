#!/usr/bin/env bash
# Sends one part of Handoff (TARGET app or homepage) to the server's deploy service over SSH, or
# asks it to roll back or report status (ACTION). A dropped connection is retried; the server
# finishes a deploy it started and a retry of the same commit reports it.
set -uo pipefail
[ -n "${DEPLOY_SSH_KEY:-}" ] || { echo "::error::No DEPLOY_SSH_KEY secret."; exit 1; }
install -d -m 700 ~/.ssh
printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/deploy && chmod 600 ~/.ssh/deploy
# the server's host key, pinned
echo '162.35.17.35 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJi2ElCFdyEh4clT/b2KvTIMVYSk7f84ynJ58egYsuV3' > ~/.ssh/known_hosts
printf 'Host hub\n  HostName 162.35.17.35\n  User root\n  IdentityFile ~/.ssh/deploy\n  IdentitiesOnly yes\n  BatchMode yes\n  ConnectTimeout 30\n  ServerAliveInterval 30\n' > ~/.ssh/config
for n in 1 2 3; do
  if [ "$ACTION" = deploy ]; then ssh hub "deploy $TARGET $GITHUB_SHA" < "$RUNNER_TEMP/release.tgz"; else ssh hub "$ACTION $TARGET"; fi
  rc=$?
  [ $rc -ne 255 ] && exit $rc
  echo "::warning::The connection dropped (try $n), retrying."; sleep $((n * 15))
done
exit 255
