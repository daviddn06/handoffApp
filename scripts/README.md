# Handoff scripts

Development helpers and explicitly scoped operator tools. The referral importer below is intended for the production VPS. Demo and QA scripts remain separate.

## import-referrals.js

Imports manually reviewed USC student sublease sources and their actual local photos into private referral drafts. It never sends outreach, creates accounts, grants roles, claims drafts, or publishes listings. Use an existing active, verified USC administrator whose email is already in `HANDOFF_ADMIN_EMAILS`.

Run from the matching deployed release on the VPS as the service user, with the existing production environment. Replace `EXISTING_ADMIN_EMAIL` and the batch path with reviewed values.

```bash
sudo -u handoff node --env-file=/etc/handoff/app.env scripts/import-referrals.js \
  --admin-email EXISTING_ADMIN_EMAIL --batch /var/lib/handoff/imports/reviewed.json
```

The JSON envelope is `{ "reviewed": true, "referrals": [...] }`. Each referral contains the admin creation API fields plus a `photos` array of local file paths relative to the JSON folder. Include `sourceUrl`, `sourceName`, `authorName`, optional `authorProfileUrl` and `sourcePostedAt`, literal `sourceText`, `evidence` with `student`, `usc` and `sublease` excerpts, and the known fields in `listing`. Optional `outreachStatus`, `outreachNotes` and `outreachDraft` are saved as text only. Use `{{link}}` where the private link should appear in a draft message. Leave unknown factual fields absent. `photos: []` is valid when no source photos were available. Do not add invented data to make an incomplete draft look complete.

Bounds are 20 entries, 16 photos per referral, 8 MB per original photo, and a 2 MB JSON batch. Images must be supported raster photographs between 100 by 100 pixels and 24 megapixels. Paths cannot escape the batch folder, including through symlinks. Only the configured exact `https://app.handofflease.com` and `https://internal.handofflease.com` origins are accepted. All referral mutations use the authenticated internal HTTPS API with redirects disabled. The local DB is used only for existing-account checks, registered photo reads, and one temporary session with a five-minute expiry. The session is removed in `finally`; interrupt signals also trigger cleanup. The importer never prints authentication material.

Reruns reuse the canonical source's existing private link and preserve its outreach state and edited source data. Identical source photos are compared against the exact server encoding, so an interrupted run can be retried even if a successful upload response was lost. New photos can be appended only while the referral remains pending and below its limit. Existing claimed or revoked data is preserved. A local `.referral-import.lock` prevents overlapping operator runs. After a forced process kill, confirm its recorded PID is no longer active before removing that stale lock; any remaining session expires within five minutes. Import errors stop the batch, so earlier completed entries may remain and can be safely retried.

Successful stdout is a JSON array containing only `id`, `link`, `photoCount` and `outreachStatus`. Links are private capabilities, so keep the output with the reviewed source records. No reviewed source JSON or actual source photos belong in Git.

## seed-demo.js

Fills a local development database with demo students, listings, photos, saved listings and handoff requests so the UI can be reviewed with realistic content.

```bash
HANDOFF_DATA_DIR=./data HANDOFF_ORIGIN=http://127.0.0.1:4741 node scripts/seed-demo.js
# or
HANDOFF_DATA_DIR=./data npm run seed:demo
```

The script prints the data directory it is about to use and refuses to run against `/var/lib/handoff`, `/var/backups/handoff` or `/opt/handoff` unless `HANDOFF_SEED_CONFIRM=production` is set on purpose. `--remove` deletes the demo accounts and everything they own without seeding again. On the VPS run it as the `handoff` user so the photo files stay readable by the service. When `HANDOFF_DATA_DIR` is unset it defaults to `./data`, which is gitignored. Run `npm run server` and `npm run dev` afterwards and open http://127.0.0.1:4741.

Re-running is safe. The script finds the demo accounts by their fixed email addresses, deletes their listings, uploads, saved listings, requests, sessions and tokens, removes the photo files those uploads pointed at, and then seeds again from scratch. Demo rows are identified by those fixed email addresses.

Photos are generated locally with sharp, so the script makes no network calls. Each photo is an abstract interior scene rendered from an SVG and encoded the same way the upload route encodes a real upload, which is a single WebP file at quality 84 fitted inside 1800 by 1800 pixels. There is no separate thumbnail because the upload route does not create one.

### What gets seeded

| Item | Count |
| --- | --- |
| Verified students | 7 |
| Active USC listings | 22 |
| Active UCLA listings | 5 |
| Active LMU listings | 2 |
| Demo owner drafts | 2 |
| Demo owner handed off | 1 |
| Photo files | 91 |
| Saved listings | 4 |
| Handoff requests | 10, covering pending, accepted, declined and withdrawn |

USC coordinates spread from roughly 34.014 to 34.040 north and -118.300 to -118.265 west, with a denser cluster inside about 0.8 km of the campus center and a few outliers toward downtown, so the map shows a real cluster.

### Demo credentials

Every demo account uses the same password.

Password `Demo password 2026!`

| Email | Name | Campus |
| --- | --- | --- |
| demo.owner@usc.edu | Maya Chen | USC |
| demo.jordan@usc.edu | Jordan Alvarez | USC |
| demo.priya@usc.edu | Priya Raman | USC |
| demo.marcus@usc.edu | Marcus Webb | USC |
| demo.sofia@ucla.edu | Sofia Delgado | UCLA |
| demo.ethan@ucla.edu | Ethan Nakamura | UCLA |
| demo.alina@lmu.edu | Alina Moreau | LMU |

Sign in as demo.owner@usc.edu for the fullest view. That account owns live listings, two drafts and one handed off listing, has saved listings, and has handoff requests both as a requester and as a listing owner.

These accounts are seeded already verified, so no email delivery is needed to sign in. Production is never seeded and has no verification bypass.

## qa-server.mjs and smtp-smoke.mjs

Existing QA helpers. See the migration record in the Handoff zone deliverables for how they were used.
