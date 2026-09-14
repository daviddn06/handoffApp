import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
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
    return {
      get cookie() {
        return cookie;
      },
      set cookie(value) {
        cookie = value;
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
  const signup = async (address, name = "Test Student", campusId = "usc") => {
    const user = client();
    const result = await user.call("/api/auth/signup", {
      method: "POST",
      body: { name, email: address, password: PASSWORD, campusId },
    });
    assert.equal(result.status, 202, JSON.stringify(result.body));
    return user;
  };
  const verified = async (address, name = "Test Student", campusId = "usc") => {
    const user = await signup(address, name, campusId);
    const result = await user.call("/api/auth/verify", {
      method: "POST",
      body: { token: tokenFor(address) },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    user.id = result.body.user.id;
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
  assert.equal((await alice.call("/api/session")).body.user, null);
  const unverifiedLogin = await alice.call("/api/auth/login", {
    method: "POST",
    body: { email: "alice@usc.edu", password: PASSWORD },
  });
  assert.equal(unverifiedLogin.status, 403);
  assert.equal((await alice.call("/api/my-listings")).status, 401);
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
    campusId: "usc",
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
  for (const wrong of [
    "student@gmail.com",
    "student@usc.edu.evil.example",
    "student@evilusc.edu",
    "student@ucla.edu",
  ]) {
    assert.equal(
      (
        await user.call("/api/auth/signup", {
          method: "POST",
          body: { ...signup, email: wrong },
        })
      ).status,
      400,
      wrong,
    );
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
            campusId: "usc",
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
        campusId: "usc",
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
    /frame-ancestors 'none'/,
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
  assert.equal(reopened.locals.db.pragma("user_version", { simple: true }), 2);
  assert.throws(
    () =>
      createApp({
        dataDir: env.dataDir,
        origin: "http://app.handofflease.com",
      }),
    /HTTPS/,
  );
});

test("re-registering an unverified email replaces pre-registered credentials and invalidates old links", async (t) => {
  const env = await setup(t);
  const attackerPassword = "Attacker chosen password 867";
  const victimPassword = "Actual student password 915";
  const attacker = env.client();
  assert.equal(
    (
      await attacker.call("/api/auth/signup", {
        method: "POST",
        body: {
          name: "Attacker Name",
          email: "student@usc.edu",
          password: attackerPassword,
          campusId: "usc",
        },
      })
    ).status,
    202,
  );
  const attackerToken = env.tokenFor("student@usc.edu");
  const victim = env.client();
  assert.equal(
    (
      await victim.call("/api/auth/signup", {
        method: "POST",
        body: {
          name: "Actual Student",
          email: "student@usc.edu",
          password: victimPassword,
          campusId: "usc",
        },
      })
    ).status,
    202,
  );
  const victimToken = env.tokenFor("student@usc.edu");
  assert.notEqual(victimToken, attackerToken);
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
  assert.equal(
    (
      await attacker.call("/api/auth/signup", {
        method: "POST",
        body: {
          name: "Attacker Name",
          email: "student@usc.edu",
          password: attackerPassword,
          campusId: "usc",
        },
      })
    ).status,
    202,
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
    "ALTER TABLE listings DROP COLUMN moderation_locked; PRAGMA user_version=1;",
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
      2,
    );
    assert.equal(
      migrated.locals.db.prepare("SELECT name FROM users").get().name,
      "Preserved Student",
    );
    const files = await readdir(join(dataDir, "backups"));
    assert.equal(files.length, 1);
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
