# Handoff server operations

Run `node --env-file-if-exists=.env server/index.js`. The server binds only to `127.0.0.1`, defaults to port 4742, and serves the built frontend from `dist/`.

Production configuration lives in the service environment. See `../.env.example`. `HANDOFF_ORIGIN` must exactly match the public HTTPS origin without a trailing slash. Development permits HTTP only for localhost or 127.0.0.1. Cookie security follows the configured origin, and every API mutation requires its exact Origin header. Caddy must preserve the Host and provide the client forwarding header. Express trusts only loopback proxies.

`HANDOFF_DATA_DIR` contains `handoff.sqlite`, its SQLite WAL files, and `uploads/`. It must be writable by the dedicated service user and live outside release directories. Never expose this directory through a generic static file server. The app authorizes uploaded photo access. Uploads admit at most two requests globally and one per account before buffering, limit images to 24 megapixels and 8 MB each, and enforce a 250 MB encoded-photo quota per account. No production seed data or automatic verification bypass exists.

SMTP must be configured for account signup, verification resend, and password recovery. Port 587 requires STARTTLS; port 465 uses `SMTP_SECURE=true`. `MAIL_FROM` must be a sender authorized by the provider. A configured provider sets `emailReady=true`; successful configuration alone does not prove delivery. A provider failure returns a 503 for auth mail and does not claim to have sent a message. Notifications for requests are sent after the request is saved. Their response contains `notification.emailSent`; false means the request remains visible in the app but email could not be delivered.

## Reports and moderation

These commands require shell access as the Handoff service user and the existing `HANDOFF_DATA_DIR`. There is no public admin endpoint. Reports may contain private student details, so keep operator output within authorized operations.

```bash
sudo -u handoff env HANDOFF_DATA_DIR=/var/lib/handoff node server/operator.js reports
sudo -u handoff env HANDOFF_DATA_DIR=/var/lib/handoff node server/operator.js reports all
sudo -u handoff env HANDOFF_DATA_DIR=/var/lib/handoff node server/operator.js archive-listing LISTING_UUID
sudo -u handoff env HANDOFF_DATA_DIR=/var/lib/handoff node server/operator.js resolve-report REPORT_UUID
```

Review the report, archive the listing if needed, then mark the report resolved. Archiving retains the listing and its report history, removes it from discovery, and declines pending requests. Accepted contacts stay available to the involved students. An operator archive also sets a moderation lock that the owner cannot remove. After review, `unlock-listing LISTING_UUID` removes the lock while leaving the listing archived for its owner to republish.

## Smart import

`OPENAI_API_KEY` in `/etc/handoff/app.env` turns Smart import and the listing chat helper on. `OPENAI_MODEL` is optional and defaults to `gpt-5.6-luna`. Without a key `GET /api/config` reports `aiReady:false`, the two import routes answer 503 with code `ai_unavailable`, and the six step form is unaffected. The key is only ever read on the server. Both routes need a verified student on a live campus and are rate limited per account, 20 imports and 120 chat turns per hour. Uploaded screenshots are resized and re-encoded before they leave the VPS, and no prompt text, screenshot or listing content is stored.

`HANDOFF_AI_MOCK=1` is a development only switch that returns a canned import and canned chat turns without a key. It refuses to start when `NODE_ENV=production`. Never set it on the VPS.

Every call writes one row to `ai_usage` with the token counts and the model, and nothing else.

```bash
sudo -u handoff env HANDOFF_DATA_DIR=/var/lib/handoff node server/operator.js ai-usage 30
```

## Internal dashboard

The dashboard is its own host, `internal.handofflease.com`, served by the same process on 127.0.0.1:4742 and the same built bundle. Caddy reverse proxies it and adds the surface header, so the app never has to know which host it is behind.

```
internal.handofflease.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4742 {
        header_up X-Handoff-Surface internal
    }
    header {
        -Server
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        X-Frame-Options DENY
        X-Robots-Tag "noindex, nofollow"
    }
}
```

Two things are required and neither is enough alone. The account needs the admin flag from `scripts/make-admin.js`, and its email must be listed in `HANDOFF_ADMIN_EMAILS` in `/etc/handoff/app.env` (comma separated, matched lower case after trimming). Anything else, including a flagged account that is not listed, is refused at sign in on that host with 403 and never gets a session, sees `isAdmin:false` on its own session, and gets 404 from every `/api/admin` route. An empty or missing `HANDOFF_ADMIN_EMAILS` closes the dashboard to everybody and the service logs one warning at startup. Changing the list needs a service restart, since it is read once.

```
HANDOFF_ADMIN_EMAILS=daviddn@usc.edu
```

The internal host carries the dashboard and nothing else. Only health, config, session, sign in, sign out and `/api/admin/*` exist there; signup, recovery, listings and requests all answer 404. On the app host `/api/admin/*` answers 404 for everyone, and `/admin` only points a browser at the internal host. The internal host sends `X-Robots-Tag: noindex, nofollow` and a `robots.txt` that disallows everything, and it is on no CORS allow list. Grant the flag on the VPS to an account that already exists.

```bash
runuser -u handoff -- env HANDOFF_SEED_CONFIRM=production HANDOFF_DATA_DIR=/var/lib/handoff node scripts/make-admin.js david@usc.edu
runuser -u handoff -- env HANDOFF_SEED_CONFIRM=production HANDOFF_DATA_DIR=/var/lib/handoff node scripts/make-admin.js david@usc.edu --revoke
```

The script refuses production data directories unless `HANDOFF_SEED_CONFIRM=production` is set on purpose, the same guard `scripts/seed-demo.js` uses. Locally it is just `HANDOFF_DATA_DIR=./data node scripts/make-admin.js demo.owner@usc.edu`.

The dashboard's sections are at `/`, `/users`, `/listings` and so on on the internal host. Every admin write lands in `admin_audit` and is visible on the dashboard's Audit page. Disabling an account sets `users.disabled_at`, ends every session for it, and refuses both login and every authenticated route with 403. Nothing is deleted. The System page reads the release marker, the schema version, host memory and load, `df -k` on the data directory, the backups directory, and `journalctl -u handoff -n 50 --no-pager` when the service user can read it. The dashboard shows private student details, so treat an open browser tab the same as an operator shell.

## Read only MCP

`POST https://internal.handofflease.com/mcp` takes one JSON-RPC message with `Authorization: Bearer <token>` and answers one tool, `sightpane_overview` (`server/sightpane.js`). It returns counts and the newest public listing titles only, never names, emails or report text. It answers on the internal host only. Tokens are kept as sha256 hashes in `mcp-tokens.json` in the data directory (mode 600). With no token file every call gets 401.

```bash
cd /opt/handoff/current
runuser -u handoff -- env HANDOFF_DATA_DIR=/var/lib/handoff node server/mcp-token.js new sightpane   # prints the token once
runuser -u handoff -- env HANDOFF_DATA_DIR=/var/lib/handoff node server/mcp-token.js list
runuser -u handoff -- env HANDOFF_DATA_DIR=/var/lib/handoff node server/mcp-token.js revoke sightpane
```

## Private USC referrals

An allowlisted administrator can prepare an unpublished USC student sublease draft from a manually reviewed source. This creates no student account and sends no message. A private, reusable link at `HANDOFF_ORIGIN/referral/TOKEN` lets the actual student review it. Tokens contain 32 random bytes and are retained in the private database so the dashboard can always copy the same link. Treat links, source records, and backups as private.

Admin endpoints exist only on the authenticated internal surface, under `/api/admin/referrals`.

| Method and path | Behavior |
| --- | --- |
| `GET /` | Lists 25 records per page. Accepts `page`, `query`, `status`, and `outreachStatus`. Returns `referrals`, `totals`, `page`, `pages`, and `total`. |
| `POST /` | Creates a private source draft. Returns 201 with `referral`; a duplicate canonical source returns 409 with `referralId`. |
| `GET /:id` | Returns `referral` and up to 1,000 recent `events`, newest first. |
| `PATCH /:id` | Updates source metadata, partial imported `listing`, outreach fields, or an audit `note`. An included `listing` replaces the imported field object. Claimed source identity and listing details cannot be changed by the operator. |
| `POST /:id/photos` | Multipart `photos`, up to 16 total, 8 MB per original. Only pending referrals accept additions. Raster images are reencoded to WebP with metadata removed, preserving source order. |
| `GET /:id/photos/:photoId` | Reads a private image for an authorized internal admin. |
| `POST /:id/revoke` | Disables the private capability. Keeps the source and timeline; an already created owner listing remains under the owner's control. |

Creation requires `sourceUrl`, `sourceName`, `authorName`, `sourceText`, and `evidence` containing literal `student`, `usc`, and `sublease` excerpts. `authorProfileUrl` and an ISO `sourcePostedAt` are optional. The sublease excerpt must appear in the captured post. Student and USC excerpts must appear in the post or cite the recorded public author profile. Current-profile wording such as “Studies” and “Studying” is accepted; “Studied” alone is not current-student evidence. Operators must review the real evidence. The service never fetches or independently verifies a source profile.

Optional `listing` uses normal listing fields without `status` or `photos`. Leave unknown facts absent, including deposit, availability, location, or room type. Monetary amounts retain up to two decimal places. Optional outreach fields are `outreachStatus`, `outreachNotes`, and `outreachDraft`. Allowed statuses are `draft`, `ready`, `sent`, `replied`, `declined`, and `do_not_contact`. They are manually maintained records, not delivery actions. `{{link}}` in the draft becomes the exact private link; a nonempty draft always retains that link. Changes and human notes create timeline events and admin audit entries.

Student endpoints live on the app surface, under `/api/referrals`.

| Method and path | Behavior |
| --- | --- |
| `GET /:token` | Reads the private draft and records one open. `?track=0` reads without an open or visitor-cookie replacement, for editor and auth refreshes. |
| `GET /:token/photos/:photoId` | Reads the corresponding private source image. |
| `POST /:token/claim` | Requires an active verified USC account and `{ownershipConfirmed:true,termsAccepted:true}`. Records the current-student, ownership and photo-rights attestation, copies the photos into that owner's upload registry, and creates no listing. Repeating the claim as the same owner is safe. |
| `POST /:token/listing` | Requires the claimed owner and a complete normal listing payload with `status` set to `draft` or `active`. Reuses listing validation and photo ownership checks, then creates one linked listing atomically. Repeated submission returns the same listing; a deleted linked listing returns 410. |

Draft reads return `{referral,next}`. Student-visible referral fields are `id`, `status`, `campusId`, `authorName`, `sourceName`, `sourceUrl`, `sourcePostedAt`, partial `listing`, `photos:[{id,url}]`, `missing`, `claimedByMe`, `listingId`, and `listingStatus`. `next` contains signup, signin and review URLs; a successful claim also returns `editUrl`. Source post text, evidence, author profile URL, outreach records, and aggregate analytics remain admin-only. Before claim, the unique capability authorizes access. After claim, draft and photo reads additionally require its actual owner or an admin. Revoked capabilities return 404.

Admin referral objects additionally contain the exact `link`, source evidence and profile metadata, outreach fields, `metrics`, `lastOpenedAt`, creation/update times, and claim/attestation times. Metrics are `opens`, `uniqueVisits`, `accountCreated`, `verified`, `claimed`, and `published`; list totals add `referrals`. Unique visits represent random browser cookies, not proven unique people. Publication counts record whether a linked listing has ever been published; `listingStatus` shows its current state. Events contain `id`, `type`, `createdAt`, `actorId`, `actorName`, and `details`.

The HttpOnly referral cookie attributes actual signup/login and later verification, including an email link opened on another browser. Attribution is not proof that an account belongs to the named source author; ownership is attested at claim. Visitor records contain only a hash of a random visitor cookie, not an IP fingerprint. Referral API and landing routes send `no-store`, `noindex`, and `no-referrer` protections. Private source images live under `HANDOFF_DATA_DIR/uploads/referrals`, never a public static directory.

For reviewed JSON plus local source photos on the VPS, use `scripts/import-referrals.js` as documented in [the operator script guide](../scripts/README.md). It requires an existing active, verified USC allowlisted admin, creates a five-minute temporary session, uses these same internal API validations, and removes the session afterward. Reruns deduplicate canonical sources and original photos without changing existing outreach state. It never sends outreach.

## Backup and recovery

Use SQLite's backup API rather than copying the main database file while it is live. Run before deploying any schema migration. Copy uploads into the same dated backup set. New schema versions must add an explicit migration with backup and rollback instructions. Startup migrates in order through contacts schema 12 (`users.phone`, `users.instagram`, `users.facebook`, `users.share_channels`, and `handoff_requests.share_channels`), then referrals schema 13 (drafts, private photo registry, visits, account attribution, and events), then signup progress schema 14 (`users.signup_step`). Each of these migrations first writes a consistent dated SQLite backup under `HANDOFF_DATA_DIR/backups/`. Unknown newer schemas and unversioned populated databases are refused.

`deploy/backup.mjs` creates one matched set containing `manifest.json`, `handoff.sqlite`, and `uploads.tar.gz`, covering registered listing uploads, current avatars, and schema13 referral source photos. It also supports contacts-only schema12 backups before an upgrade. Preserve the complete matched set for rollback; a database-only startup backup is not a replacement for the photo archive.

```bash
sudo -u handoff env HANDOFF_DATA_DIR=/var/lib/handoff node server/operator.js backup /var/lib/handoff-backups/2026-09-14/handoff.sqlite
```

Restore only with the Handoff service stopped. Preserve the entire original data directory as a dated recovery copy, then restore the consistent database and matching uploads with owner `handoff` and private filesystem permissions. Start the matching application release and verify `/api/health`, account login, listing retrieval, and images.

## Verification

`npm test` starts real ephemeral HTTP servers with isolated temporary databases. Its injected mail transport captures links within tests only. Tests exercise verification, reset token replay/expiry, session invalidation, account/campus validation, cross-origin blocking, rate limits, two-student requests and contact visibility, listing ownership, image validation, listing expiry/filter semantics, failed SMTP, moderation persistence, and database reopen. They make no external email or network calls.
