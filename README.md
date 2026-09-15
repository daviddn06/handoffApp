# Handoff

Student sublease app at https://app.handofflease.com. Fresh app repository created September 14, 2026. The homepage in marketing/ is a polished standalone page based on the preferred Vercel design, linked to the app in both directions.

## Local development

Use Node 22. Install with `npm ci`. Configure `.env` from `.env.example`, using `HANDOFF_ORIGIN=http://127.0.0.1:4741` locally. Run `npm run server` and `npm run dev` in separate terminals. Open http://127.0.0.1:4741. Production builds use `npm run build`; `npm start` serves both the API and built app.

The app never creates sample inventory in production. Verification and password recovery require SMTP. Integration tests inject a mail capture transport in an isolated temporary data directory, without external delivery.

## Product

Campus discovery with dates, budget, room type, roommate preference and amenities on a map. Students can state their own gender, which is optional and private, and listers of a private or shared room can ask for women or men preferred or only, which fair housing rules allow for shared homes and never for an entire place. Listers can share what they pay on the original lease, so every listing below it shows the monthly savings and can be sorted by biggest savings. Student accounts with campus email verification by six digit code or link. Browsing, saving and drafts work right after signup, publishing and handoff requests need a verified email. Listing photos, drafts, publishing and archiving. Saved listings. Handoff requests with acceptance, decline and withdrawal. Students can add a phone number, an Instagram handle and a Facebook profile, and choose which of them are shared when a request is accepted. Email is always shared, because it is the verified identity. A request can share less than the profile default says, and the choice is made in the request sheet before it is sent. Contact details are revealed only to accepted request participants. Reports saved for operator review. Account verification and recovery links expire and are single use. Terms of Service and Privacy Policy live at `/terms` and `/privacy`, and acceptance is recorded before a listing can be published or a request sent. On phones browse is a full map with a card carousel and a Map or List toggle, and every screen follows iOS conventions through `src/styles/mobile.css`. Students can add an optional profile photo, offered as the last sign up step and in profile settings, and it shows wherever their name does. A signed out visitor sees photos, price, savings, facts and dates on a listing but the address, description, lister and exact pin stay locked behind confirming they are a student.

## Smart import

Listing starts with a choice, not a form. `/listings/new` asks how the student wants to list: Smart import (paste a post, drop screenshots or a PDF), Talk it through (a short chat that writes the listing), or Fill it in myself (the six step form). The two AI ways in need a verified student email and a live campus. Nothing is published by either one. Both hand a draft to the same wizard, which marks every field they could not fill with an amber ring and an "Add this" hint, puts an amber dot on the steps that still need work, and validates exactly as it does for a hand typed listing.

The model is reached through the OpenAI Responses API with a strict JSON schema, so the answer is always the listing shape. Set `OPENAI_API_KEY` in the service environment. `OPENAI_MODEL` is optional and defaults to `gpt-5.6-luna`; `gpt-5.4-mini` is the cheaper fallback. Without a key both AI options show a "Being set up" tag, the routes answer 503, and the manual form is unaffected. The key never reaches the browser, and screenshots are resized to 1600px and re-encoded to JPEG before they are sent.

Cost. A real text import measured 1,010 input and 438 output tokens, which at the published `gpt-5.6-luna` rate of $0.20 per million input and $1.20 per million output tokens is well under a cent. A chat turn is smaller again. Screenshots are the expensive input, and four of them still keep one import in the fraction of a cent range. Every call is logged to the `ai_usage` table, and `node server/operator.js ai-usage [DAYS]` prints tokens per day.

## Boost

Boost is the only paid product, $9 for seven days on one active listing the student owns. A boosted listing sorts above everything else inside whichever sort is selected, draws a filled blue pin on the map, carries a Boosted tag on its card, and gives its owner a small stats panel with views and requests counted from the start of the boost. One boost runs per listing at a time and it can be boosted again after the current window ends. Payments are not connected yet, so the "Pay $9 and boost" button is disabled with "Payments open soon" and a free launch boost is offered instead, one per listing, recorded with `kind = 'launch'` and `price_cents = 0`. Entry points are the Boost button on each active row in My listings and the owner callout on the listing page; both open `src/components/BoostModal.tsx`. Routes are `POST /api/listings/:id/boost` and `GET /api/listings/:id/boost-stats`. The rules and the refund policy are stated in the Boosts section of the Terms. See `docs/business-model.md`.

## Internal dashboard

The internal dashboard is a separate host, https://internal.handofflease.com, served by the same process and the same build as the app. It shows totals and 30 day charts for signups, listings, requests and AI tokens, every account with its school, verification, sessions and activity, every listing including drafts, requests, reports, the waitlist with a CSV export, AI token usage, a full audit log of admin actions, and a System page with the release id, schema version, host memory, load, disk, database and upload sizes, backups and the service journal. Admins can verify an account, grant or revoke admin access, disable or enable an account, and archive, unarchive or unboost a listing, each behind a confirmation and each recorded. Access needs two things that only the server can grant: the admin flag from `node scripts/make-admin.js <email>` and the account's email on `HANDOFF_ADMIN_EMAILS`. Sign in on that host refuses every other account with 403 and opens no session, `/api/admin/*` answers 404 on the app host for everyone, and the host is never indexed.

## Deployment

Private repository on GitHub, `daviddn06/handoff-app`. Handoff runs on Vecka's Hostinger VPS under its own `handoff` service user and systemd unit, port 4742 bound to localhost. Caddy terminates HTTPS.

Application releases live at `/opt/handoff/releases`, selected through `/opt/handoff/current`. Database and photos are in `/var/lib/handoff`. SMTP configuration is `/etc/handoff/app.env`, owned by root and readable only by the Handoff group. Backups are in `/var/backups/handoff`.

`bash deploy.sh` runs integration tests and production build, transfers only app files to a new release directory, backs up an existing database, switches the release, restarts Handoff, and checks health. A failed start or health check restores the prior release and matched data backup where available, while preserving the failed data directory. Never use this script to deploy Vecka or the old Handoff working tree.

`handoff-backup.timer` creates a daily dated set containing a matched database snapshot, upload archive, and hash manifest. Copies on the same VPS are recovery aids, not protection against loss of the VPS. Offsite backup configuration remains a separate operational concern.

## Existing data

The original Vercel app's configured Supabase hostname did not resolve during this rebuild. No old user accounts or listings have been imported. Preserve the old source and project until the original database is recovered or explicitly retired.

See `API.md`, `server/README.md`, and the migration record in the Handoff zone deliverables for verification and rollout details.

## Demo data

`HANDOFF_DATA_DIR=./data npm run seed:demo` fills the local database with seven verified demo students, about thirty listings around USC, UCLA and LMU with generated photos, saved places, handoff requests in every status, and two boosted listings so the ranking, the filled pins and the Boosted tag are visible. It refuses to run against production paths. Credentials and details are in `scripts/README.md`. Production was seeded with the same demo set on 2026-09-14 for testing at David's request (`HANDOFF_SEED_CONFIRM=production`, run as the `handoff` user). Remove it with `scripts/seed-demo.js --remove` before real launch.

## Styles

Plain CSS under `src/styles/`, imported in order by `src/styles/index.css`. `motion.css` holds the transitions.dev motion tokens, `base.css` the design tokens and shared primitives (buttons, chips, pills, fields, modal, toast, header, page containers), and one file per page area (`browse.css`, `auth.css`, `detail.css`, `editor.css`, `account.css`, `boost.css`). `docs/ui-brief.md` is the design contract for anyone touching the UI. The map is MapLibre GL with the OpenFreeMap Positron style (no API key, Carto basemaps now watermark without one), a USC DPS patrol zone overlay from `src/lib/dps.ts`, lightweight pixel distance clustering, a preview card, a resizable listing panel, and a map key. `/browse?embed=1` hides the app chrome so the homepage can frame the real app.

## Homepage

The static homepage lives in `marketing/` and shares the app wordmark, typography, and blue. Preview it with `python3 -m http.server 4744 --bind 127.0.0.1 --directory marketing`. Its sample product preview is illustrative; campus links and all account/listing actions open the live app. It makes no enrollment or inventory claims beyond the actual supported campuses.

`bash deploy-homepage.sh` publishes a committed static release at `/opt/handoff-marketing-releases`, atomically points `/opt/handoff-marketing` at it, and verifies the HTML, CSS, JavaScript, and app health. Previous releases are preserved for rollback. It does not change Caddy, DNS, or the app service. Use the regular app deployment only when the app source also changed.
