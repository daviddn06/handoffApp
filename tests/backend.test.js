import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { hashToken } from "../server/security.js";

const PASSWORD = "Correct horse battery 572!";
// The dashboard allow list. The flag alone never opens /api/admin.
process.env.HANDOFF_ADMIN_EMAILS = "Operator.Case@usc.edu , team.two@usc.edu";
const ORIGIN = "http://127.0.0.1:4741";
const validListing = (photos = [], overrides = {}) => ({
  title: "Sunny private room near campus",
  description:
    "A quiet furnished bedroom with plenty of daylight, shared kitchen, and laundry in the building.",
  address: "West 30th Street, Los Angeles",
  lat: 34.026,
  lng: -118.287,
  price: 1200,
  deposit: 600,
  bedrooms: 1,
  bathrooms: 1,
  roomType: "private",
  availableFrom: "2099-01-01",
  availableTo: "2099-06-30",
  originalPrice: null,
  amenities: ["Furnished", "Laundry"],
  photos,
  status: "active",
  ...overrides,
});

async function setup(t, overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
  const messages = [];
  let failMail = false;
  const mailTransport = {
    sendMail: async (message) => {
      if (failMail) throw new Error("Simulated SMTP outage");
      messages.push(message);
      return { accepted: [message.to], rejected: [], messageId: "captured" };
    },
  };
  const app = createApp({
    dataDir,
    mailTransport,
    origin: ORIGIN,
    ...overrides,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const client = () => {
    let cookie = "";
    // "internal" sends the header Caddy adds on internal.handofflease.com.
    let surface = "";
    return {
      get cookie() {
        return cookie;
      },
      set cookie(value) {
        cookie = value;
      },
      get surface() {
        return surface;
      },
      set surface(value) {
        surface = value;
      },
      async call(
        path,
        { method = "GET", body, headers = {}, raw = false } = {},
      ) {
        const isForm = body instanceof FormData;
        const res = await fetch(url + path, {
          method,
          headers: {
            ...(!["GET", "HEAD"].includes(method)
              ? { Origin: overrides.origin || ORIGIN }
              : {}),
            ...(surface ? { "X-Handoff-Surface": surface } : {}),
            ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
          body:
            body === undefined
              ? undefined
              : isForm
                ? body
                : JSON.stringify(body),
        });
        const cookieHeader = res.headers.get("set-cookie");
        if (cookieHeader) cookie = cookieHeader.split(";")[0];
        const data = raw
          ? Buffer.from(await res.arrayBuffer())
          : await res.json();
        return { status: res.status, body: data, headers: res.headers };
      },
    };
  };
  const tokenFor = (address, kind = "verify") => {
    const message = messages
      .filter(
        (item) =>
          item.to === address &&
          item.text.includes(
            kind === "verify" ? "/verify?" : "/reset-password?",
          ),
      )
      .at(-1);
    assert.ok(message, `Expected a captured ${kind} email`);
    return new URL(
      message.text.split("\n").find((line) => line.startsWith("http")),
    ).searchParams.get("token");
  };
  const signup = async (address, name = "Test Student") => {
    const user = client();
    const result = await user.call("/api/auth/signup", {
      method: "POST",
      body: { name, email: address, password: PASSWORD },
    });
    assert.ok(
      [201, 202].includes(result.status),
      JSON.stringify(result.body),
    );
    return user;
  };
  const verified = async (address, name = "Test Student") => {
    const user = await signup(address, name);
    const result = await user.call("/api/auth/verify", {
      method: "POST",
      body: { token: tokenFor(address) },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    user.id = result.body.user.id;
    const terms = await user.call("/api/auth/accept-terms", { method: "POST" });
    assert.equal(terms.status, 200);
    assert.equal(terms.body.user.termsAccepted, true);
    return user;
  };
  const upload = async (user) => {
    const bytes = await sharp({
      create: { width: 200, height: 180, channels: 3, background: "#91b4e6" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "Private EXIF author" } } })
      .toBuffer();
    const form = new FormData();
    form.append(
      "photos",
      new Blob([bytes], { type: "image/jpeg" }),
      "room.jpg",
    );
    const result = await user.call("/api/uploads", {
      method: "POST",
      body: form,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.photos;
  };
  const publish = async (user, overrides = {}) => {
    const photos = await upload(user);
    const result = await user.call("/api/listings", {
      method: "POST",
      body: validListing(photos, overrides),
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.listing;
  };
  return {
    app,
    server,
    url,
    dataDir,
    messages,
    client,
    signup,
    verified,
    tokenFor,
    upload,
    publish,
    setMailFailure: (value) => {
      failMail = value;
    },
  };
}

test("verified student lifecycle, one-use tokens, private hashes, reset invalidates all sessions", async (t) => {
  const env = await setup(t);
  const alice = await env.signup("alice@usc.edu", "Alice Student");
  const verifyToken = env.tokenFor("alice@usc.edu");
  // A fresh signup is signed in right away, but not yet verified.
  assert.equal((await alice.call("/api/session")).body.user.verified, false);
  const unverifiedLogin = await alice.call("/api/auth/login", {
    method: "POST",
    body: { email: "alice@usc.edu", password: PASSWORD },
  });
  assert.equal(unverifiedLogin.status, 200);
  assert.equal(unverifiedLogin.body.user.verified, false);
  assert.equal((await alice.call("/api/my-listings")).status, 200);
  assert.equal(
    (
      await alice.call("/api/listings", {
        method: "POST",
        body: validListing([], { status: "active" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await alice.call("/api/requests", {
        method: "POST",
        body: { listingId: "00000000-0000-4000-8000-000000000000", message: "Hi" },
      })
    ).status,
    403,
  );
  const verified = await alice.call("/api/auth/verify", {
    method: "POST",
    body: { token: verifyToken },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.verified, true);
  assert.match(verified.headers.get("set-cookie"), /HttpOnly/);
  assert.match(verified.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal(
    (
      await alice.call("/api/auth/verify", {
        method: "POST",
        body: { token: verifyToken },
      })
    ).status,
    400,
  );
  const dbUser = env.app.locals.db.prepare("SELECT * FROM users").get();
  assert.notEqual(dbUser.password_hash, PASSWORD);
  assert.match(dbUser.password_hash, /^scrypt\$/);
  assert.equal(
    env.app.locals.db.prepare("SELECT token_hash FROM auth_tokens").get()
      .token_hash,
    hashToken(verifyToken),
  );
  assert.ok(!JSON.stringify(verified.body).includes("password"));
  assert.ok(
    !env.app.locals.db
      .prepare("SELECT token_hash FROM sessions")
      .get()
      .token_hash.includes(alice.cookie.split("=")[1]),
  );

  const secondSession = env.client();
  assert.equal(
    (
      await secondSession.call("/api/auth/login", {
        method: "POST",
        body: { email: " ALICE@USC.EDU ", password: PASSWORD },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await alice.call("/api/profile", {
        method: "PATCH",
        body: { name: "Alice Nguyen", bio: "Student at USC" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await alice.call("/api/profile", {
        method: "PATCH",
        body: { name: "Alice Nguyen", bio: "", verified: true },
      })
    ).status,
    400,
  );
  const forgot = await env
    .client()
    .call("/api/auth/forgot", {
      method: "POST",
      body: { email: "alice@usc.edu" },
    });
  assert.equal(forgot.status, 202);
  const resetToken = env.tokenFor("alice@usc.edu", "reset");
  const reset = await env
    .client()
    .call("/api/auth/reset", {
      method: "POST",
      body: { token: resetToken, password: "New secure password 764!" },
    });
  assert.equal(reset.status, 200);
  assert.equal((await alice.call("/api/session")).body.user, null);
  assert.equal((await secondSession.call("/api/session")).body.user, null);
  assert.equal(
    (
      await env
        .client()
        .call("/api/auth/reset", {
          method: "POST",
          body: { token: resetToken, password: PASSWORD },
        })
    ).status,
    400,
  );
  assert.equal(
    (
      await alice.call("/api/auth/login", {
        method: "POST",
        body: { email: "alice@usc.edu", password: PASSWORD },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await alice.call("/api/auth/login", {
        method: "POST",
        body: { email: "alice@usc.edu", password: "New secure password 764!" },
      })
    ).status,
    200,
  );
  const staleCookie = alice.cookie;
  assert.equal(
    (await alice.call("/api/auth/logout", { method: "POST" })).status,
    200,
  );
  alice.cookie = staleCookie;
  assert.equal((await alice.call("/api/session")).body.user, null);
});

test("a six digit code from the email verifies the signed in student, wrong codes do not", async (t) => {
  const env = await setup(t);
  const sam = await env.signup("sam@usc.edu", "Sam Student");
  const message = env.messages.findLast((m) => m.to === "sam@usc.edu");
  const code = message.text.match(/code is (\d{6})/)[1];
  assert.equal(
    (
      await sam.call("/api/auth/verify-code", {
        method: "POST",
        body: { code: code === "000000" ? "000001" : "000000" },
      })
    ).status,
    400,
  );
  const ok = await sam.call("/api/auth/verify-code", {
    method: "POST",
    body: { code },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.verified, true);
  assert.equal((await sam.call("/api/session")).body.user.verified, true);
  assert.equal(
    (await sam.call("/api/auth/verify-code", { method: "POST", body: { code } }))
      .status,
    200,
  );
  assert.equal(
    (
      await env.client().call("/api/auth/verify", {
        method: "POST",
        body: { token: env.tokenFor("sam@usc.edu") },
      })
    ).status,
    400,
  );
});

test("publishing needs the terms accepted once, drafts do not", async (t) => {
  const env = await setup(t);
  const owner = await env.signup("terms@usc.edu", "Terms Student");
  await owner.call("/api/auth/verify", {
    method: "POST",
    body: { token: env.tokenFor("terms@usc.edu") },
  });
  const photos = await env.upload(owner);
  const draft = await owner.call("/api/listings", {
    method: "POST",
    body: validListing(photos, { status: "draft" }),
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const publish = await owner.call(`/api/listings/${draft.body.listing.id}`, {
    method: "PATCH",
    body: { status: "active" },
  });
  assert.equal(publish.status, 403);
  assert.match(publish.body.error, /Terms of Service/);
  assert.equal((await owner.call("/api/auth/accept-terms", { method: "POST" })).status, 200);
  assert.equal(
    (
      await owner.call(`/api/listings/${draft.body.listing.id}`, {
        method: "PATCH",
        body: { status: "active" },
      })
    ).status,
    200,
  );
});

test("waitlist takes an email for an unsupported school once", async (t) => {
  const env = await setup(t);
  const body = { email: "sam@stanford.edu", school: "Stanford University", domain: "stanford.edu" };
  const first = await env.client().call("/api/waitlist", { method: "POST", body });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  await env.client().call("/api/waitlist", { method: "POST", body });
  assert.equal(env.app.locals.db.prepare("SELECT COUNT(*) AS c FROM waitlist").get().c, 1);
  assert.equal(
    (await env.client().call("/api/waitlist", { method: "POST", body: { email: "nope", school: "X" } })).status,
    400,
  );
});

test("school logos are served from the disk cache, bad hostnames and misses are 404", async (t) => {
  const env = await setup(t);
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#990000" },
  })
    .png()
    .toBuffer();
  await writeFile(join(env.dataDir, "logos", "usc.edu.png"), png);
  await writeFile(join(env.dataDir, "logos", "nologo.edu.none"), "");
  const hit = await env.client().call("/api/logo/usc.edu", { raw: true });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("content-type"), "image/png");
  assert.equal(hit.headers.get("cache-control"), "public, max-age=604800");
  assert.ok(hit.body.equals(png));
  assert.equal((await env.client().call("/api/logo/nologo.edu")).status, 404);
  for (const bad of ["not-a-host", "..", "usc.edu%2F..%2Fx"])
    assert.equal((await env.client().call(`/api/logo/${bad}`)).status, 404);
});

test("two-student workflow preserves ownership and hides contacts until acceptance", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("owner@usc.edu", "Olivia Owner");
  const renter = await env.verified("renter@usc.edu", "Riley Renter");
  const outsider = await env.verified("outsider@usc.edu", "Other Student");
  const publicClient = env.client();
  const listing = await env.publish(owner);
  const browse = await publicClient.call("/api/listings");
  assert.equal(browse.body.listings.length, 1);
  assert.ok(!JSON.stringify(browse.body).includes("@usc.edu"));
  assert.equal(
    (
      await outsider.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { title: "Changed by someone else" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await publicClient.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { status: "archived" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await owner.call("/api/requests", {
        method: "POST",
        body: { listingId: listing.id, message: "Can I request my own place?" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await renter.call(`/api/saved/${listing.id}`, { method: "POST" })).status,
    200,
  );
  assert.equal(
    (await renter.call("/api/saved")).body.listings[0].id,
    listing.id,
  );
  assert.equal((await owner.call("/api/saved")).body.listings.length, 0);

  const created = await renter.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "Hi, I am looking for a room for the spring semester.",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.notification.emailSent, true);
  const requestId = created.body.request.id;
  assert.equal(created.body.request.contact, undefined);
  assert.equal(
    (
      await renter.call("/api/requests", {
        method: "POST",
        body: {
          listingId: listing.id,
          message: "A duplicate request for the same place.",
        },
      })
    ).status,
    409,
  );
  const inbox = await owner.call("/api/requests");
  assert.equal(inbox.body.incoming.length, 1);
  assert.ok(!JSON.stringify(inbox.body).includes("renter@usc.edu"));
  assert.deepEqual((await outsider.call("/api/requests")).body, {
    incoming: [],
    outgoing: [],
  });
  assert.equal(
    (
      await outsider.call(`/api/requests/${requestId}`, {
        method: "PATCH",
        body: { status: "accepted" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await renter.call(`/api/requests/${requestId}`, {
        method: "PATCH",
        body: { status: "accepted" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.call(`/api/requests/${requestId}`, {
        method: "PATCH",
        body: { status: "withdrawn" },
      })
    ).status,
    403,
  );
  const accepted = await owner.call(`/api/requests/${requestId}`, {
    method: "PATCH",
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.request.contact.email, "renter@usc.edu");
  assert.equal(
    (await renter.call("/api/requests")).body.outgoing[0].contact.email,
    "owner@usc.edu",
  );
  assert.equal(
    (
      await outsider.call(`/api/requests/${requestId}`, {
        method: "PATCH",
        body: { status: "declined" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await renter.call(`/api/requests/${requestId}`, {
        method: "PATCH",
        body: { status: "withdrawn" },
      })
    ).status,
    409,
  );
  assert.ok(
    !JSON.stringify(
      (await publicClient.call(`/api/listings/${listing.id}`)).body,
    ).includes("@usc.edu"),
  );

  const report = await renter.call("/api/reports", {
    method: "POST",
    body: {
      listingId: listing.id,
      reason: "Incorrect details",
      details: "Please check the advertised room size.",
    },
  });
  assert.equal(report.status, 201);
  assert.equal(
    env.app.locals.db.prepare("SELECT details FROM reports").get().details,
    "Please check the advertised room size.",
  );
  assert.equal((await publicClient.call("/api/reports")).status, 404);
  assert.equal(
    (
      await renter.call("/api/reports", {
        method: "POST",
        body: { listingId: listing.id, reason: "Duplicate report" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { status: "handed_off" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await publicClient.call("/api/listings")).body.listings.length,
    0,
  );
  assert.equal(
    (await publicClient.call(`/api/listings/${listing.id}`)).status,
    404,
  );
  const retained = await owner.call(`/api/listings/${listing.id}`);
  assert.equal(retained.status, 200);
  assert.equal(retained.body.listing.title, listing.title);
  assert.equal(retained.body.listing.price, listing.price);
  assert.deepEqual(retained.body.listing.photos, listing.photos);
  assert.equal((await renter.call("/api/saved")).body.listings.length, 0);
  assert.equal(
    (await renter.call("/api/requests")).body.outgoing[0].contact.email,
    "owner@usc.edu",
  );
  assert.equal(
    (await renter.call(listing.photos[0], { raw: true })).status,
    200,
  );
  assert.equal(
    (await outsider.call(listing.photos[0], { raw: true })).status,
    404,
  );
});

test("drafts stay private, photos are reencoded and ownership is enforced", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("photos@usc.edu");
  const thief = await env.verified("thief@usc.edu");
  const photos = await env.upload(owner);
  const photoBytes = await readFile(join(env.dataDir, photos[0]));
  const metadata = await sharp(photoBytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.ok(!photoBytes.toString().includes("Private EXIF author"));
  assert.equal((await env.client().call(photos[0], { raw: true })).status, 404);
  assert.equal((await thief.call(photos[0], { raw: true })).status, 404);
  assert.equal((await owner.call(photos[0], { raw: true })).status, 200);
  assert.equal(
    (
      await thief.call("/api/listings", {
        method: "POST",
        body: validListing(photos),
      })
    ).status,
    400,
  );
  const draft = await owner.call("/api/listings", {
    method: "POST",
    body: { lat: 34.0224, lng: -118.2851, photos, status: "draft" },
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.listing.title, "");
  const id = draft.body.listing.id;
  assert.equal((await env.client().call(`/api/listings/${id}`)).status, 404);
  assert.equal((await thief.call(`/api/listings/${id}`)).status, 404);
  assert.equal((await owner.call("/api/my-listings")).body.listings.length, 1);
  assert.equal(
    (
      await owner.call(`/api/listings/${id}`, {
        method: "PATCH",
        body: { status: "active" },
      })
    ).status,
    400,
  );
  const published = await owner.call(`/api/listings/${id}`, {
    method: "PATCH",
    body: validListing(photos),
  });
  assert.equal(published.status, 200);
  assert.equal(
    (await env.client().call(photos[0], { raw: true })).headers.get(
      "content-type",
    ),
    "image/webp",
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${id}`, {
        method: "PATCH",
        body: { ownerId: thief.id },
      })
    ).status,
    400,
  );
  const fakeImage = new FormData();
  fakeImage.append(
    "photos",
    new Blob(
      [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ],
      { type: "image/jpeg" },
    ),
    "room.jpg",
  );
  assert.equal(
    (await owner.call("/api/uploads", { method: "POST", body: fakeImage }))
      .status,
    400,
  );
  const hugeFile = new FormData();
  hugeFile.append(
    "photos",
    new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
    "large.jpg",
  );
  assert.equal(
    (await owner.call("/api/uploads", { method: "POST", body: hugeFile }))
      .status,
    400,
  );
  assert.equal(
    (
      await owner.call("/api/listings", {
        method: "POST",
        body: validListing(["https://evil.example/image.png"]),
      })
    ).status,
    400,
  );
  assert.equal(
    (await env.client().call("/uploads/%2e%2e%2fhandoff.sqlite", { raw: true }))
      .status,
    404,
  );
});

test("search filters cover dates, reject injection, and prevent requests for expired listings", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("searchowner@usc.edu");
  const renter = await env.verified("searchrenter@usc.edu");
  const listing = await env.publish(owner);
  const checks = [
    [
      "campusId=usc&from=2099-02-01&to=2099-05-01&amenities=Furnished,Laundry&minPrice=1000&maxPrice=1300&bedrooms=1&roomType=private",
      1,
    ],
    ["campusId=ucla", 0],
    ["from=2098-12-01", 0],
    ["from=2099-07-01", 0],
    ["to=2098-12-31", 0],
    ["to=2099-07-01", 0],
    ["query=Sunny", 1],
    ["query=%25", 0],
    ["query=%27%20OR%201%3D1%20--", 0],
    ["minPrice=1300", 0],
    ["amenities=Parking", 0],
  ];
  for (const [query, expected] of checks) {
    const result = await env.client().call(`/api/listings?${query}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.listings.length, expected, query);
  }
  assert.equal(
    (
      await env
        .client()
        .call("/api/listings?sort=price_asc%3BDROP%20TABLE%20users")
    ).status,
    400,
  );
  const cheaper = await env.publish(owner, {
    title: "Below lease room",
    price: 900,
    originalPrice: 1200,
  });
  assert.equal(cheaper.originalPrice, 1200);
  const bySavings = await env.client().call("/api/listings?sort=savings");
  assert.equal(bySavings.status, 200);
  assert.equal(bySavings.body.listings[0].id, cheaper.id);
  assert.equal(bySavings.body.listings[1].originalPrice, null);
  assert.equal(
    (
      await owner.call("/api/listings", {
        method: "POST",
        body: validListing([], { originalPrice: 99999 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${cheaper.id}`, {
        method: "PATCH",
        body: { status: "archived" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await env.client().call("/api/listings?from=2099-02-30")).status,
    400,
  );
  assert.equal(
    (await env.client().call("/api/listings?minPrice=2000&maxPrice=1000"))
      .status,
    400,
  );
  assert.equal(
    (await env.client().call("/api/listings?from=2099-04-01&to=2099-03-01"))
      .status,
    400,
  );
  const created = await renter.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "I would like to stay next semester.",
    },
  });
  env.app.locals.db
    .prepare("UPDATE listings SET available_from=?,available_to=? WHERE id=?")
    .run("2000-01-01", "2000-06-30", listing.id);
  assert.equal(
    (await env.client().call("/api/listings")).body.listings.length,
    0,
  );
  assert.equal(
    (await env.client().call(`/api/listings/${listing.id}`)).status,
    404,
  );
  assert.equal((await owner.call(`/api/listings/${listing.id}`)).status, 200);
  assert.equal(
    (
      await owner.call(`/api/requests/${created.body.request.id}`, {
        method: "PATCH",
        body: { status: "accepted" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await renter.call("/api/requests", {
        method: "POST",
        body: {
          listingId: listing.id,
          message: "Trying another request for expired listing.",
        },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await renter.call(`/api/requests/${created.body.request.id}`, {
        method: "PATCH",
        body: { status: "withdrawn" },
      })
    ).status,
    200,
  );
});

test("cross-origin, campus validation, expired tokens and durable rate limits are enforced", async (t) => {
  const env = await setup(t);
  const user = env.client();
  const signup = {
    name: "Student Name",
    email: "student@usc.edu",
    password: PASSWORD,
  };
  assert.equal(
    (
      await user.call("/api/auth/signup", {
        method: "POST",
        body: signup,
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await user.call("/api/auth/signup", {
        method: "POST",
        body: signup,
        headers: { Origin: "" },
      })
    ).status,
    403,
  );
  assert.equal(
    env.app.locals.db.prepare("SELECT count(*) AS count FROM users").get()
      .count,
    0,
  );
  // A school Handoff does not recognise at all is turned away with the
  // waitlist message. A school it does know is welcome, live or not.
  for (const wrong of [
    "student@gmail.com",
    "student@usc.edu.evil.example",
    "student@evilusc.edu",
  ]) {
    const refused = await user.call("/api/auth/signup", {
      method: "POST",
      body: { ...signup, email: wrong },
    });
    assert.equal(refused.status, 400, wrong);
    assert.equal(refused.body.code, "school_unknown", wrong);
  }
  const account = await env.signup("student@marshall.usc.edu");
  const expired = env.tokenFor("student@marshall.usc.edu");
  env.app.locals.db
    .prepare("UPDATE auth_tokens SET expires_at=? WHERE token_hash=?")
    .run(Date.now() - 1, hashToken(expired));
  assert.equal(
    (
      await account.call("/api/auth/verify", {
        method: "POST",
        body: { token: expired },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await account.call("/api/auth/resend", {
        method: "POST",
        body: { email: "student@marshall.usc.edu" },
      })
    ).status,
    202,
  );
  const fresh = env.tokenFor("student@marshall.usc.edu");
  assert.notEqual(fresh, expired);
  assert.equal(
    (
      await account.call("/api/auth/verify", {
        method: "POST",
        body: { token: fresh },
      })
    ).status,
    200,
  );
  for (let i = 0; i < 12; i++)
    assert.equal(
      (
        await user.call("/api/auth/login", {
          method: "POST",
          body: { email: "nobody@usc.edu", password: "incorrect password" },
        })
      ).status,
      401,
    );
  const blocked = await user.call("/api/auth/login", {
    method: "POST",
    body: { email: "nobody@usc.edu", password: "incorrect password" },
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.ok(
    env.app.locals.db
      .prepare("SELECT count(*) AS count FROM rate_limits WHERE count>=12")
      .get().count > 0,
  );
});

test("unconfigured and failed email never claim success; requests survive notification failure", async (t) => {
  const noMail = await setup(t, { mailTransport: null });
  assert.equal(
    (await noMail.client().call("/api/config")).body.emailReady,
    false,
  );
  assert.equal(
    (
      await noMail
        .client()
        .call("/api/auth/signup", {
          method: "POST",
          body: {
            name: "Student",
            email: "nomail@usc.edu",
            password: PASSWORD,
          },
        })
    ).status,
    503,
  );
  assert.equal(
    noMail.app.locals.db.prepare("SELECT count(*) AS count FROM users").get()
      .count,
    0,
  );
  const env = await setup(t);
  env.setMailFailure(true);
  const failedSignup = await env
    .client()
    .call("/api/auth/signup", {
      method: "POST",
      body: {
        name: "Mail Fail",
        email: "mailfail@usc.edu",
        password: PASSWORD,
      },
    });
  assert.equal(failedSignup.status, 503);
  assert.equal(
    env.app.locals.db.prepare("SELECT verified_at FROM users").get()
      .verified_at,
    null,
  );
  assert.ok(
    env.app.locals.db.prepare("SELECT consumed_at FROM auth_tokens").get()
      .consumed_at,
  );
  env.setMailFailure(false);
  const owner = await env.verified("notifyowner@usc.edu");
  const renter = await env.verified("notifyrenter@usc.edu");
  const listing = await env.publish(owner);
  env.setMailFailure(true);
  const created = await renter.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "Looking for a place next semester.",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.notification.emailSent, false);
  assert.equal((await owner.call("/api/requests")).body.incoming.length, 1);
  const accepted = await owner.call(
    `/api/requests/${created.body.request.id}`,
    { method: "PATCH", body: { status: "accepted" } },
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.notification.emailSent, false);
  assert.equal(
    (await renter.call("/api/requests")).body.outgoing[0].contact.email,
    "notifyowner@usc.edu",
  );
});

test("secure host cookies and database persistence survive restart", async (t) => {
  const env = await setup(t, { origin: "https://app.handofflease.com" });
  const owner = await env.verified("persist@usc.edu");
  const listing = await env.publish(owner);
  assert.match(owner.cookie, /^__Host-handoff_session=/);
  const login = await env
    .client()
    .call("/api/auth/login", {
      method: "POST",
      body: { email: "persist@usc.edu", password: PASSWORD },
    });
  assert.match(login.headers.get("set-cookie"), /; Secure/);
  assert.equal(login.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    login.headers.get("content-security-policy"),
    /frame-ancestors 'self' https:\/\/handofflease\.com https:\/\/www\.handofflease\.com/,
  );
  assert.equal(login.headers.get("cache-control"), "no-store");
  const reopened = createApp({
    dataDir: env.dataDir,
    mailTransport: null,
    origin: "https://app.handofflease.com",
  });
  t.after(() => reopened.locals.close());
  assert.equal(
    reopened.locals.db
      .prepare("SELECT title FROM listings WHERE id=?")
      .get(listing.id).title,
    listing.title,
  );
  assert.equal(
    reopened.locals.db.prepare("SELECT count(*) AS count FROM sessions").get()
      .count,
    2,
  );
  assert.equal(reopened.locals.db.pragma("user_version", { simple: true }), 12);
  assert.throws(
    () =>
      createApp({
        dataDir: env.dataDir,
        origin: "http://app.handofflease.com",
      }),
    /HTTPS/,
  );
});

test("an abandoned unverified registration can be taken over, a live one cannot", async (t) => {
  const env = await setup(t);
  const attackerPassword = "Quiet lantern parade 867";
  const victimPassword = "Copper harbor lantern 915";
  const attacker = env.client();
  assert.equal(
    (
      await attacker.call("/api/auth/signup", {
        method: "POST",
        body: {
          name: "Attacker Name",
          email: "student@usc.edu",
          password: attackerPassword,
        },
      })
    ).status,
    201,
  );
  const attackerToken = env.tokenFor("student@usc.edu");
  assert.equal((await attacker.call("/api/session")).body.user.verified, false);
  const victim = env.client();
  // While that registration is fresh and in use, nobody signs up over it.
  const refused = await victim.call("/api/auth/signup", {
    method: "POST",
    body: {
      name: "Actual Student",
      email: "student@usc.edu",
      password: victimPassword,
    },
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, "account_exists");
  assert.match(refused.body.error, /already has an account/);
  // Abandon it: nobody verified, nobody signed in, and a day has passed.
  const db = env.app.locals.db;
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE users SET created_at=? WHERE email=?").run(
    stale,
    "student@usc.edu",
  );
  db.prepare("DELETE FROM sessions").run();
  assert.equal(
    (
      await victim.call("/api/auth/signup", {
        method: "POST",
        body: {
          name: "Actual Student",
          email: "student@usc.edu",
          password: victimPassword,
        },
      })
    ).status,
    201,
  );
  const victimToken = env.tokenFor("student@usc.edu");
  assert.notEqual(victimToken, attackerToken);
  // The attacker's pre-verification session is gone once the real student signs up.
  assert.equal((await attacker.call("/api/session")).body.user, null);
  assert.equal(
    (
      await attacker.call("/api/auth/verify", {
        method: "POST",
        body: { token: attackerToken },
      })
    ).status,
    400,
  );
  const verified = await victim.call("/api/auth/verify", {
    method: "POST",
    body: { token: victimToken },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.name, "Actual Student");
  assert.equal(
    (
      await attacker.call("/api/auth/login", {
        method: "POST",
        body: { email: "student@usc.edu", password: attackerPassword },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await victim.call("/api/auth/login", {
        method: "POST",
        body: { email: "student@usc.edu", password: victimPassword },
      })
    ).status,
    200,
  );
  const again = await attacker.call("/api/auth/signup", {
    method: "POST",
    body: {
      name: "Attacker Name",
      email: "student@usc.edu",
      password: attackerPassword,
    },
  });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.code, "account_exists");
  assert.equal(
    (
      await victim.call("/api/auth/login", {
        method: "POST",
        body: { email: "student@usc.edu", password: victimPassword },
      })
    ).status,
    200,
  );
  assert.equal(
    (await victim.call("/api/session")).body.user.name,
    "Actual Student",
  );
});

test("a concurrent old-password login cannot survive a completed password reset", async (t) => {
  const env = await setup(t);
  const student = await env.verified("concurrent@usc.edu");
  await student.call("/api/auth/forgot", {
    method: "POST",
    body: { email: "concurrent@usc.edu" },
  });
  const oldPasswordClient = env.client();
  const [reset, oldLogin] = await Promise.all([
    env
      .client()
      .call("/api/auth/reset", {
        method: "POST",
        body: {
          token: env.tokenFor("concurrent@usc.edu", "reset"),
          password: "Brand new password 249!",
        },
      }),
    oldPasswordClient.call("/api/auth/login", {
      method: "POST",
      body: { email: "concurrent@usc.edu", password: PASSWORD },
    }),
  ]);
  assert.equal(reset.status, 200);
  assert.ok([200, 401].includes(oldLogin.status));
  // A login that finished earlier is revoked; a login that finishes later must reject stale credentials.
  assert.equal((await oldPasswordClient.call("/api/session")).body.user, null);
  assert.equal(
    env.app.locals.db.prepare("SELECT count(*) AS count FROM sessions").get()
      .count,
    0,
  );
});

test("operator moderation cannot be bypassed by owner updates and can be explicitly unlocked", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("moderation@usc.edu");
  const renter = await env.verified("reporter@usc.edu");
  const listing = await env.publish(owner);
  await renter.call("/api/reports", {
    method: "POST",
    body: {
      listingId: listing.id,
      reason: "Potential scam",
      details: "Please review the rental details.",
    },
  });
  await renter.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "Please share more information about the room.",
    },
  });
  const execute = (args) =>
    promisify(execFile)(process.execPath, ["server/operator.js", ...args], {
      env: { ...process.env, HANDOFF_DATA_DIR: env.dataDir },
    });
  const openReports = await execute(["reports"]);
  const report = JSON.parse(openReports.stdout)[0];
  assert.equal(report.listing_id, listing.id);
  await execute(["archive-listing", listing.id]);
  assert.equal(
    (await env.client().call("/api/listings")).body.listings.length,
    0,
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { status: "active" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { moderation_locked: 0 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: {
          status: "draft",
          description:
            "Corrected room description that should be reviewed again.",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { status: "active" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await renter.call("/api/requests")).body.outgoing[0].status,
    "declined",
  );
  await execute(["resolve-report", report.id]);
  assert.deepEqual(JSON.parse((await execute(["reports"])).stdout), []);
  assert.equal(
    JSON.parse((await execute(["reports", "all"])).stdout).length,
    1,
  );
  await execute(["unlock-listing", listing.id]);
  assert.equal(
    (
      await owner.call(`/api/listings/${listing.id}`, {
        method: "PATCH",
        body: { status: "active" },
      })
    ).status,
    200,
  );
});

test("photo concurrency admission occurs before body buffering and releases aborted slots", async (t) => {
  const env = await setup(t);
  const first = await env.verified("firstupload@usc.edu");
  const second = await env.verified("secondupload@usc.edu");
  const third = await env.verified("thirdupload@usc.edu");
  const holdUpload = async (client) => {
    const incomingRequest = new Promise((resolve) =>
      env.server.once("request", resolve),
    );
    const request = httpRequest(`${env.url}/api/uploads`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: client.cookie,
        "Content-Type": "multipart/form-data; boundary=handoff-test-boundary",
      },
    });
    request.on("error", () => {});
    request.flushHeaders();
    request.write(
      '--handoff-test-boundary\r\nContent-Disposition: form-data; name="photos"; filename="room.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
    );
    const incoming = await incomingRequest;
    return { request, incoming };
  };
  const firstUpload = await holdUpload(first);
  const busyAccount = await first.call("/api/uploads", {
    method: "POST",
    body: new FormData(),
  });
  assert.equal(busyAccount.status, 429);
  const secondUpload = await holdUpload(second);
  const globalBusy = await third.call("/api/uploads", {
    method: "POST",
    body: new FormData(),
  });
  assert.equal(globalBusy.status, 429);
  assert.equal(globalBusy.headers.get("retry-after"), "5");
  const aborted = Promise.all(
    [firstUpload, secondUpload].map(
      ({ incoming }) =>
        new Promise((resolve) => incoming.once("aborted", resolve)),
    ),
  );
  firstUpload.request.destroy();
  secondUpload.request.destroy();
  await aborted;
  assert.equal((await env.upload(third)).length, 1);
});

test("version one upgrade makes a consistent backup before preserving data in schema two", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "handoff-migrate-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initial = createApp({ dataDir, mailTransport: null, origin: ORIGIN });
  initial.locals.db.exec(
    "ALTER TABLE listings DROP COLUMN moderation_locked; ALTER TABLE listings DROP COLUMN original_price; DROP TABLE waitlist; ALTER TABLE users DROP COLUMN terms_accepted_at; PRAGMA user_version=1;",
  );
  initial.locals.db
    .prepare(
      "INSERT INTO users(id,name,email,campus_id,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "migration-test",
      "Preserved Student",
      "preserved@usc.edu",
      "usc",
      "unusable-test-hash",
      "2026-09-14",
      "2026-09-14",
    );
  initial.locals.close();
  const migrated = createApp({ dataDir, mailTransport: null, origin: ORIGIN });
  try {
    assert.equal(
      migrated.locals.db.pragma("user_version", { simple: true }),
      12,
    );
    assert.equal(
      migrated.locals.db.prepare("SELECT name FROM users").get().name,
      "Preserved Student",
    );
    const files = (await readdir(join(dataDir, "backups"))).sort();
    assert.equal(files.length, 3);
    assert.match(files[0], /^before-schema-2-/);
    assert.match(files[1], /^before-schema-3-/);
    assert.match(files[2], /^before-schema-7-/);
    assert.ok(
      migrated.locals.db
        .prepare("SELECT name FROM sqlite_master WHERE name='waitlist'")
        .get(),
    );
    const backup = new Database(join(dataDir, "backups", files[0]), {
      readonly: true,
    });
    assert.equal(backup.pragma("user_version", { simple: true }), 1);
    assert.equal(
      backup.prepare("SELECT name FROM users").get().name,
      "Preserved Student",
    );
    backup.close();
  } finally {
    migrated.locals.close();
  }
});

test("expired password reset tokens and cross-purpose tokens cannot change accounts", async (t) => {
  const env = await setup(t);
  const student = await env.verified("expiredreset@usc.edu");
  await student.call("/api/auth/forgot", {
    method: "POST",
    body: { email: "expiredreset@usc.edu" },
  });
  const resetToken = env.tokenFor("expiredreset@usc.edu", "reset");
  assert.equal(
    (
      await student.call("/api/auth/verify", {
        method: "POST",
        body: { token: resetToken },
      })
    ).status,
    400,
  );
  env.app.locals.db
    .prepare("UPDATE auth_tokens SET expires_at=? WHERE token_hash=?")
    .run(Date.now() - 1, hashToken(resetToken));
  assert.equal(
    (
      await student.call("/api/auth/reset", {
        method: "POST",
        body: { token: resetToken, password: "Rejected new password 21" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await student.call("/api/auth/login", {
        method: "POST",
        body: { email: "expiredreset@usc.edu", password: PASSWORD },
      })
    ).status,
    200,
  );
  const cookie = student.cookie;
  assert.equal(
    (
      await student.call("/api/auth/logout", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(student.cookie, cookie);
  assert.equal(
    (await student.call("/api/session")).body.user.email,
    "expiredreset@usc.edu",
  );
});

test("boost lifts one listing, once, for its owner only", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("boost.owner@usc.edu", "Boost Owner");
  const other = await env.verified("boost.other@usc.edu", "Other Student");
  const listing = await env.publish(owner);

  // A free launch boost runs for seven days and marks the listing.
  const boosted = await owner.call(`/api/listings/${listing.id}/boost`, {
    method: "POST",
    body: { kind: "launch" },
  });
  assert.equal(boosted.status, 200, JSON.stringify(boosted.body));
  assert.equal(boosted.body.listing.boosted, true);
  assert.ok(new Date(boosted.body.listing.boostUntil) > new Date());
  const days =
    (new Date(boosted.body.listing.boostUntil) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7, `seven day window, got ${days}`);
  const row = env.app.locals.db
    .prepare("SELECT kind,price_cents FROM boosts WHERE listing_id=?")
    .get(listing.id);
  assert.deepEqual(row, { kind: "launch", price_cents: 0 });

  // A second launch boost on the same listing is refused.
  const again = await owner.call(`/api/listings/${listing.id}/boost`, {
    method: "POST",
    body: { kind: "launch" },
  });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already boosted until/);

  // Paid boosts wait for payments.
  const paid = await owner.call(`/api/listings/${listing.id}/boost`, {
    method: "POST",
    body: { kind: "paid" },
  });
  assert.equal(paid.status, 402);
  assert.equal(paid.body.error, "Payments open soon.");

  // Another student can neither boost it nor read its stats.
  assert.equal(
    (
      await other.call(`/api/listings/${listing.id}/boost`, {
        method: "POST",
        body: { kind: "launch" },
      })
    ).status,
    404,
  );
  assert.equal(
    (await other.call(`/api/listings/${listing.id}/boost-stats`)).status,
    404,
  );

  // Views and requests are counted from the start of the boost.
  await other.call(`/api/listings/${listing.id}`);
  await owner.call(`/api/listings/${listing.id}`);
  const requested = await other.call("/api/requests", {
    method: "POST",
    body: { listingId: listing.id, message: "I would like to take this over for the spring term please." },
  });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const stats = await owner.call(`/api/listings/${listing.id}/boost-stats`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.views, 1, "the owner's own view is not counted");
  assert.equal(stats.body.requests, 1);
  assert.equal(stats.body.boostUntil, boosted.body.listing.boostUntil);

  // A boost that has run out no longer refuses a new one on its dates.
  env.app.locals.db
    .prepare("UPDATE listings SET boost_until=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", listing.id);
  const expired = await owner.call(`/api/listings/${listing.id}/boost`, {
    method: "POST",
    body: { kind: "launch" },
  });
  assert.equal(expired.status, 409);
  assert.equal(
    expired.body.error,
    "The free launch boost was already used on this listing.",
  );
});

test("boosted listings come first in browse, inside the requested sort", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("boost.rank@usc.edu", "Rank Owner");
  const cheap = await env.publish(owner, { title: "Cheapest room on the block", price: 700 });
  const middle = await env.publish(owner, { title: "Middle priced room nearby", price: 900 });
  const dear = await env.publish(owner, { title: "Most expensive room nearby", price: 2400 });
  const order = async (sort) =>
    (await owner.call(`/api/listings?sort=${sort}`)).body.listings.map(
      (item) => item.id,
    );
  assert.deepEqual(await order("price_asc"), [cheap.id, middle.id, dear.id]);
  const boosted = await owner.call(`/api/listings/${dear.id}/boost`, {
    method: "POST",
    body: { kind: "launch" },
  });
  assert.equal(boosted.status, 200, JSON.stringify(boosted.body));
  assert.deepEqual(await order("price_asc"), [dear.id, cheap.id, middle.id]);
  assert.deepEqual(await order("newest"), [dear.id, middle.id, cheap.id]);
  const listed = (await owner.call("/api/listings")).body.listings;
  assert.equal(listed[0].boosted, true);
  assert.equal(listed[1].boosted, false);
  assert.equal(listed[1].boostUntil, null);
});

test("a student at any known school can sign up, browse, save and request, but not list", async (t) => {
  const env = await setup(t);
  // A USC student gets the live campus, so listing is open to them.
  const trojan = await env.verified("owner@usc.edu", "Maya Owner");
  const session = (await trojan.call("/api/session")).body.user;
  assert.equal(session.campusId, "usc");
  assert.deepEqual(session.school, {
    name: "University of Southern California",
    domain: "usc.edu",
    live: true,
  });
  const listing = await env.publish(trojan);

  // An NYU student is welcome. Handoff is not open there, so campusId is null.
  const visitor = await env.verified("intern@nyu.edu", "Riley Visitor");
  const account = (await visitor.call("/api/session")).body.user;
  assert.equal(account.campusId, null);
  assert.deepEqual(account.school, {
    name: "New York University",
    domain: "nyu.edu",
    live: false,
  });

  // Browsing, saving and requesting are open to them everywhere Handoff runs.
  assert.equal(
    (await visitor.call("/api/listings?campusId=usc")).body.listings.length,
    1,
  );
  assert.equal(
    (await visitor.call(`/api/saved/${listing.id}`, { method: "POST" })).status,
    200,
  );
  assert.equal((await visitor.call("/api/saved")).body.listings.length, 1);
  const asked = await visitor.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "Hello, I am in Los Angeles for a summer internship.",
    },
  });
  assert.equal(asked.status, 201, JSON.stringify(asked.body));

  // Listing, publishing and boosting are the only things held back.
  for (const status of ["draft", "active"]) {
    const refused = await visitor.call("/api/listings", {
      method: "POST",
      body: validListing([], { status }),
    });
    assert.equal(refused.status, 403, status);
    assert.equal(refused.body.code, "school_not_live", status);
    assert.match(refused.body.error, /New York University/);
  }
  const boost = await visitor.call(`/api/listings/${listing.id}/boost`, {
    method: "POST",
    body: { kind: "launch" },
  });
  assert.equal(boost.status, 403);
  assert.equal(boost.body.code, "school_not_live");
  assert.equal(
    env.app.locals.db.prepare("SELECT count(*) AS n FROM listings").get().n,
    1,
  );

  // A subdomain of a known school still resolves to that school.
  const alum = await env.signup("grad@alumni.usc.edu", "Sam Alum");
  const alumni = (await alum.call("/api/session")).body.user;
  assert.equal(alumni.campusId, "usc");
  assert.equal(alumni.school.name, "University of Southern California");
});

test("password rules reject short choices", async (t) => {
  const env = await setup(t);
  const user = env.client();
  const attempt = (overrides) =>
    user.call("/api/auth/signup", {
      method: "POST",
      body: {
        name: "Dana Fielding",
        email: "dana@usc.edu",
        password: "Quiet lantern parade 214",
        ...overrides,
      },
    });
  const cases = [["short12", /at least 8 characters/]];
  for (const [password, expected] of cases) {
    const result = await attempt({ password });
    assert.equal(result.status, 400, password);
    assert.match(result.body.error, expected, password);
  }
  const good = await attempt({});
  assert.equal(good.status, 201, JSON.stringify(good.body));
  await user.call("/api/auth/verify", {
    method: "POST",
    body: { token: env.tokenFor("dana@usc.edu") },
  });

  // A reset holds the same line.
  await user.call("/api/auth/forgot", {
    method: "POST",
    body: { email: "dana@usc.edu" },
  });
  const token = env.tokenFor("dana@usc.edu", "reset");
  const weak = await user.call("/api/auth/reset", {
    method: "POST",
    body: { token, password: "short12" },
  });
  assert.equal(weak.status, 400);
  assert.match(weak.body.error, /at least 8 characters/);
  const reset = await user.call("/api/auth/reset", {
    method: "POST",
    body: { token, password: "Copper harbor lantern 915" },
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
});

test("an entire place is always open to anyone, a shared home keeps its roommate preference", async (t) => {
  const env = await setup(t);
  const lister = await env.verified("preference@usc.edu", "Preference Lister");
  // Fair housing. A whole home carries no preference whatever the client sends.
  const whole = await env.publish(lister, {
    roomType: "entire",
    genderPreference: "women_only",
  });
  assert.equal(whole.genderPreference, "any");
  const room = await env.publish(lister, {
    roomType: "private",
    genderPreference: "women_only",
  });
  assert.equal(room.genderPreference, "women_only");
  // Turning a room into a whole home drops the preference with it.
  const converted = await lister.call(`/api/listings/${room.id}`, {
    method: "PATCH",
    body: { roomType: "entire" },
  });
  assert.equal(converted.status, 200, JSON.stringify(converted.body));
  assert.equal(converted.body.listing.genderPreference, "any");
  // A preference the student never set stays at any.
  const plain = await env.publish(lister, { roomType: "shared" });
  assert.equal(plain.genderPreference, "any");
  const rejected = await lister.call(`/api/listings/${plain.id}`, {
    method: "PATCH",
    body: { genderPreference: "women" },
  });
  assert.equal(rejected.status, 400);
});

test("the roommate preference filter keeps open listings and drops the ones asking for someone else", async (t) => {
  const env = await setup(t);
  const lister = await env.verified("filters@usc.edu", "Filter Lister");
  const open = await env.publish(lister, { roomType: "private" });
  const womenOnly = await env.publish(lister, {
    roomType: "private",
    genderPreference: "women_only",
  });
  const womenPreferred = await env.publish(lister, {
    roomType: "shared",
    genderPreference: "women_preferred",
  });
  const menOnly = await env.publish(lister, {
    roomType: "private",
    genderPreference: "men_only",
  });
  const ids = async (query) => {
    const result = await lister.call(`/api/listings?${query}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.listings.map((listing) => listing.id).sort();
  };
  assert.deepEqual(
    await ids("gender=women"),
    [open.id, womenOnly.id, womenPreferred.id].sort(),
  );
  assert.ok(!(await ids("gender=women")).includes(menOnly.id));
  assert.deepEqual(await ids("gender=men"), [open.id, menOnly.id].sort());
  assert.deepEqual(await ids("gender=women_only"), [womenOnly.id]);
  assert.deepEqual(await ids("gender=men_only"), [menOnly.id]);
  assert.equal((await ids("")).length, 4);
  const unknown = await lister.call("/api/listings?gender=everyone");
  assert.equal(unknown.status, 400);
});

test("gender is optional at signup, stays private, and the profile can change it", async (t) => {
  const env = await setup(t);
  const student = await env.verified("gender@usc.edu", "Gender Student");
  // Nothing was asked, so nothing was assumed.
  assert.equal((await student.call("/api/session")).body.user.gender, "unspecified");
  const saved = await student.call("/api/profile", {
    method: "PATCH",
    body: { name: "Gender Student", bio: "Third year.", gender: "woman" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.user.gender, "woman");
  assert.equal((await student.call("/api/session")).body.user.gender, "woman");
  // An update that leaves gender out keeps what the student already chose.
  const kept = await student.call("/api/profile", {
    method: "PATCH",
    body: { name: "Gender Student", bio: "Fourth year." },
  });
  assert.equal(kept.body.user.gender, "woman");
  const bad = await student.call("/api/profile", {
    method: "PATCH",
    body: { name: "Gender Student", bio: "", gender: "female" },
  });
  assert.equal(bad.status, 400);
  // A signup may state it, and the value never reaches a public listing view.
  const picked = env.client();
  const signed = await picked.call("/api/auth/signup", {
    method: "POST",
    body: {
      name: "Picked Student",
      email: "picked@usc.edu",
      password: PASSWORD,
      gender: "nonbinary",
    },
  });
  assert.equal(signed.status, 201, JSON.stringify(signed.body));
  assert.equal(signed.body.user.gender, "nonbinary");
  const lister = await env.verified("listerg@usc.edu", "Lister Gender");
  const listing = await env.publish(lister, { roomType: "private" });
  const view = await student.call(`/api/listings/${listing.id}`);
  assert.equal(view.status, 200);
  assert.ok(!JSON.stringify(view.body).includes("unspecified"));
});

test("a request carries the requester's gender to the lister only when it was shared", async (t) => {
  const env = await setup(t);
  const lister = await env.verified("owner-g@usc.edu", "Owner Gender");
  const listing = await env.publish(lister, {
    roomType: "private",
    genderPreference: "women_preferred",
  });
  const quiet = await env.verified("quiet-g@usc.edu", "Quiet Student");
  const shared = await env.verified("shared-g@usc.edu", "Shared Student");
  await shared.call("/api/profile", {
    method: "PATCH",
    body: { name: "Shared Student", bio: "", gender: "woman" },
  });
  for (const student of [quiet, shared]) {
    const sent = await student.call("/api/requests", {
      method: "POST",
      body: {
        listingId: listing.id,
        message: "Hello, I would like to take over this room in January.",
      },
    });
    // A preference never blocks a request. The lister decides.
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
  }
  const incoming = (await lister.call("/api/requests")).body.incoming;
  assert.equal(incoming.length, 2);
  const byName = Object.fromEntries(
    incoming.map((row) => [row.requesterName, row.requesterGender]),
  );
  assert.equal(byName["Shared Student"], "woman");
  assert.equal(byName["Quiet Student"], undefined);
  // The requester's own copy never carries it back to them.
  const outgoing = (await shared.call("/api/requests")).body.outgoing;
  assert.equal(outgoing[0].requesterGender, undefined);
});

test("the admin dashboard is invisible to a student and complete for an admin", async (t) => {
  const f = await setup(t);
  const student = await f.verified("student.admin.case@usc.edu", "Regular Student");
  // A student on the internal host learns nothing either.
  student.surface = "internal";
  // Every admin path answers 404, the same as a route that does not exist.
  for (const path of [
    "/api/admin/overview",
    "/api/admin/users",
    "/api/admin/listings",
    "/api/admin/system",
    "/api/admin/audit",
  ]) {
    const denied = await student.call(path);
    assert.equal(denied.status, 404, path);
    assert.equal(denied.body.error, "Endpoint not found.");
  }
  const anonymous = f.client();
  anonymous.surface = "internal";
  assert.equal((await anonymous.call("/api/admin/overview")).status, 404);
  // A student never sees an admin flag on their own session.
  assert.equal((await student.call("/api/session")).body.user.isAdmin, false);
  student.surface = "";

  const operator = await f.verified("operator.case@usc.edu", "Ops Student");
  // The script's own function is what an operator runs on the VPS.
  const { setAdmin } = await import("../scripts/make-admin.js");
  const promoted = setAdmin(f.app.locals.db, "operator.case@usc.edu");
  assert.equal(promoted.is_admin, 1);
  assert.equal((await operator.call("/api/session")).body.user.isAdmin, true);
  // Everything the dashboard reaches for happens on the internal host.
  operator.surface = "internal";

  const overview = await operator.call("/api/admin/overview");
  assert.equal(overview.status, 200);
  assert.ok(overview.body.totals.users >= 2);
  assert.equal(typeof overview.body.totals.listingsByStatus, "object");
  assert.equal(overview.body.series.signups.length, 30);
  assert.equal(overview.body.series.listings.length, 30);
  assert.equal(overview.body.series.requests.length, 30);
  assert.ok(Array.isArray(overview.body.usersBySchool));

  const users = await operator.call("/api/admin/users?query=student.admin.case");
  assert.equal(users.status, 200);
  assert.equal(users.body.users.length, 1);
  assert.equal(users.body.users[0].email, "student.admin.case@usc.edu");
  assert.equal(users.body.pageSize, 25);
  assert.ok(users.body.users[0].lastSignIn);

  const detail = await operator.call(`/api/admin/users/${users.body.users[0].id}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.body.sessions));

  const listing = await f.publish(student);
  const listings = await operator.call("/api/admin/listings?status=active");
  assert.equal(listings.body.listings[0].id, listing.id);
  assert.equal(listings.body.listings[0].ownerEmail, "student.admin.case@usc.edu");
  for (const path of ["/api/admin/requests", "/api/admin/reports", "/api/admin/waitlist", "/api/admin/ai-usage", "/api/admin/system"])
    assert.equal((await operator.call(path)).status, 200, path);

  // An admin write is recorded, and the disabled student cannot sign in again.
  const disabled = await operator.call(
    `/api/admin/users/${users.body.users[0].id}/disable`,
    { method: "POST" },
  );
  assert.equal(disabled.status, 200);
  const audit = await operator.call("/api/admin/audit");
  assert.equal(audit.status, 200);
  assert.equal(audit.body.audit[0].action, "user.disable");
  assert.equal(audit.body.audit[0].targetId, users.body.users[0].id);
  assert.equal(JSON.parse(audit.body.audit[0].details).email, "student.admin.case@usc.edu");

  const blocked = f.client();
  const signIn = await blocked.call("/api/auth/login", {
    method: "POST",
    body: { email: "student.admin.case@usc.edu", password: PASSWORD },
  });
  assert.equal(signIn.status, 403);
  assert.equal(signIn.body.error, "This account is disabled.");
  // Their existing session is gone too, and anything it reaches for refuses.
  assert.equal((await student.call("/api/saved")).status, 401);

  await operator.call(`/api/admin/users/${users.body.users[0].id}/enable`, {
    method: "POST",
  });
  const back = f.client();
  assert.equal(
    (
      await back.call("/api/auth/login", {
        method: "POST",
        body: { email: "student.admin.case@usc.edu", password: PASSWORD },
      })
    ).status,
    200,
  );

  // An admin may never lock themselves out of the dashboard.
  const self = await operator.call("/api/admin/users");
  const me = self.body.users.find((row) => row.email === "operator.case@usc.edu");
  const revoked = await operator.call(`/api/admin/users/${me.id}/admin`, {
    method: "POST",
    body: { on: false },
  });
  assert.equal(revoked.status, 400);
  assert.match(revoked.body.error, /cannot remove your own admin access/);
});

test("a signed out visitor gets a locked listing with an approximate point", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("locked.owner@usc.edu", "Locked Owner");
  const listing = await env.publish(owner, {
    address: "1234 Hoover Street, Los Angeles, CA 90007",
    description:
      "A quiet corner room with a desk by the window and a short walk to campus.",
  });
  const anonymous = env.client();
  const one = await anonymous.call(`/api/listings/${listing.id}`);
  assert.equal(one.status, 200);
  const hidden = one.body.listing;
  assert.equal(hidden.locked, true);
  assert.equal(hidden.address, null);
  assert.equal(hidden.description, null);
  assert.equal(hidden.ownerName, null);
  // Everything a visitor may see is still there.
  assert.equal(hidden.title, listing.title);
  assert.equal(hidden.price, listing.price);
  assert.equal(hidden.originalPrice, listing.originalPrice);
  assert.deepEqual(hidden.photos, listing.photos);
  assert.deepEqual(hidden.amenities, listing.amenities);
  assert.equal(hidden.availableFrom, listing.availableFrom);
  assert.equal(hidden.availableTo, listing.availableTo);
  assert.equal(hidden.bedrooms, listing.bedrooms);
  assert.equal(hidden.bathrooms, listing.bathrooms);
  assert.equal(hidden.roomType, listing.roomType);
  assert.equal(hidden.genderPreference, listing.genderPreference);
  assert.equal(hidden.boosted, listing.boosted);
  // The point moved, by no more than 250 metres, and it never moves again.
  assert.notEqual(hidden.lat, listing.lat);
  const metres =
    Math.hypot(
      (hidden.lat - listing.lat) * 111320,
      (hidden.lng - listing.lng) *
        111320 *
        Math.cos((listing.lat * Math.PI) / 180),
    );
  assert.ok(metres > 0 && metres <= 251, `moved ${metres} metres`);
  const repeat = await anonymous.call(`/api/listings/${listing.id}`);
  assert.equal(repeat.body.listing.lat, hidden.lat);
  assert.equal(repeat.body.listing.lng, hidden.lng);
  const browse = await env.client().call("/api/listings");
  const inList = browse.body.listings.find((row) => row.id === listing.id);
  assert.equal(inList.locked, true);
  assert.equal(inList.address, null);
  assert.equal(inList.description, null);
  assert.equal(inList.ownerName, null);
  assert.equal(inList.lat, hidden.lat);
  assert.equal(inList.lng, hidden.lng);
  // A signed in student sees the real thing, with no locked flag set.
  const student = await env.verified("locked.reader@usc.edu", "Locked Reader");
  const open = await student.call(`/api/listings/${listing.id}`);
  assert.equal(open.body.listing.locked, false);
  assert.equal(open.body.listing.address, listing.address);
  assert.equal(open.body.listing.description, listing.description);
  assert.equal(open.body.listing.ownerName, "Locked Owner");
  assert.equal(open.body.listing.lat, listing.lat);
  assert.equal(open.body.listing.lng, listing.lng);
});

test("the dashboard lives on the internal host and only for an allow listed admin", async (t) => {
  const f = await setup(t);
  const student = await f.verified("surface.student@usc.edu", "Surface Student");
  const listed = await f.verified("operator.case@usc.edu", "Listed Admin");
  const unlisted = await f.verified("unlisted.admin@usc.edu", "Unlisted Admin");
  const { setAdmin } = await import("../scripts/make-admin.js");
  setAdmin(f.app.locals.db, "operator.case@usc.edu");
  setAdmin(f.app.locals.db, "unlisted.admin@usc.edu");

  // The allow listed admin, on the internal host, is the only way in.
  listed.surface = "internal";
  const overview = await listed.call("/api/admin/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.headers.get("x-robots-tag"), "noindex, nofollow");

  // The database flag alone is not enough, and the client is never told.
  unlisted.surface = "internal";
  assert.equal((await unlisted.call("/api/admin/overview")).status, 404);
  assert.equal((await unlisted.call("/api/session")).body.user.isAdmin, false);

  // A student is refused the same way.
  student.surface = "internal";
  assert.equal((await student.call("/api/admin/overview")).status, 404);

  // The internal host is the dashboard and nothing else.
  for (const path of ["/api/listings", "/api/my-listings", "/api/saved", "/api/requests"])
    assert.equal((await student.call(path)).status, 404, path);
  const visitor = f.client();
  visitor.surface = "internal";
  for (const path of ["/api/auth/signup", "/api/auth/forgot", "/api/auth/reset", "/api/auth/verify"]) {
    const gone = await visitor.call(path, { method: "POST", body: {} });
    assert.equal(gone.status, 404, path);
  }

  // Sign in on the internal host refuses anybody who is not on the list, and
  // never opens a session for them.
  const refused = await visitor.call("/api/auth/login", {
    method: "POST",
    body: { email: "surface.student@usc.edu", password: PASSWORD },
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "This sign in is for the Handoff team.");
  assert.equal((await visitor.call("/api/session")).body.user, null);
  const refusedAdmin = await visitor.call("/api/auth/login", {
    method: "POST",
    body: { email: "unlisted.admin@usc.edu", password: PASSWORD },
  });
  assert.equal(refusedAdmin.status, 403);
  assert.equal((await visitor.call("/api/session")).body.user, null);

  const team = f.client();
  team.surface = "internal";
  const signedIn = await team.call("/api/auth/login", {
    method: "POST",
    body: { email: "operator.case@usc.edu", password: PASSWORD },
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.isAdmin, true);
  assert.equal((await team.call("/api/admin/overview")).status, 200);

  // The app host never carries the dashboard, not even for that admin.
  const onApp = f.client();
  onApp.cookie = team.cookie;
  assert.equal((await onApp.call("/api/admin/overview")).status, 404);
  assert.equal((await onApp.call("/api/session")).body.user.isAdmin, true);
  assert.equal(
    (await onApp.call("/api/listings")).status,
    200,
    "the student app is untouched",
  );
  assert.equal((await onApp.call("/api/session")).headers.get("x-robots-tag"), null);

  // The internal host tells crawlers to stay away.
  const robots = await visitor.call("/robots.txt", { raw: true });
  assert.equal(robots.status, 200);
  assert.match(robots.body.toString(), /Disallow: \//);
  assert.equal((await onApp.call("/robots.txt", { raw: true })).status, 404);
});

test("a profile photo is optional, square, replaceable and removable", async (t) => {
  const env = await setup(t);
  const student = await env.verified("photo.student@usc.edu", "Photo Student");
  assert.equal((await student.call("/api/session")).body.user.avatar, null);
  const png = async (size, colour) =>
    await sharp({
      create: {
        width: size,
        height: Math.round(size * 0.75),
        channels: 3,
        background: colour,
      },
    })
      .png()
      .toBuffer();
  const send = async (bytes, filename, type) => {
    const form = new FormData();
    form.append("avatar", new Blob([bytes], { type }), filename);
    return student.call("/api/profile/avatar", { method: "POST", body: form });
  };
  const first = await send(await png(400, "#3b78d7"), "me.png", "image/png");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const one = first.body.user.avatar;
  assert.match(one, /^\/avatars\/[a-f0-9-]{36}\.jpg$/);
  const served = await fetch(`${env.url}${one}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  const shape = await sharp(
    Buffer.from(await served.arrayBuffer()),
  ).metadata();
  assert.equal(shape.width, 320);
  assert.equal(shape.height, 320);
  assert.equal(shape.format, "jpeg");
  // Replacing it swaps the path and the old file stops being served.
  const second = await send(await png(500, "#159a6a"), "new.png", "image/png");
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const two = second.body.user.avatar;
  assert.notEqual(two, one);
  assert.equal((await fetch(`${env.url}${one}`)).status, 404);
  assert.equal((await fetch(`${env.url}${two}`)).status, 200);
  // The photo travels with the name, never on its own.
  const listing = await env.publish(student);
  const reader = await env.verified("photo.reader@usc.edu", "Photo Reader");
  const seen = await reader.call(`/api/listings/${listing.id}`);
  assert.equal(seen.body.listing.ownerAvatar, two);
  const hidden = await env.client().call(`/api/listings/${listing.id}`);
  assert.equal(hidden.body.listing.ownerAvatar, null);
  // Anything that is not an image is refused and nothing changes.
  const bad = await send(
    Buffer.from("not really a photo at all"),
    "note.txt",
    "text/plain",
  );
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /JPG, PNG or WebP/);
  assert.equal((await student.call("/api/session")).body.user.avatar, two);
  const tiny = await send(await png(40, "#c4907a"), "tiny.png", "image/png");
  assert.equal(tiny.status, 400);
  // Removing it clears the row and the file.
  const removed = await student.call("/api/profile/avatar", {
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.user.avatar, null);
  assert.equal((await fetch(`${env.url}${two}`)).status, 404);
  assert.equal(
    (await env.client().call("/api/profile/avatar", { method: "DELETE" }))
      .status,
    401,
  );
});


test("owners can delete a listing and everything attached to it", async (t) => {
  const env = await setup(t);
  const owner = await env.signup("del.owner@usc.edu", "Del Owner");
  await owner.call("/api/auth/verify", {
    method: "POST",
    body: { token: env.tokenFor("del.owner@usc.edu") },
  });
  const photos = await env.upload(owner);
  const created = await owner.call("/api/listings", {
    method: "POST",
    body: validListing(photos, { status: "draft" }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.listing.id;
  const other = await env.signup("not.owner@usc.edu", "Not Owner");
  const refused = await other.call(`/api/listings/${id}`, { method: "DELETE" });
  assert.equal(refused.status, 404);
  const deleted = await owner.call(`/api/listings/${id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  const gone = await owner.call(`/api/listings/${id}`);
  assert.equal(gone.status, 404);
  const mine = await owner.call("/api/my-listings");
  assert.equal(mine.status, 200);
  assert.ok(!mine.body.listings.some((l) => l.id === id));
  const file = await owner.call(photos[0]);
  assert.equal(file.status, 404);
});

test("contact channels are normalised, kept private, and cleared when emptied", async (t) => {
  const env = await setup(t);
  const student = await env.verified("channels@usc.edu", "Casey Channel");
  const fresh = (await student.call("/api/session")).body.user;
  assert.equal(fresh.phone, null);
  assert.equal(fresh.instagram, null);
  assert.equal(fresh.facebook, null);
  assert.deepEqual(fresh.shareChannels, ["email"]);

  const patch = (body) =>
    student.call("/api/profile", {
      method: "PATCH",
      body: { name: "Casey Channel", bio: "", ...body },
    });

  // Three ways of writing the same US number all reach the same E.164 value.
  for (const written of ["(213) 555-0142", "213-555-0142", "+1 213 555 0142"]) {
    const saved = await patch({ phone: written });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.user.phone, "+12135550142");
  }
  // Eleven digits are only a number when the leading digit is the country 1.
  assert.equal(
    (await patch({ phone: "1 213 555 0142" })).body.user.phone,
    "+12135550142",
  );
  for (const bad of ["555-0142", "21355501421", "213 555 014", "call me"]) {
    const rejected = await patch({ phone: bad });
    assert.equal(rejected.status, 400, `${bad} should be refused`);
  }

  // A handle, an @ handle and a full profile link all store the handle.
  for (const written of [
    "casey.channel",
    "@casey.channel",
    "https://www.instagram.com/casey.channel/",
    "instagram.com/casey.channel?hl=en",
  ]) {
    const saved = await patch({ instagram: written });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.user.instagram, "casey.channel");
  }
  for (const bad of ["ca sey", "casey!", "x".repeat(31)]) {
    assert.equal((await patch({ instagram: bad })).status, 400, bad);
  }

  // Facebook keeps a link as written and a username as a username.
  assert.equal(
    (await patch({ facebook: "https://facebook.com/casey.channel" })).body.user
      .facebook,
    "https://facebook.com/casey.channel",
  );
  assert.equal(
    (await patch({ facebook: "  casey.channel  " })).body.user.facebook,
    "casey.channel",
  );
  for (const bad of ["ca", "casey channel", "casey_channel"]) {
    assert.equal((await patch({ facebook: bad })).status, 400, bad);
  }

  // Email can never be taken out, and a channel with no value is never shared.
  const chosen = await patch({
    phone: "(213) 555-0142",
    instagram: "casey.channel",
    facebook: "",
    shareChannels: ["phone", "facebook"],
  });
  assert.equal(chosen.status, 200);
  assert.deepEqual(chosen.body.user.shareChannels, ["email", "phone"]);
  assert.equal(chosen.body.user.facebook, null);

  // Asking for nothing still leaves email in place.
  assert.deepEqual(
    (await patch({ shareChannels: [] })).body.user.shareChannels, ["email"]);

  // Clearing a field removes it and drops it out of the shared set.
  const cleared = await patch({
    phone: "",
    instagram: "casey.channel",
    shareChannels: ["email", "phone", "instagram"],
  });
  assert.equal(cleared.body.user.phone, null);
  assert.deepEqual(cleared.body.user.shareChannels, ["email", "instagram"]);

  // A round trip through a new session returns exactly what was stored.
  const again = await student.call("/api/session");
  assert.equal(again.body.user.instagram, "casey.channel");
  assert.deepEqual(again.body.user.shareChannels, ["email", "instagram"]);
});

test("an accepted request reveals only the channels that student chose", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("lister@usc.edu", "Olivia Owner");
  const renter = await env.verified("seeker@usc.edu", "Riley Renter");
  const outsider = await env.verified("nobody@usc.edu", "Other Student");
  const publicClient = env.client();

  await owner.call("/api/profile", {
    method: "PATCH",
    body: {
      name: "Olivia Owner",
      bio: "",
      phone: "(213) 555-0111",
      instagram: "@olivia.owner",
      facebook: "https://facebook.com/olivia.owner",
      shareChannels: ["email", "phone"],
    },
  });
  await renter.call("/api/profile", {
    method: "PATCH",
    body: {
      name: "Riley Renter",
      bio: "",
      phone: "(213) 555-0222",
      instagram: "riley.renter",
      shareChannels: ["email", "instagram", "phone"],
    },
  });
  const listing = await env.publish(owner);

  // The request shares less than the profile default does.
  const created = await renter.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "Hi, I am looking for a room for the spring semester.",
      shareChannels: ["email", "instagram"],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const requestId = created.body.request.id;
  assert.equal(created.body.request.contact, undefined);

  // Nothing is revealed while the request is only pending.
  const pending = await owner.call("/api/requests");
  assert.equal(pending.body.incoming[0].contact, undefined);
  const pendingText = JSON.stringify(pending.body);
  assert.ok(!pendingText.includes("5550222"));
  assert.ok(!pendingText.includes("riley.renter"));
  assert.ok(!pendingText.includes("seeker@usc.edu"));

  const accepted = await owner.call(`/api/requests/${requestId}`, {
    method: "PATCH",
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200);
  // The lister sees the request's own choice, not the requester's default.
  assert.deepEqual(accepted.body.request.contact, {
    name: "Riley Renter",
    email: "seeker@usc.edu",
    instagram: "riley.renter",
  });
  // The requester sees the lister's profile default, and nothing more.
  const outgoing = (await renter.call("/api/requests")).body.outgoing[0];
  assert.deepEqual(outgoing.contact, {
    name: "Olivia Owner",
    email: "lister@usc.edu",
    phone: "+12135550111",
  });
  assert.equal(outgoing.contact.instagram, undefined);
  assert.equal(outgoing.contact.facebook, undefined);

  // A third party and a signed out visitor see none of it, anywhere.
  for (const stranger of [outsider, publicClient]) {
    const requests = await stranger.call("/api/requests");
    const detail = await stranger.call(`/api/listings/${listing.id}`);
    const browse = await stranger.call("/api/listings");
    const text = JSON.stringify([requests.body, detail.body, browse.body]);
    for (const secret of [
      "5550111",
      "5550222",
      "olivia.owner",
      "riley.renter",
      "lister@usc.edu",
      "seeker@usc.edu",
    ])
      assert.ok(!text.includes(secret), `${secret} must stay private`);
  }
  assert.equal(
    (await outsider.call(`/api/requests/${requestId}`)).status === 200,
    false,
  );
});

test("a request with no choice of its own falls back to the profile default", async (t) => {
  const env = await setup(t);
  const owner = await env.verified("default-lister@usc.edu", "Olivia Owner");
  const renter = await env.verified("default-seeker@usc.edu", "Riley Renter");
  await renter.call("/api/profile", {
    method: "PATCH",
    body: {
      name: "Riley Renter",
      bio: "",
      phone: "(213) 555-0333",
      shareChannels: ["email", "phone"],
    },
  });
  const listing = await env.publish(owner);
  const created = await renter.call("/api/requests", {
    method: "POST",
    body: { listingId: listing.id, message: "No per request choice here." },
  });
  assert.equal(created.status, 201);
  const accepted = await owner.call(`/api/requests/${created.body.request.id}`, {
    method: "PATCH",
    body: { status: "accepted" },
  });
  assert.equal(accepted.body.request.contact.phone, "+12135550333");

  // A channel the requester never filled in cannot be forced into a request.
  const second = await env.verified("empty-seeker@usc.edu", "Sam Seeker");
  const another = await second.call("/api/requests", {
    method: "POST",
    body: {
      listingId: listing.id,
      message: "Asking to share a number I never added.",
      shareChannels: ["email", "phone", "instagram"],
    },
  });
  assert.equal(another.status, 201);
  const alsoAccepted = await owner.call(
    `/api/requests/${another.body.request.id}`,
    { method: "PATCH", body: { status: "accepted" } },
  );
  assert.deepEqual(alsoAccepted.body.request.contact, {
    name: "Sam Seeker",
    email: "empty-seeker@usc.edu",
  });
});
