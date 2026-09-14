# Handoff

Student sublease app at https://app.handofflease.com. Fresh app repository created September 14, 2026. The marketing site remains a separately hosted copy of the existing published page.

## Local development

Use Node 22. Install with `npm ci`. Configure `.env` from `.env.example`, using `HANDOFF_ORIGIN=http://127.0.0.1:4741` locally. Run `npm run server` and `npm run dev` in separate terminals. Open http://127.0.0.1:4741. Production builds use `npm run build`; `npm start` serves both the API and built app.

The app never creates sample inventory in production. Verification and password recovery require SMTP. Integration tests inject a mail capture transport in an isolated temporary data directory, without external delivery.

## Product

Campus discovery with dates, budget, room type, amenities and map. Verified student accounts. Listing photos, drafts, publishing and archiving. Saved listings. Handoff requests with acceptance, decline and withdrawal. Contact details revealed only to accepted request participants. Reports saved for operator review. Account verification and recovery links expire and are single use.

## Deployment

Private repository on GitHub, `daviddn06/handoff-app`. Handoff runs on Vecka's Hostinger VPS under its own `handoff` service user and systemd unit, port 4742 bound to localhost. Caddy terminates HTTPS.

Application releases live at `/opt/handoff/releases`, selected through `/opt/handoff/current`. Database and photos are in `/var/lib/handoff`. SMTP configuration is `/etc/handoff/app.env`, owned by root and readable only by the Handoff group. Backups are in `/var/backups/handoff`.

`bash deploy.sh` runs integration tests and production build, transfers only app files to a new release directory, backs up an existing database, switches the release, restarts Handoff, and checks health. A failed start or health check restores the prior release and matched data backup where available, while preserving the failed data directory. Never use this script to deploy Vecka or the old Handoff working tree.

`handoff-backup.timer` creates a daily dated set containing a matched database snapshot, upload archive, and hash manifest. Copies on the same VPS are recovery aids, not protection against loss of the VPS. Offsite backup configuration remains a separate operational concern.

## Existing data

The original Vercel app's configured Supabase hostname did not resolve during this rebuild. No old user accounts or listings have been imported. Preserve the old source and project until the original database is recovered or explicitly retired.

See `API.md`, `server/README.md`, and the migration record in the Handoff zone deliverables for verification and rollout details.
