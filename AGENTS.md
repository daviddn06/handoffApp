# Handoff app

Fresh app-only rebuild authorized September 14, 2026. Production target is app.handofflease.com on the same VPS as Vecka. David subsequently authorized a refined homepage based on the preferred Vercel landing. Its standalone source lives in marketing/, with root-domain deployment through deploy-homepage.sh. The original marketing exclusion is superseded.

Read the Documents and Handoff zone briefs. The original code in ../handoff and unfinished landing in ../handoff-rebuild are reference only. Never modify or deploy those as part of the new app.

React and TypeScript frontend, Express server, SQLite with WAL, server-managed cookie sessions, verified student email, local image storage. Keep data and uploads outside release directories and back them up before migrations. Never commit secrets or personal data. Actual account verification requires configured email delivery. Production must never use test verification codes or pretend to send mail.

The database and authentication are new because the previous Supabase hostname does not resolve. Do not claim existing user or listing data has been migrated without source access and verification.

Build, server authorization/integration tests, browser QA, and verified isolated VPS deployment are required. Only Handoff-specific files and service are in deployment scope.

The preferred visual reference is https://handofflease.vercel.app/, specifically the simple Handoff wordmark, blue, white surfaces, and map/listing layout. David reiterated this during the September 14 rebuild. Do not use the different Lovable landing as the app design reference.
