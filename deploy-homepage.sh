#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo 'Commit the reviewed homepage changes before deploying.' >&2
  exit 1
fi
test -s marketing/index.html
node --check marketing/home.js

handoff_host=root@interserver-vps
handoff_key=/Users/david/.ssh/hostinger_dashboard
handoff_release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
handoff_stage="qa/homepage-release-$handoff_release"
handoff_dest="/opt/handoff-marketing-releases/$handoff_release"
mkdir -p "$handoff_stage"
rsync -a --exclude 'README.md' marketing/ "$handoff_stage/"
node --input-type=module - "$handoff_stage" "$handoff_release" <<'BUILD'
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [stage, release] = process.argv.slice(2);
const path = join(stage, 'index.html');
const html = readFileSync(path, 'utf8');
if (!html.includes('<head>')) throw new Error('Homepage head is missing.');
writeFileSync(path, html.replace('<head>', `<head>\n    <meta name="handoff-release" content="${release}">`));
writeFileSync(join(stage, 'release.json'), JSON.stringify({release}));
BUILD

ssh -i "$handoff_key" "$handoff_host" "mkdir -p '$handoff_dest'"
rsync -az -e "ssh -i $handoff_key" "$handoff_stage/" "$handoff_host:$handoff_dest/"
ssh -i "$handoff_key" "$handoff_host" bash -s -- "$handoff_dest" "$handoff_release" <<'REMOTE'
set -euo pipefail
handoff_dest=$1
handoff_release=$2
handoff_root=/opt/handoff-marketing
chown -R root:root "$handoff_dest"
chmod -R a+rX "$handoff_dest"
test -s "$handoff_dest/index.html"

# Preserve the existing static release, including the original directory layout.
handoff_preserve_directory=false
if [ -L "$handoff_root" ]; then
  handoff_previous=$(readlink -f "$handoff_root")
elif [ -d "$handoff_root" ]; then
  handoff_previous="/opt/handoff-marketing-releases/preserved-$handoff_release"
  handoff_preserve_directory=true
else
  echo 'Existing homepage root is missing. Refusing an unverified cutover.' >&2
  exit 1
fi
test -s "$handoff_root/index.html"

rollback() {
  trap - ERR INT TERM HUP
  if [ -s "$handoff_previous/index.html" ]; then
    ln -s "$handoff_previous" "/opt/handoff-marketing-rollback-$handoff_release"
    mv -Tf "/opt/handoff-marketing-rollback-$handoff_release" "$handoff_root"
  fi
  echo 'Homepage verification failed. Previous page restored.' >&2
  exit 1
}
trap rollback ERR INT TERM HUP
if [ "$handoff_preserve_directory" = true ]; then
  mv "$handoff_root" "$handoff_previous"
fi
ln -s "$handoff_dest" "/opt/handoff-marketing-next-$handoff_release"
mv -Tf "/opt/handoff-marketing-next-$handoff_release" "$handoff_root"

curl -fsS --connect-timeout 5 --max-time 15 --resolve handofflease.com:443:127.0.0.1 https://handofflease.com/release.json |
  node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.exit(JSON.parse(s).release===process.argv[1]?0:1)' "$handoff_release"
curl -fsS --connect-timeout 5 --max-time 15 --resolve handofflease.com:443:127.0.0.1 https://handofflease.com/ |
  node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.exit(s.includes(`name="handoff-release" content="${process.argv[1]}"`)?0:1)' "$handoff_release"
for handoff_asset in home.css home.js; do
  handoff_actual=$(curl -fsS --connect-timeout 5 --max-time 15 --resolve handofflease.com:443:127.0.0.1 "https://handofflease.com/$handoff_asset" | sha256sum | cut -d ' ' -f 1)
  handoff_expected=$(sha256sum "$handoff_dest/$handoff_asset" | cut -d ' ' -f 1)
  [ "$handoff_actual" = "$handoff_expected" ]
done
curl -fsS --connect-timeout 5 --max-time 15 http://127.0.0.1:4742/api/health >/dev/null
trap - ERR INT TERM HUP
echo "Homepage release $handoff_release is live. Previous page retained at $handoff_previous."
REMOTE
