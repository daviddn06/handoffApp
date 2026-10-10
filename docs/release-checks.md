# Launch verification, September 14, 2026

Design reference is https://handofflease.vercel.app. The new app keeps the simple Handoff wordmark, blue, white surfaces, compact navigation, listing cards, and campus map. The existing marketing page remains a separate asset copy with a navigation bridge only.

## Automated checks

- 13 real HTTP integration tests pass. They exercise two-student requests, contact privacy, verified accounts, reset token replay and expiry, ownership, input validation, photo decoding, cross-origin protection, moderation, upload admission, and migration preservation.
- Independent backend review reproduced and rechecked the account registration, reset concurrency, moderation, and concurrent upload fixes. No concrete backend launch blocker remained.
- TypeScript and Vite production build pass. Production dependencies report zero known vulnerabilities at verification time.
- Backup sets were restored locally and checked for matching database and photos, SHA-256 hashes, archive membership, and failure on missing registered photos.

## Browser coverage

| Flow | Evidence |
| --- | --- |
| Browse and map | Real local API inventory renders; working OpenStreetMap tiles and price pins |
| Filters | Maximum rent 1000 returns only the 850 listing; clearing and URL state work |
| Signed-out save | Redirects to sign-in with a return route |
| Renter account | Login, save listing, submit request, and request persistence pass |
| Owner account | Incoming request, explicit contact-sharing confirmation, acceptance, and renter contact disclosure pass |
| Renter acceptance | Re-login shows accepted request and owner contact; Sent is the default when appropriate |
| Listing editor | Draft create and resume, two real photos reencoded to WebP, reordering, preview, publishing, and live title/rent edits persist |
| Profile and gallery | Bio saves across reload; photo next and Escape dismissal pass |
| Archive and reports | Archiving removes the test listing from discovery; a submitted report persists in SQLite |
| Dialog focus | Mobile report dialog fits, Shift+Tab wraps inside, and Escape dismisses |
| Student email restriction | Non-university Gmail address rejected with a readable error |
| Mobile | Browse at 390 and 320 CSS pixels has no horizontal overflow; filter dialog fits 390 by 844 |
| Keyboard | Escape closes filter dialog and restores focus to Filters |
| JavaScript | No uncaught page errors in the separate agent-browser verification session |

Local QA uses an isolated temporary database and captured mail. No sample listings or test accounts are deployed. Screenshots are kept in ignored qa/ and the migration deliverables.

## Release operations

Deployment runs on every push to `main` through `daviddn06/deploy` (see the README). It reruns checks on GitHub, uploads a new isolated release, stops only Handoff, creates a matched backup where data already exists, atomically switches the release, and verifies health, release identity, and process working directory. Failure restores prior code and data where available, preserving the failed data directory.

Production verification results are recorded in the Handoff zone migration deliverable after cutover. SMTP configuration alone is not proof of delivery. Same-VPS backups do not cover loss of the VPS. The old Supabase hostname is unavailable, so no prior accounts or listings have been migrated.
