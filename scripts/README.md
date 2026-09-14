# Handoff scripts

Helper scripts for local development. None of them are part of a release and none of them are safe to point at production data.

## seed-demo.js

Fills a local development database with demo students, listings, photos, saved listings and handoff requests so the UI can be reviewed with realistic content.

```bash
HANDOFF_DATA_DIR=./data HANDOFF_ORIGIN=http://127.0.0.1:4741 node scripts/seed-demo.js
# or
HANDOFF_DATA_DIR=./data npm run seed:demo
```

The script prints the data directory it is about to use and refuses to run against `/var/lib/handoff`, `/var/backups/handoff` or `/opt/handoff`. When `HANDOFF_DATA_DIR` is unset it defaults to `./data`, which is gitignored. Run `npm run server` and `npm run dev` afterwards and open http://127.0.0.1:4741.

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
