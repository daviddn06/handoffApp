# Shared API contract

JSON requests and responses, same-origin cookies. Errors use `{error: string}` with non-2xx status. Dates are YYYY-MM-DD. Money is integer dollars per month (field `price`). All mutation endpoints await database success. Auth mutations are rate limited and enforce Origin. User email is only returned in session/profile and accepted request contacts.

GET /api/config -> {emailReady:boolean,aiReady:boolean,campuses:Campus[]}
`aiReady` is false when no model is configured, and the app then offers only the manual form.
Campus {id,name,shortName,lat,lng,domain,live:boolean}
GET /api/session -> {user:User|null}
User {id,name,email,campusId:string|null,school:{name,domain,live:boolean},verified:boolean,termsAccepted:boolean,bio:string,gender:'woman'|'man'|'nonbinary'|'unspecified',isAdmin:boolean}
`campusId` is the live campus this student may post at, null when Handoff has not opened at their school. `school` is always the student's own school, taken from their email domain. Browsing, saving, requesting, reporting and the profile are open to every student either way.
POST /api/auth/signup (201 {user} and a session for a new or unverified email, 202 {user:null} when the email already has a verified account; the session is unverified until a code or link confirms it) {name,email,password,gender?} -> {message:string}. Sends verification link. `gender` is optional and defaults to `unspecified`. It is never part of a public listing or a browse result. There is no campus field: the server reads the school from the email domain, accepting subdomains such as alumni.usc.edu, and sets campusId to the matching live campus or null. An email whose domain is not a known US school is refused with 400 {error:"Use your school email. We could not find that school yet.",code:"school_unknown"}.
Passwords are 10 to 128 characters and must contain at least one letter and one number. They may not contain the email local part or a part of the name, and may not be one of the most common passwords. The same rules apply to POST /api/auth/reset.
POST /api/auth/login {email,password} -> {user:User}
POST /api/auth/logout -> {ok:true}
POST /api/auth/verify-code {code} (six digits from the email, needs the session, 8 tries per 15 minutes) -> {user}
POST /api/auth/verify {token} -> {user:User}
POST /api/auth/resend {email} -> {message:string}
POST /api/auth/forgot {email} -> {message:string}
POST /api/auth/reset {token,password} -> {message:string}
PATCH /api/profile {name,bio,gender?} -> {user:User}. An omitted `gender` keeps the stored value.

Listing {id,ownerId,ownerName,campusId,title,description,address,lat,lng,price,deposit,originalPrice:number|null,bedrooms,bathrooms,roomType:'private'|'shared'|'entire',genderPreference:'any'|'women_only'|'women_preferred'|'men_only'|'men_preferred',availableFrom,availableTo,amenities:string[],photos:string[],status:'draft'|'active'|'handed_off'|'archived',createdAt,updatedAt,boostUntil:string|null,boosted:boolean,saved?:boolean}
GET /api/listings?campusId=&query=&minPrice=&maxPrice=&from=&to=&roomType=&gender=&bedrooms=&amenities=&sort=newest|price_asc|price_desc|savings -> {listings:Listing[]}. Active public listings only, no private contact data. Dates must cover the requested stay. Boosted listings come first inside whichever sort is asked for. `gender` takes `women` (any, women_only, women_preferred), `men` (any, men_only, men_preferred), `women_only`, or `men_only`.
GET /api/listings/:id -> {listing:Listing}. Public active or owner only. A view by anyone other than the owner is counted once per session or IP per hour.
GET /api/my-listings -> {listings:Listing[]}
Creating a listing (draft or active), publishing one, and boosting all require a non-null campusId and always use it as the listing campus, never a client value. Without one they return 403 {error:"Listing is not open at <school> yet. You can still browse, save and request anywhere Handoff is live.",code:"school_not_live"}.
POST /api/listings {title,description,address,lat,lng,price,deposit,originalPrice?,bedrooms,bathrooms,roomType,genderPreference?,availableFrom,availableTo,amenities,photos,status:'draft'|'active'} -> {listing:Listing}
PATCH /api/listings/:id same partial fields incl status -> {listing:Listing}. Owner only.
Roommate preference. `genderPreference` is accepted only for a private or shared room, where the lister or their roommates live in the home. A listing with `roomType` `entire` is forced to `any` on create and on update, whatever the client sends. It is public on the listing, unlike the student's own `gender`.
POST /api/uploads multipart field photos up to 8 files -> {photos:string[]}. Auth required, raster validated/reencoded, maximum 8 MB each, stored on VPS.
POST /api/listings/:id/boost {kind:'launch'} -> {listing:Listing}. Owner only, verified, listing must be active. Starts a seven day boost with price_cents 0 and sets boostUntil. 409 when a boost is still running, 409 when the free launch boost was already used on that listing. {kind:'paid'} returns 402 {error:"Payments open soon."} until Stripe is connected.
GET /api/listings/:id/boost-stats -> {views:number,requests:number,boostUntil:string|null}. Owner only. Views and requests are counted from the start of the current or most recent boost.
GET /api/saved -> {listings:Listing[]}
POST /api/saved/:listingId -> {saved:true}
DELETE /api/saved/:listingId -> {saved:false}

HandoffRequest {id,listingId,listingTitle,listingPhoto,requesterId,requesterName,ownerId,ownerName,message,status:'pending'|'accepted'|'declined'|'withdrawn',createdAt,updatedAt,contact?:{name,email},requesterGender?}
`requesterGender` is sent only to the lister, and only when the requester chose something other than `unspecified`. A roommate preference never blocks a request.
GET /api/requests -> {incoming:HandoffRequest[],outgoing:HandoffRequest[]}. Contact only after accepted and only for involved parties.
POST /api/requests {listingId,message} -> {request:HandoffRequest}. Verified users only, no self requests, duplicate active requests rejected.
PATCH /api/requests/:id {status:'accepted'|'declined'|'withdrawn'} -> {request:HandoffRequest}. Owner accepts/declines pending, requester withdraws pending.
POST /api/reports {listingId,reason,details} -> {ok:true}. Verified users only, persistent report for operator review.
GET /api/health -> {ok:true,version:string}

No seed listings in production. Separate test fixtures can populate temporary QA data directories. App root is browse, routes /browse, /listings/:id, /listings/new (the chooser, with ?mode=import, ?mode=chat and ?mode=manual), /listings/:id/edit, /saved, /requests, /my-listings, /profile, /sign-in, /sign-up, /verify?token=, /forgot-password, /reset-password?token=, /terms, /privacy.

POST /api/auth/accept-terms (needs a session) -> {user}. Records terms_accepted_at. Publishing a listing (creating as active or patching to active) and sending a handoff request return 403 until the user has accepted the terms.

GET /api/geocode?q=&campusId= (needs a session, 120 per 15 minutes) -> {results:[{line,place,lat,lng}]}. Server side proxy to the US Census geocoder for street numbers with a Nominatim fallback bounded to the campus for building names. 503 when both are unreachable.

POST /api/waitlist {school,email} -> 202. Stores interest in an unsupported campus.

Smart import. Both routes need a verified student whose campus is live, reuse the same school_not_live 403, and return 503 {error:"Smart import is being set up.",code:"ai_unavailable"} when no model is configured. Neither route creates or publishes anything. The answer is a draft the student reviews in the six step wizard, where the usual listing validation still applies. Every call is recorded in `ai_usage` (tokens only, no prompt or listing content).
ImportDraft {title,description,address,price:number|null,deposit:number|null,originalPrice:number|null,bedrooms:number|null,bathrooms:number|null,roomType,genderPreference,availableFrom,availableTo,amenities:string[],lat:number|null,lng:number|null,photos:[],pinSource?:"auto"}
POST /api/import/parse (multipart, field `text` up to 12,000 characters, field `files` with up to 4 PNG/JPG/WebP screenshots and one PDF of at most 8 MB and 20 pages, 20 per hour per student) -> {draft:ImportDraft,missing:string[],notes:string}. Screenshots are resized to 1600px and re-encoded before they leave the server. `missing` lists the required fields that came back empty or low confidence, including `photos`, which the student always adds themselves. When an address is found the server geocodes it and returns lat, lng and pinSource "auto".
POST /api/import/chat {messages:[{role:"user"|"assistant",content}],draft:ImportDraft|null} (120 per hour per student) -> {reply:string,draft:ImportDraft,missing:string[],done:boolean}. One stateless turn. The client keeps the history and the draft, the server stores neither.

Internal dashboard. Everything under `/api/admin` needs a signed in account with `is_admin`, and answers 404 (never 403) for anyone else, so the surface stays hidden. It is rate limited at 3000 calls per 15 minutes per admin. Every write inserts a row into `admin_audit` (id, admin_id, action, target_type, target_id, details JSON, created_at). Admin access is granted on the server with `node scripts/make-admin.js <email>`, never through the API's own signup. A disabled account (`users.disabled_at`) is refused at login and on every authenticated route with 403 {error:"This account is disabled."}.

GET /api/admin/overview -> {totals,usersBySchool,usersByGender,series,generatedAt}. `totals` covers users, verified users, admins, disabled users, listings and listings by status, active boosts, requests and requests by status, saved places, waitlist, open and total reports, uploads and active sessions. `series` carries 30 day daily counts for signups, listings, requests, and, when those tables exist, views and aiTokens (null when the table is absent, so the dashboard works whichever migration landed).
GET /api/admin/users?query=&school=&verified=&page=&sort= -> {users,schools,page,pageSize:25,total,pages}. `verified` takes yes, no, admin or disabled. `sort` takes created_desc, created_asc, name, email or listings. Each row carries id, name, email, school, campusId, verified, terms accepted, gender, isAdmin, disabledAt, createdAt, lastSignIn (newest session) and counts of listings, requests sent and saved places.
GET /api/admin/users/:id -> {user,listings,requestsSent,requestsReceived,sessions,boosts,audit,aiUsage}
POST /api/admin/users/:id/verify -> {ok:true,user}
POST /api/admin/users/:id/admin {on:boolean} -> {ok:true,user}. 400 when an admin tries to revoke their own access.
POST /api/admin/users/:id/disable and /enable -> {ok:true,user}. Disabling also ends every session for that account. 400 when an admin tries to disable themselves.
GET /api/admin/listings?status=&query=&page= -> {listings,page,pageSize,total,pages}. All statuses including drafts, plus boosted as a status filter. Rows carry the owner name and email, price, campus, boost window, view and request counts, and both timestamps.
GET /api/admin/listings/:id -> {listing,requests,boosts,reports,audit}
POST /api/admin/listings/:id/archive -> {ok:true}. Archives, sets the moderation lock, declines pending requests.
POST /api/admin/listings/:id/unarchive -> {ok:true}. Returns it as a draft and lifts the lock.
POST /api/admin/listings/:id/unboost -> {ok:true}
GET /api/admin/requests?status=&page= -> {requests,page,pageSize,total,pages}
GET /api/admin/reports?status=&page= -> {reports,...}
POST /api/admin/reports/:id/resolve -> {ok:true}
GET /api/admin/waitlist?page= -> {waitlist,bySchool,...}
GET /api/admin/waitlist.csv -> text/csv attachment, audited as waitlist.export.
GET /api/admin/ai-usage -> {available,perDay,perUser,totals}. `available` is false when the `ai_usage` table is not present.
GET /api/admin/audit?page= -> {audit,...}
GET /api/admin/system -> {app,database,host,storage,backups,services,journal,generatedAt}. Release id, schema version, node version, process uptime and memory, hostname, OS uptime, load average, memory, CPU count, `df -k` on the data directory, database and WAL size, uploads and logo cache size and file counts, the backups directory newest first, whether mail and AI are configured, and the last 50 journal lines. Anything the host refuses (df, journalctl, an unreadable backups path) comes back as available:false rather than failing the response.
UI route /admin with sections /admin/users, /admin/listings, /admin/requests, /admin/reports, /admin/waitlist, /admin/ai-usage, /admin/system and /admin/audit. A student who is not an admin gets the app's normal 404 page.

Verification model. Signing up or signing in works without verification. Publishing a listing, sending or answering a handoff request, and reporting need a verified student email (403 otherwise). Saving places, drafts, uploads and profile edits only need a session.
