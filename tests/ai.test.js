import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { chatListing, parseListing } from "../server/ai.js";

const ORIGIN = "http://127.0.0.1:4741";
const PASSWORD = "Correct horse battery 572!";
/** A post in the shape students actually paste, contact details and all. */
const FACEBOOK_POST = `SUBLET AVAILABLE!!! 🔥🔥
Taking over my room at 1201 W 30th St, Los Angeles for the summer. Private bedroom in a 3 bed 2 bath, two chill roommates staying.
$1,150/month (I pay 1,400 so you are saving). May 20 through Aug 15.
Fully furnished, AC, in unit laundry, fast wifi, parking spot included.
Text me at (213) 555-0148 or email maya.sublet@gmail.com if interested!!!`;

/** The model is never called in tests. This stands in for its answer. */
function fakeClient(payload, capture = {}) {
  return {
    capture,
    responses: {
      create: async (params) => {
        capture.params = params;
        return {
          model: "fake-model",
          output_text: JSON.stringify(payload),
          usage: { input_tokens: 1200, output_tokens: 320 },
        };
      },
    },
  };
}
const PARSE_ANSWER = {
  draft: {
    title: "PRIVATE ROOM IN 3 BED NEAR CAMPUS 🔥",
    description:
      "Private bedroom in a three bedroom, two bathroom apartment with two roommates staying for the summer. Furnished with air conditioning, in unit laundry, fast wifi and a parking spot. Text me at (213) 555-0148 or email maya.sublet@gmail.com.",
    address: "1201 West 30th Street, Los Angeles",
    price: 1150,
    deposit: null,
    originalPrice: 1400,
    bedrooms: 3,
    bathrooms: 2,
    roomType: "private",
    availableFrom: "2027-05-20",
    availableTo: "2027-08-15",
    amenities: ["Furnished", "Air conditioning", "Laundry", "Hot tub", "Wi-Fi"],
    genderPreference: null,
  },
  confidence: {
    title: "high",
    description: "high",
    address: "high",
    price: "high",
    deposit: "low",
    originalPrice: "high",
    bedrooms: "high",
    bathrooms: "high",
    roomType: "high",
    availableFrom: "high",
    availableTo: "high",
    amenities: "medium",
    genderPreference: "low",
  },
  notes: "The post gives no deposit, so confirm it before publishing.",
};

test("a pasted Facebook post becomes a typed draft with the gaps flagged", async () => {
  const capture = {};
  const result = await parseListing({
    text: FACEBOOK_POST,
    files: [],
    campus: null,
    client: fakeClient(PARSE_ANSWER, capture),
  });
  const { draft } = result;
  assert.equal(typeof draft.price, "number");
  assert.equal(draft.price, 1150);
  assert.equal(draft.originalPrice, 1400);
  assert.equal(draft.bedrooms, 3);
  assert.equal(draft.bathrooms, 2);
  assert.equal(draft.roomType, "private");
  assert.equal(draft.availableFrom, "2027-05-20");
  assert.equal(draft.availableTo, "2027-08-15");
  assert.deepEqual(draft.photos, []);
  // Only ids the app knows survive, the invented one is dropped.
  assert.deepEqual(draft.amenities, [
    "Furnished",
    "Air conditioning",
    "Laundry",
    "Wi-Fi",
  ]);
  // Contact details belong in the handoff request, never in a public listing.
  assert.ok(!/555-0148/.test(draft.description));
  assert.ok(!/@gmail\.com/.test(draft.description));
  assert.ok(draft.description.includes("three bedroom"));
  assert.equal(draft.genderPreference, "any");
  assert.ok(result.missing.includes("photos"));
  assert.ok(result.missing.includes("deposit"));
  assert.ok(!result.missing.includes("price"));
  assert.ok(!result.missing.includes("title"));
  assert.equal(result.usage.inputTokens, 1200);
  assert.equal(result.usage.outputTokens, 320);
  // The request is one structured call against the listing_draft schema.
  assert.equal(capture.params.text.format.name, "listing_draft");
  assert.equal(capture.params.text.format.strict, true);
});

test("smart import preserves stated cents and flags excessive precision without rounding", async () => {
  const capture = {};
  const exact = await parseListing({ text: "My USC sublease costs $1,497.50 per month, deposit $99.01, originally $1,600.25.", files: [], campus: null,
    client: fakeClient({ ...PARSE_ANSWER, draft: { ...PARSE_ANSWER.draft, price: 1497.50, deposit: 99.01, originalPrice: 1600.25 } }, capture) });
  assert.equal(exact.draft.price, 1497.50);
  assert.equal(exact.draft.deposit, 99.01);
  assert.equal(exact.draft.originalPrice, 1600.25);
  assert.match(JSON.stringify(capture.params), /Preserve any stated cents/);
  const invalid = await parseListing({ text: FACEBOOK_POST, files: [], campus: null,
    client: fakeClient({ ...PARSE_ANSWER, draft: { ...PARSE_ANSWER.draft, price: 1497.501, deposit: 99.011, originalPrice: 1600.255 } }) });
  assert.equal(invalid.draft.price, null);
  assert.equal(invalid.draft.deposit, null);
  assert.equal(invalid.draft.originalPrice, null);
  assert.ok(invalid.missing.includes("price"));
  assert.ok(invalid.missing.includes("deposit"));
});

test("a chat turn answers with one question and the merged draft", async () => {
  const answer = {
    reply: "Got it. When would the sublease start and end?",
    draft: {
      title: "Private room near campus",
      description: null,
      address: "",
      price: null,
      deposit: null,
      originalPrice: null,
      bedrooms: null,
      bathrooms: null,
      roomType: "private",
      availableFrom: null,
      availableTo: null,
      amenities: [],
      genderPreference: null,
    },
    done: false,
  };
  const result = await chatListing({
    messages: [{ role: "user", content: "A private room in a 3 bedroom." }],
    draft: { address: "1201 West 30th Street, Los Angeles", bedrooms: 3 },
    campus: null,
    client: fakeClient(answer),
  });
  assert.equal(result.reply, "Got it. When would the sublease start and end?");
  assert.equal(result.done, false);
  assert.equal(result.draft.title, "Private room near campus");
  // An empty value from a later turn never wipes what the student gave us.
  assert.equal(result.draft.address, "1201 West 30th Street, Los Angeles");
  assert.equal(result.draft.bedrooms, 3);
  assert.ok(result.missing.includes("price"));
});

async function serve(t, overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "handoff-ai-test-"));
  const messages = [];
  const app = createApp({
    dataDir,
    origin: ORIGIN,
    mailTransport: {
      sendMail: async (message) => {
        messages.push(message);
        return { accepted: [message.to] };
      },
    },
    ...overrides,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  let cookie = "";
  const call = async (path, { method = "GET", body } = {}) => {
    const form = body instanceof FormData;
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(method === "GET" ? {} : { Origin: ORIGIN }),
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.getSetCookie?.()[0];
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const signUp = async (email = "ai.student@usc.edu") => {
    const created = await call("/api/auth/signup", {
      method: "POST",
      body: { name: "Ai Student", email, password: PASSWORD },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return email;
  };
  const verify = (email) =>
    app.locals.db
      .prepare("UPDATE users SET verified_at=? WHERE email=?")
      .run(new Date().toISOString(), email);
  return { app, call, signUp, verify, messages };
}

test("smart import answers 503 until a model is configured", async (t) => {
  const { call, signUp, verify } = await serve(t, { aiClient: null });
  const email = await signUp();
  verify(email);
  const config = await call("/api/config");
  assert.equal(config.body.aiReady, false);
  const form = new FormData();
  form.append("text", FACEBOOK_POST);
  const parsed = await call("/api/import/parse", { method: "POST", body: form });
  assert.equal(parsed.status, 503);
  assert.equal(parsed.body.code, "ai_unavailable");
  assert.equal(parsed.body.error, "Smart import is being set up.");
  const chat = await call("/api/import/chat", {
    method: "POST",
    body: { messages: [], draft: null },
  });
  assert.equal(chat.status, 503);
  assert.equal(chat.body.code, "ai_unavailable");
});

test("smart import needs a verified student email", async (t) => {
  const { call, signUp } = await serve(t, {
    aiClient: fakeClient(PARSE_ANSWER),
  });
  await signUp();
  const config = await call("/api/config");
  assert.equal(config.body.aiReady, true);
  const form = new FormData();
  form.append("text", FACEBOOK_POST);
  const parsed = await call("/api/import/parse", { method: "POST", body: form });
  assert.equal(parsed.status, 403);
  assert.match(parsed.body.error, /Verify your student email/);
  const chat = await call("/api/import/chat", {
    method: "POST",
    body: { messages: [], draft: null },
  });
  assert.equal(chat.status, 403);
});

test("a verified student gets a draft and the call is recorded", async (t) => {
  // The fake answers with no address, so no geocoder is contacted.
  const answer = {
    ...PARSE_ANSWER,
    draft: { ...PARSE_ANSWER.draft, address: "" },
  };
  const { app, call, signUp, verify } = await serve(t, {
    aiClient: fakeClient(answer),
  });
  const email = await signUp();
  verify(email);
  const form = new FormData();
  form.append("text", FACEBOOK_POST);
  const parsed = await call("/api/import/parse", { method: "POST", body: form });
  assert.equal(parsed.status, 200, JSON.stringify(parsed.body));
  assert.equal(parsed.body.draft.price, 1150);
  assert.ok(parsed.body.missing.includes("address"));
  assert.ok(parsed.body.missing.includes("photos"));
  const usage = app.locals.db
    .prepare("SELECT * FROM ai_usage")
    .all();
  assert.equal(usage.length, 1);
  assert.equal(usage[0].kind, "parse");
  assert.equal(usage[0].input_tokens, 1200);
  assert.equal(usage[0].output_tokens, 320);
  assert.equal(usage[0].model, "fake-model");
});
