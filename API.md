# Shared API contract

JSON requests and responses, same-origin cookies. Errors use `{error: string}` with non-2xx status. Dates are YYYY-MM-DD. Money is integer dollars per month (field `price`). All mutation endpoints await database success. Auth mutations are rate limited and enforce Origin. User email is only returned in session/profile and accepted request contacts.

GET /api/config -> {emailReady:boolean,campuses:Campus[]}
Campus {id,name,shortName,lat,lng,domain,live:boolean}
GET /api/session -> {user:User|null}
User {id,name,email,campusId:string|null,school:{name,domain,live:boolean},verified:boolean,termsAccepted:boolean,bio:string}
`campusId` is the live campus this student may post at, null when Handoff has not opened at their school. `school` is always the student's own school, taken from their email domain. Browsing, saving, requesting, reporting and the profile are open to every student either way.
POST /api/auth/signup (201 {user} and a session for a new or unverified email, 202 {user:null} when the email already has a verified account; the session is unverified until a code or link confirms it) {name,email,password} -> {message:string}. Sends verification link. There is no campus field: the server reads the school from the email domain, accepting subdomains such as alumni.usc.edu, and sets campusId to the matching live campus or null. An email whose domain is not a known US school is refused with 400 {error:"Use your school email. We could not find that school yet.",code:"school_unknown"}.
Passwords are 10 to 128 characters and must contain at least one letter and one number. They may not contain the email local part or a part of the name, and may not be one of the most common passwords. The same rules apply to POST /api/auth/reset.
POST /api/auth/login {email,password} -> {user:User}
POST /api/auth/logout -> {ok:true}
POST /api/auth/verify-code {code} (six digits from the email, needs the session, 8 tries per 15 minutes) -> {user}
POST /api/auth/verify {token} -> {user:User}
POST /api/auth/resend {email} -> {message:string}
POST /api/auth/forgot {email} -> {message:string}
POST /api/auth/reset {token,password} -> {message:string}
PATCH /api/profile {name,bio} -> {user:User}

Listing {id,ownerId,ownerName,campusId,title,description,address,lat,lng,price,deposit,originalPrice:number|null,bedrooms,bathrooms,roomType:'private'|'shared'|'entire',availableFrom,availableTo,amenities:string[],photos:string[],status:'draft'|'active'|'handed_off'|'archived',createdAt,updatedAt,boostUntil:string|null,boosted:boolean,saved?:boolean}
GET /api/listings?campusId=&query=&minPrice=&maxPrice=&from=&to=&roomType=&bedrooms=&amenities=&sort=newest|price_asc|price_desc|savings -> {listings:Listing[]}. Active public listings only, no private contact data. Dates must cover the requested stay. Boosted listings come first inside whichever sort is asked for.
GET /api/listings/:id -> {listing:Listing}. Public active or owner only. A view by anyone other than the owner is counted once per session or IP per hour.
GET /api/my-listings -> {listings:Listing[]}
Creating a listing (draft or active), publishing one, and boosting all require a non-null campusId and always use it as the listing campus, never a client value. Without one they return 403 {error:"Listing is not open at <school> yet. You can still browse, save and request anywhere Handoff is live.",code:"school_not_live"}.
POST /api/listings {title,description,address,lat,lng,price,deposit,originalPrice?,bedrooms,bathrooms,roomType,availableFrom,availableTo,amenities,photos,status:'draft'|'active'} -> {listing:Listing}
PATCH /api/listings/:id same partial fields incl status -> {listing:Listing}. Owner only.
POST /api/uploads multipart field photos up to 8 files -> {photos:string[]}. Auth required, raster validated/reencoded, maximum 8 MB each, stored on VPS.
POST /api/listings/:id/boost {kind:'launch'} -> {listing:Listing}. Owner only, verified, listing must be active. Starts a seven day boost with price_cents 0 and sets boostUntil. 409 when a boost is still running, 409 when the free launch boost was already used on that listing. {kind:'paid'} returns 402 {error:"Payments open soon."} until Stripe is connected.
GET /api/listings/:id/boost-stats -> {views:number,requests:number,boostUntil:string|null}. Owner only. Views and requests are counted from the start of the current or most recent boost.
GET /api/saved -> {listings:Listing[]}
POST /api/saved/:listingId -> {saved:true}
DELETE /api/saved/:listingId -> {saved:false}

HandoffRequest {id,listingId,listingTitle,listingPhoto,requesterId,requesterName,ownerId,ownerName,message,status:'pending'|'accepted'|'declined'|'withdrawn',createdAt,updatedAt,contact?:{name,email}}
GET /api/requests -> {incoming:HandoffRequest[],outgoing:HandoffRequest[]}. Contact only after accepted and only for involved parties.
POST /api/requests {listingId,message} -> {request:HandoffRequest}. Verified users only, no self requests, duplicate active requests rejected.
PATCH /api/requests/:id {status:'accepted'|'declined'|'withdrawn'} -> {request:HandoffRequest}. Owner accepts/declines pending, requester withdraws pending.
POST /api/reports {listingId,reason,details} -> {ok:true}. Verified users only, persistent report for operator review.
GET /api/health -> {ok:true,version:string}

No seed listings in production. Separate test fixtures can populate temporary QA data directories. App root is browse, routes /browse, /listings/:id, /listings/new, /listings/:id/edit, /saved, /requests, /my-listings, /profile, /sign-in, /sign-up, /verify?token=, /forgot-password, /reset-password?token=, /terms, /privacy.

POST /api/auth/accept-terms (needs a session) -> {user}. Records terms_accepted_at. Publishing a listing (creating as active or patching to active) and sending a handoff request return 403 until the user has accepted the terms.

GET /api/geocode?q=&campusId= (needs a session, 120 per 15 minutes) -> {results:[{line,place,lat,lng}]}. Server side proxy to the US Census geocoder for street numbers with a Nominatim fallback bounded to the campus for building names. 503 when both are unreachable.

POST /api/waitlist {school,email} -> 202. Stores interest in an unsupported campus.

Verification model. Signing up or signing in works without verification. Publishing a listing, sending or answering a handoff request, and reporting need a verified student email (403 otherwise). Saving places, drafts, uploads and profile edits only need a session.
