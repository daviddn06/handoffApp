# Shared API contract

JSON requests and responses, same-origin cookies. Errors use `{error: string}` with non-2xx status. Dates are YYYY-MM-DD. Money is integer dollars per month (field `price`). All mutation endpoints await database success. Auth mutations are rate limited and enforce Origin. User email is only returned in session/profile and accepted request contacts.

GET /api/config -> {emailReady:boolean,campuses:Campus[]}
Campus {id,name,shortName,lat,lng,domain}
GET /api/session -> {user:User|null}
User {id,name,email,campusId,verified:boolean,bio:string}
POST /api/auth/signup {name,email,password,campusId} -> {message:string}. Sends verification link.
POST /api/auth/login {email,password} -> {user:User}
POST /api/auth/logout -> {ok:true}
POST /api/auth/verify {token} -> {user:User}
POST /api/auth/resend {email} -> {message:string}
POST /api/auth/forgot {email} -> {message:string}
POST /api/auth/reset {token,password} -> {message:string}
PATCH /api/profile {name,bio} -> {user:User}

Listing {id,ownerId,ownerName,campusId,title,description,address,lat,lng,price,deposit,bedrooms,bathrooms,roomType:'private'|'shared'|'entire',availableFrom,availableTo,amenities:string[],photos:string[],status:'draft'|'active'|'handed_off'|'archived',createdAt,updatedAt,saved?:boolean}
GET /api/listings?campusId=&query=&minPrice=&maxPrice=&from=&to=&roomType=&bedrooms=&amenities=&sort=newest|price_asc|price_desc -> {listings:Listing[]}. Active public listings only, no private contact data. Dates must cover the requested stay.
GET /api/listings/:id -> {listing:Listing}. Public active or owner only.
GET /api/my-listings -> {listings:Listing[]}
POST /api/listings {title,description,address,lat,lng,price,deposit,bedrooms,bathrooms,roomType,availableFrom,availableTo,amenities,photos,status:'draft'|'active'} -> {listing:Listing}
PATCH /api/listings/:id same partial fields incl status -> {listing:Listing}. Owner only.
POST /api/uploads multipart field photos up to 8 files -> {photos:string[]}. Auth required, raster validated/reencoded, maximum 8 MB each, stored on VPS.
GET /api/saved -> {listings:Listing[]}
POST /api/saved/:listingId -> {saved:true}
DELETE /api/saved/:listingId -> {saved:false}

HandoffRequest {id,listingId,listingTitle,listingPhoto,requesterId,requesterName,ownerId,ownerName,message,status:'pending'|'accepted'|'declined'|'withdrawn',createdAt,updatedAt,contact?:{name,email}}
GET /api/requests -> {incoming:HandoffRequest[],outgoing:HandoffRequest[]}. Contact only after accepted and only for involved parties.
POST /api/requests {listingId,message} -> {request:HandoffRequest}. Verified users only, no self requests, duplicate active requests rejected.
PATCH /api/requests/:id {status:'accepted'|'declined'|'withdrawn'} -> {request:HandoffRequest}. Owner accepts/declines pending, requester withdraws pending.
POST /api/reports {listingId,reason,details} -> {ok:true}. Verified users only, persistent report for operator review.
GET /api/health -> {ok:true,version:string}

No seed listings in production. Separate test fixtures can populate temporary QA data directories. App root is browse, routes /browse, /listings/:id, /listings/new, /listings/:id/edit, /saved, /requests, /my-listings, /profile, /sign-in, /sign-up, /verify?token=, /forgot-password, /reset-password?token=.
