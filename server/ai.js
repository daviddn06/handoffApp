// Smart import. A student pastes a Facebook post, drops screenshots or a PDF,
// or answers a few questions, and the model fills the listing form for them.
//
// Everything here runs on the server. The API key never reaches the browser,
// and a missing key is a normal state, not a crash: the routes answer 503 and
// the app offers the manual form instead.
//
// The model is asked for one structured object through the Responses API with
// a strict JSON schema, so the answer is either the shape below or an error.
// Nothing the model returns is trusted as a listing. It is a draft the student
// reviews in the six step wizard, and the server validates it at save time
// exactly as it validates a hand typed one.
import sharp from "sharp";
import { z } from "zod";
import { geocode } from "./geocode.js";

/**
 * The chat turn body. The draft is whatever the client is holding, re-typed
 * field by field below, so a tampered draft can only produce a worse draft.
 */
export const importChatSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(4000),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    draft: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .strict();

const MODEL = () => process.env.OPENAI_MODEL || "gpt-5.6-luna";
const TEXT_LIMIT = 12000;
const MAX_IMAGES = 4;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PDF_TYPE = "application/pdf";
/** Mirrors src/types.ts AMENITIES. The model may only choose from these. */
export const AMENITIES = [
  "Furnished",
  "Wi-Fi",
  "Air conditioning",
  "Laundry",
  "Parking",
  "Pet friendly",
  "Private bathroom",
  "Utilities included",
];
const ROOM_TYPES = ["private", "shared", "entire"];
const GENDER_PREFERENCES = [
  "any",
  "women_only",
  "women_preferred",
  "men_only",
  "men_preferred",
];
/** Fields the wizard will not publish without. Photos are always the student's. */
export const REQUIRED_FIELDS = [
  "title",
  "description",
  "address",
  "price",
  "deposit",
  "bedrooms",
  "bathrooms",
  "roomType",
  "availableFrom",
  "availableTo",
  "photos",
];
const CONFIDENCE_FIELDS = [
  "title",
  "description",
  "address",
  "price",
  "deposit",
  "originalPrice",
  "bedrooms",
  "bathrooms",
  "roomType",
  "availableFrom",
  "availableTo",
  "amenities",
  "genderPreference",
];
const nullable = (type) => ({ type: [type, "null"] });
const DRAFT_PROPERTIES = {
  title: nullable("string"),
  description: nullable("string"),
  address: nullable("string"),
  price: nullable("number"),
  deposit: nullable("number"),
  originalPrice: nullable("number"),
  bedrooms: nullable("integer"),
  bathrooms: nullable("number"),
  roomType: { type: ["string", "null"], enum: [...ROOM_TYPES, null] },
  availableFrom: nullable("string"),
  availableTo: nullable("string"),
  amenities: { type: "array", items: { type: "string", enum: AMENITIES } },
  genderPreference: {
    type: ["string", "null"],
    enum: [...GENDER_PREFERENCES, null],
  },
};
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(DRAFT_PROPERTIES),
  properties: DRAFT_PROPERTIES,
};
// Strict structured outputs require every property to be listed as required,
// so absent values come back as null rather than being left out.
const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["draft", "confidence", "notes"],
  properties: {
    draft: DRAFT_SCHEMA,
    confidence: {
      type: "object",
      additionalProperties: false,
      required: CONFIDENCE_FIELDS,
      properties: Object.fromEntries(
        CONFIDENCE_FIELDS.map((field) => [
          field,
          { type: "string", enum: ["high", "medium", "low"] },
        ]),
      ),
    },
    notes: { type: "string" },
  },
};
const CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "draft", "done"],
  properties: {
    reply: { type: "string" },
    draft: DRAFT_SCHEMA,
    done: { type: "boolean" },
  },
};

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function parseSystem(campus) {
  return [
    `You extract a student sublease listing for Handoff, a student to student sublease marketplace near ${campus?.name || "the campus"} in ${campus?.city || "the city"}, ${campus?.state || ""}.`.trim(),
    `Today is ${today()}.`,
    "Read the pasted text, the screenshots and the document, and fill in only what the source actually says. Never invent a fact. Leave a field null when the source does not say.",
    "Fields:",
    "title: short and specific, 8 to 70 characters, no emojis, no all caps, no phone numbers.",
    "description: clean prose between 40 and 800 characters, rewritten in plain sentences. Remove phone numbers, email addresses, social handles, links and prices per person that contradict the rent. Keep the useful detail about the room, the roommates and the lease.",
    "address: street address plus the city when the source gives one. Never a full unit number.",
    "price: monthly rent in US dollars. Preserve any stated cents, using at most two decimal places. Never round to whole dollars.",
    "deposit: security deposit in US dollars, only when stated. Preserve any stated cents, using at most two decimal places.",
    "originalPrice: what the current lister pays on the original lease, only when stated. Preserve stated cents. It is not the asking price.",
    "bedrooms: bedrooms in the whole home. bathrooms: bathrooms in the whole home, halves allowed.",
    "roomType: private for a bedroom of their own, shared for a room with a roommate, entire for the whole home.",
    "availableFrom and availableTo: ISO dates, YYYY-MM-DD. Infer the year from today and the semester. Summer means about May 15 to August 15 of the coming summer, a fall semester about August 15 to December 20, a spring semester about January 10 to May 15. Say May to August with no year as the next such window from today.",
    `amenities: only ids from this exact list, and only when the source mentions them: ${AMENITIES.join(", ")}.`,
    "genderPreference: only when the source states a roommate preference in plain words, otherwise any.",
    "confidence: high when the source states it outright, medium when you inferred it from context, low when it is a guess.",
    "notes: one short line about anything ambiguous a student should check.",
    "House style: no em dashes and no en dashes anywhere, and no colons inside a sentence. Use a comma, a period or parentheses.",
  ].join("\n");
}

function chatSystem(campus, draft, missing) {
  return [
    `You are the Handoff listing helper. Handoff is a student to student sublease marketplace near ${campus?.name || "the campus"}.`,
    `Today is ${today()}.`,
    "You are helping one student describe their place so it can be listed. Ask exactly ONE short question per turn, in this order of need: what the place is and where it is, then the dates, then the rent and deposit, then the details and amenities, then a reminder that they add photos themselves in the editor.",
    "Acknowledge what they just told you in a few words, then ask the next question. Never ask about something that is already filled in. Never ask two things at once. Keep every reply under 45 words, warm and plain.",
    "Return the whole merged draft every turn, keeping every value you already have and adding whatever this message gave you. Never invent a value the student did not say.",
    `amenities may only use these ids: ${AMENITIES.join(", ")}. Dates are ISO, YYYY-MM-DD, with the year inferred from today and the semester.`,
    "Set done to true once the title, room type, address, dates and rent are all filled, and say in your reply that the listing is ready to open in the editor.",
    "House style: no em dashes and no en dashes anywhere, and no colons inside a sentence. Use a comma, a period or parentheses.",
    `Draft so far: ${JSON.stringify(draft || {})}`,
    `Still missing: ${(missing || []).join(", ") || "nothing"}`,
  ].join("\n");
}

const clampText = (value) =>
  String(value ?? "")
    .trim()
    .slice(0, TEXT_LIMIT);

/**
 * Screenshots are re-encoded before they leave the server. A phone screenshot
 * is often 3 MB of PNG, which is a lot of image tokens for the same words, so
 * every image is capped at 1600px and re-encoded as JPEG quality 80.
 */
async function prepareImage(file) {
  const image = sharp(file.buffer, {
    limitInputPixels: 24_000_000,
    animated: false,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format))
    throw new AiInputError("Use PNG, JPG or WebP screenshots.");
  const buffer = await image
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return {
    type: "input_image",
    detail: "auto",
    image_url: `data:image/jpeg;base64,${buffer.toString("base64")}`,
  };
}

/** Counts PDF pages without a parser. Good enough to refuse a whole lease. */
function pdfPages(buffer) {
  const text = buffer.toString("latin1");
  const counts = text.match(/\/Type\s*\/Page[^s]/g);
  return counts ? counts.length : 1;
}

export class AiInputError extends Error {}
export class AiUnavailableError extends Error {}

function preparePdf(file) {
  if (file.buffer.length > MAX_PDF_BYTES)
    throw new AiInputError("That PDF is over 8 MB. Export a smaller one.");
  if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new AiInputError("That file is not a PDF.");
  if (pdfPages(file.buffer) > MAX_PDF_PAGES)
    throw new AiInputError(
      `Use a PDF of at most ${MAX_PDF_PAGES} pages, or paste the text instead.`,
    );
  return {
    type: "input_file",
    filename: file.originalname || "listing.pdf",
    file_data: `data:application/pdf;base64,${file.buffer.toString("base64")}`,
  };
}

async function buildContent(text, files) {
  const content = [];
  const clean = clampText(text);
  let images = 0;
  let pdfs = 0;
  for (const file of files || []) {
    const type = String(file.mimetype || "").toLowerCase();
    if (IMAGE_TYPES.has(type)) {
      if (images >= MAX_IMAGES) continue;
      images += 1;
      content.push(await prepareImage(file));
    } else if (type === PDF_TYPE) {
      if (pdfs >= 1) continue;
      pdfs += 1;
      content.push(preparePdf(file));
    } else {
      throw new AiInputError(
        "Attach PNG, JPG or WebP screenshots, or one PDF.",
      );
    }
  }
  if (!clean && !content.length)
    throw new AiInputError(
      "Paste the listing text, or add a screenshot or PDF.",
    );
  content.push({
    type: "input_text",
    text: clean
      ? `Here is the listing to extract.\n\n${clean}`
      : "Extract the listing from the attached files.",
  });
  return content;
}

const usageOf = (response) => ({
  inputTokens: Number(response?.usage?.input_tokens || 0),
  outputTokens: Number(response?.usage?.output_tokens || 0),
  model: String(response?.model || MODEL()),
});

function readJson(response) {
  const text =
    typeof response?.output_text === "string" && response.output_text
      ? response.output_text
      : "";
  if (!text) throw new AiUnavailableError("The model returned nothing.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AiUnavailableError("The model returned an unreadable answer.");
  }
}

const num = (value, { min = 0, max = 1_000_000, integer = true } = {}) => {
  // Absent stays absent. Number(null) is 0, which would read as a real answer.
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return integer ? Math.round(parsed) : parsed;
};
const cents = z.number().multipleOf(0.01);
const money = (value, max) => {
  const parsed = num(value, { max, integer: false });
  // Invalid precision stays missing for student review, never silently rounded.
  return cents.safeParse(parsed).success ? parsed : null;
};
const str = (value, max) => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : "";
};
const isoDate = (value) => {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === text ? text : "";
};
/**
 * Contact details belong in the handoff request flow, never in a public
 * listing, so a phone number or an email that survived the model is removed.
 */
export function stripContacts(text) {
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(
      /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

/** Everything the model sends is re-typed here before the client sees it. */
function cleanDraft(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  // Left empty until the source or the student actually says which it is, so
  // the chat panel never reports a room type nobody chose.
  const roomType = ROOM_TYPES.includes(source.roomType) ? source.roomType : "";
  const amenities = Array.isArray(source.amenities)
    ? [...new Set(source.amenities.filter((item) => AMENITIES.includes(item)))]
    : [];
  const draft = {
    title: stripContacts(str(source.title, 100)),
    description: stripContacts(str(source.description, 800)),
    address: str(source.address, 200),
    price: money(source.price, 50000),
    deposit: money(source.deposit, 100000),
    originalPrice: money(source.originalPrice, 50000),
    bedrooms: num(source.bedrooms, { max: 20 }),
    bathrooms: num(source.bathrooms, { max: 20, integer: false }),
    roomType,
    genderPreference:
      roomType !== "entire" &&
      GENDER_PREFERENCES.includes(source.genderPreference)
        ? source.genderPreference
        : "any",
    availableFrom: isoDate(source.availableFrom),
    availableTo: isoDate(source.availableTo),
    amenities,
    lat: null,
    lng: null,
    photos: [],
  };
  if (draft.bathrooms !== null)
    draft.bathrooms = Math.round(draft.bathrooms * 2) / 2;
  if (draft.availableFrom && draft.availableTo && draft.availableTo < draft.availableFrom)
    draft.availableTo = "";
  return draft;
}

const filled = (draft, field) => {
  const value = draft[field];
  if (field === "photos") return Array.isArray(value) && value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value);
};

/** A field is missing when it is empty, or when the model was only guessing. */
export function missingFields(draft, confidence = {}) {
  return REQUIRED_FIELDS.filter(
    (field) => !filled(draft, field) || confidence[field] === "low",
  );
}

/**
 * A turn may only add. An empty value coming back from the model never wipes
 * something the student already told us.
 */
function mergeDraft(current, incoming) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(
    incoming && typeof incoming === "object" ? incoming : {},
  )) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    merged[key] = value;
  }
  return merged;
}

async function placePin(draft, campus) {
  if (!draft.address || !campus) return draft;
  try {
    const results = await geocode(draft.address, campus);
    const best = results[0];
    if (!best) return draft;
    return {
      ...draft,
      address: best.place ? `${best.line}, ${best.place}` : draft.address,
      lat: best.lat,
      lng: best.lng,
      pinSource: "auto",
    };
  } catch {
    // The geocoders are best effort. The lister places the pin by hand.
    return draft;
  }
}

/** Dev only shortcut so the app can be walked through without a key. */
export function mockEnabled(env = process.env) {
  if (env.HANDOFF_AI_MOCK !== "1") return false;
  if (env.NODE_ENV === "production")
    throw new Error("HANDOFF_AI_MOCK is a development switch only.");
  return true;
}

function mockParse(text) {
  const source = String(text || "");
  const price = Number(source.match(/\$\s?(\d{3,5})/)?.[1] || 1150);
  return {
    draft: {
      title: "Private room in a 3 bedroom near campus",
      description:
        "A furnished private bedroom in a three bedroom apartment a short walk from campus. Two friendly roommates stay for the summer, the kitchen and laundry are shared, and the room has its own closet and desk.",
      address: "1201 West 30th Street, Los Angeles",
      price,
      deposit: null,
      originalPrice: null,
      bedrooms: 3,
      bathrooms: 2,
      roomType: "private",
      genderPreference: "any",
      availableFrom: "2027-05-20",
      availableTo: "2027-08-15",
      amenities: ["Furnished", "Wi-Fi", "Laundry", "Air conditioning"],
    },
    confidence: {
      title: "high",
      description: "high",
      address: "high",
      price: "high",
      deposit: "low",
      originalPrice: "low",
      bedrooms: "high",
      bathrooms: "medium",
      roomType: "high",
      availableFrom: "medium",
      availableTo: "medium",
      amenities: "high",
      genderPreference: "low",
    },
    notes: "The post did not mention a deposit, so confirm it before you publish.",
  };
}

const MOCK_TURNS = [
  "Happy to help. What kind of place is it, a private room, a shared room or the whole home, and roughly where is it?",
  "Got it. When would the sublease start and end?",
  "Thanks. What is the monthly rent, and is there a deposit?",
  "Nice. Anything included, like furniture, laundry, parking or utilities?",
  "That is everything I need. Add your photos in the editor and your listing is ready to open.",
];

function mockChat(messages, draft) {
  const turns = (messages || []).filter((m) => m.role === "user").length;
  const index = Math.min(turns, MOCK_TURNS.length - 1);
  const merged = { ...mockParse("").draft, ...(draft || {}) };
  const partial =
    index === 0
      ? {}
      : index === 1
        ? { title: merged.title, roomType: "private", address: merged.address }
        : index === 2
          ? {
              title: merged.title,
              roomType: "private",
              address: merged.address,
              availableFrom: "2027-05-20",
              availableTo: "2027-08-15",
            }
          : {
              ...merged,
              deposit: 500,
            };
  return {
    reply: MOCK_TURNS[index],
    draft: { ...(draft || {}), ...partial },
    done: index >= MOCK_TURNS.length - 1,
  };
}

/**
 * One shot extraction. text is the pasted post, files are the multer files
 * (up to four screenshots and one PDF), campus places the pin, and client is
 * injected so tests and the dev mock never reach the network.
 */
export async function parseListing({ text, files, campus, client }) {
  const content = await buildContent(text, files);
  let result;
  let usage = { inputTokens: 0, outputTokens: 0, model: "mock" };
  if (!client) {
    if (!mockEnabled()) throw new AiUnavailableError("No model client.");
    result = mockParse(text);
  } else {
    const response = await client.responses.create({
      model: MODEL(),
      instructions: parseSystem(campus),
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "listing_draft",
          strict: true,
          schema: PARSE_SCHEMA,
        },
      },
    });
    result = readJson(response);
    usage = usageOf(response);
  }
  const draft = await placePin(cleanDraft(result.draft), campus);
  return {
    draft,
    missing: missingFields(draft, result.confidence || {}),
    notes: str(result.notes, 240),
    usage,
  };
}

/**
 * One stateless conversation turn. The client keeps the history and the draft,
 * the server keeps nothing, and the model returns the merged draft each time.
 */
export async function chatListing({ messages, draft, campus, client }) {
  const history = (Array.isArray(messages) ? messages : [])
    .slice(-24)
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: clampText(m.content).slice(0, 4000) }))
    .filter((m) => m.content);
  const current = cleanDraft(draft);
  const before = missingFields(current);
  let result;
  let usage = { inputTokens: 0, outputTokens: 0, model: "mock" };
  if (!client) {
    if (!mockEnabled()) throw new AiUnavailableError("No model client.");
    result = mockChat(history, current);
  } else {
    const response = await client.responses.create({
      model: MODEL(),
      instructions: chatSystem(campus, current, before),
      input: history.length
        ? history
        : [{ role: "user", content: "I want to list my place." }],
      text: {
        format: {
          type: "json_schema",
          name: "listing_draft",
          strict: true,
          schema: CHAT_SCHEMA,
        },
      },
    });
    result = readJson(response);
    usage = usageOf(response);
  }
  const merged = await placePin(cleanDraft(mergeDraft(current, result.draft)), campus);
  const missing = missingFields(merged);
  return {
    reply: str(result.reply, 700) || "Tell me a little more about the place.",
    draft: merged,
    missing,
    done: Boolean(result.done),
    usage,
  };
}
