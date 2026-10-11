# Operations

How Handoff runs in production.

## Hosting

Handoff runs on a VPS under its own `handoff` service user and systemd unit, listening on port 4742 on localhost. Caddy terminates HTTPS for the app, the homepage and the internal host.

- App releases live in `/opt/handoff/releases`, selected through the `/opt/handoff/current` symlink.
- The database and photos are in `/var/lib/handoff`, outside every release.
- Service configuration is `/etc/handoff/app.env`, owned by root and readable only by the Handoff group. Secrets never live in the repository.
- Backups are in `/var/backups/handoff`.

## Deploys

Every push to `main` runs `.github/workflows/deploy.yml`.

1. GitHub installs, runs the tests and builds. `dist/release.json` names the full commit.
2. The build is sent over one SSH connection to the server's deploy service. The repository's deploy key can only hand over a build of Handoff, nothing else.
3. The server unpacks a new release folder, runs `npm ci --omit=dev`, stops Handoff, takes a verified data backup, switches the symlink, starts Handoff and checks health, the release id and the working directory.
4. A failed check puts back the previous release and the data backup on its own.

The homepage is a second job of the same workflow. It publishes `marketing/` as a new release with a `handoff-release` meta tag and `release.json`, switches `/opt/handoff-marketing` to it, and checks that the served files are the new ones.

To pause automatic deploys set the Actions variable `AUTODEPLOY` to `off`. To roll back, open Actions, Deploy, Run workflow, choose `rollback` and the part (`app`, `homepage` or both). An app rollback also restores the data backup taken before that deploy. `deploy.sh` and `deploy-homepage.sh` are older manual paths kept as a fallback.

## Backups

`handoff-backup.timer` creates a daily dated set with a matched database snapshot, an archive of uploads and a hash manifest. These copies sit on the same server, so they protect against mistakes, not against losing the server. Offsite backup is a separate step still to set up.

## Internal dashboard

https://internal.handofflease.com is served by the same process and build as the app. Access needs two things only the server can grant, the admin flag from `node scripts/make-admin.js <email>` and the account's email on `HANDOFF_ADMIN_EMAILS`. Signing in there refuses every other account with 403 and opens no session, `/api/admin/*` answers 404 on the app host for everyone, and the host is never indexed. Every admin action sits behind a confirmation and is written to an audit log.

## Demo data

`HANDOFF_DATA_DIR=./data npm run seed:demo` fills a local database with seven verified demo students, about thirty listings around USC, UCLA and LMU with generated photos, saved places, requests in every status and two boosted listings. It refuses to run against production paths unless explicitly confirmed, and production carries no demo accounts. Demo logins are in [scripts/README.md](../scripts/README.md) and only work on a local database.

## Operator commands

See [server/README.md](../server/README.md) for reports, AI token usage (`node server/operator.js ai-usage [DAYS]`) and maintenance.
