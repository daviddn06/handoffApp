# Handoff

Student sublease app at https://app.handofflease.com. Fresh app repository created September 14, 2026. The homepage in marketing/ is a polished standalone page based on the preferred Vercel design, linked to the app in both directions.

## Local development

Use Node 22. Install with `npm ci`. Configure `.env` from `.env.example`, using `HANDOFF_ORIGIN=http://127.0.0.1:4741` locally. Run `npm run server` and `npm run dev` in separate terminals. Open http://127.0.0.1:4741. Production builds use `npm run build`; `npm start` serves both the API and built app.

The app never creates sample inventory in production. Verification and password recovery require SMTP. Integration tests inject a mail capture transport in an isolated temporary data directory, without external delivery.

## Product

Campus discovery with dates, budget, room type, amenities and map. Listers can share what they pay on the original lease, so every listing below it shows the monthly savings and can be sorted by biggest savings. Verified student accounts. Listing photos, drafts, publishing and archiving. Saved listings. Handoff requests with acceptance, decline and withdrawal. Contact details revealed only to accepted request participants. Reports saved for operator review. Account verification and recovery links expire and are single use.

## Deployment

Private repository on GitHub, `daviddn06/handoff-app`. Handoff runs on Vecka's Hostinger VPS under its own `handoff` service user and systemd unit, port 4742 bound to localhost. Caddy terminates HTTPS.

Application releases live at `/opt/handoff/releases`, selected through `/opt/handoff/current`. Database and photos are in `/var/lib/handoff`. SMTP configuration is `/etc/handoff/app.env`, owned by root and readable only by the Handoff group. Backups are in `/var/backups/handoff`.

`bash deploy.sh` runs integration tests and production build, transfers only app files to a new release directory, backs up an existing database, switches the release, restarts Handoff, and checks health. A failed start or health check restores the prior release and matched data backup where available, while preserving the failed data directory. Never use this script to deploy Vecka or the old Handoff working tree.

`handoff-backup.timer` creates a daily dated set containing a matched database snapshot, upload archive, and hash manifest. Copies on the same VPS are recovery aids, not protection against loss of the VPS. Offsite backup configuration remains a separate operational concern.

## Existing data

The original Vercel app's configured Supabase hostname did not resolve during this rebuild. No old user accounts or listings have been imported. Preserve the old source and project until the original database is recovered or explicitly retired.

See `API.md`, `server/README.md`, and the migration record in the Handoff zone deliverables for verification and rollout details.

## Demo data

`HANDOFF_DATA_DIR=./data npm run seed:demo` fills the local database with seven verified demo students, about thirty listings around USC, UCLA and LMU with generated photos, saved places and handoff requests in every status. It refuses to run against production paths. Credentials and details are in `scripts/README.md`. Production is never seeded.

## Styles

Plain CSS under `src/styles/`, imported in order by `src/styles/index.css`. `motion.css` holds the transitions.dev motion tokens, `base.css` the design tokens and shared primitives (buttons, chips, pills, fields, modal, toast, header, page containers), and one file per page area (`browse.css`, `auth.css`, `detail.css`, `editor.css`, `account.css`). `docs/ui-brief.md` is the design contract for anyone touching the UI. The map is MapLibre GL with the OpenFreeMap Positron style (no API key, Carto basemaps now watermark without one), a USC DPS patrol zone overlay from `src/lib/dps.ts`, lightweight pixel distance clustering, a preview card, a resizable listing panel, and a map key. `/browse?embed=1` hides the app chrome so the homepage can frame the real app.

## Homepage

The static homepage lives in `marketing/` and shares the app wordmark, typography, and blue. Preview it with `python3 -m http.server 4744 --bind 127.0.0.1 --directory marketing`. Its sample product preview is illustrative; campus links and all account/listing actions open the live app. It makes no enrollment or inventory claims beyond the actual supported campuses.

`bash deploy-homepage.sh` publishes a committed static release at `/opt/handoff-marketing-releases`, atomically points `/opt/handoff-marketing` at it, and verifies the HTML, CSS, JavaScript, and app health. Previous releases are preserved for rollback. It does not change Caddy, DNS, or the app service. Use the regular app deployment only when the app source also changed.
