#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -n "$(git status --porcelain)" ]; then
  echo 'Commit the reviewed Handoff changes before deploying.' >&2
  exit 1
fi
npm test
npm run build
handoff_host=root@srv1765772.hstgr.cloud
handoff_key=/Users/david/.ssh/hostinger_dashboard
handoff_release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
node --input-type=module -e 'import {writeFileSync} from "node:fs"; writeFileSync("dist/release.json", JSON.stringify({release:process.argv[1]}));' "$handoff_release"
handoff_dest="/opt/handoff/releases/$handoff_release"
ssh -i "$handoff_key" "$handoff_host" "mkdir -p '$handoff_dest'"
rsync -az -R -e "ssh -i $handoff_key" dist server deploy src/data package.json package-lock.json "$handoff_host:$handoff_dest/"
ssh -i "$handoff_key" "$handoff_host" bash -s -- "$handoff_dest" "$handoff_release" <<'REMOTE'
set -euo pipefail
handoff_dest=$1
handoff_release=$2
cd "$handoff_dest"
npm ci --omit=dev
chown -R root:handoff "$handoff_dest"
chmod -R g+rX "$handoff_dest"
handoff_previous=''
if [ -L /opt/handoff/current ]; then
  handoff_previous=$(readlink -f /opt/handoff/current)
fi
handoff_backup=''
handoff_switched=false
rollback() {
  trap - ERR
  systemctl stop handoff || true
  if [ "$handoff_switched" = true ] && [ -n "$handoff_backup" ]; then
    mv /var/lib/handoff "/var/lib/handoff-failed-$handoff_release"
    install -d -o handoff -g handoff -m 0750 /var/lib/handoff
    cp "$handoff_backup/handoff.sqlite" /var/lib/handoff/handoff.sqlite
    tar -xzf "$handoff_backup/uploads.tar.gz" -C /var/lib/handoff
    chown -R handoff:handoff /var/lib/handoff
    chmod 0600 /var/lib/handoff/handoff.sqlite
  fi
  if [ -n "$handoff_previous" ]; then
    ln -s "$handoff_previous" "/opt/handoff/rollback-$handoff_release"
    mv -Tf "/opt/handoff/rollback-$handoff_release" /opt/handoff/current
    if ! systemctl start handoff; then
      echo 'Recovery failed to start the prior release. Inspect handoff.service before retrying.' >&2
    else
      sleep 2
      if ! curl -fsS http://127.0.0.1:4742/api/health >/dev/null; then
        echo 'The prior release is not healthy after recovery. Operator attention is required.' >&2
      fi
    fi
  fi
  echo 'Release failed. Prior code/data restored where available; failed data preserved.' >&2
  exit 1
}
trap rollback ERR
systemctl stop handoff
if [ -f /var/lib/handoff/handoff.sqlite ]; then
  handoff_backup=$(HANDOFF_DATA_DIR=/var/lib/handoff node deploy/backup.mjs | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const b=JSON.parse(s);if(!b.ok)process.exit(1);process.stdout.write(b.directory);')
fi
ln -s "$handoff_dest" "/opt/handoff/next-$handoff_release"
mv -Tf "/opt/handoff/next-$handoff_release" /opt/handoff/current
handoff_switched=true
systemctl start handoff
handoff_healthy=false
for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:4742/api/health | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.exit(JSON.parse(s).ok===true?0:1)' &&
     curl -fsS http://127.0.0.1:4742/release.json | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.exit(JSON.parse(s).release===process.argv[1]?0:1)' "$handoff_release"; then
    handoff_pid=$(systemctl show handoff -p MainPID --value)
    if [ "$(readlink -f "/proc/$handoff_pid/cwd")" = "$handoff_dest" ]; then
      handoff_healthy=true
      break
    fi
  fi
  sleep 2
done
[ "$handoff_healthy" = true ]
trap - ERR
echo "Handoff release $handoff_release is healthy."
REMOTE
