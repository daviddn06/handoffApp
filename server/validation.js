import { z } from "zod";
import { CAMPUSES } from "./config.js";
import { HttpError } from "./security.js";

const text = (max) => z.string().trim().max(max);

/**
 * Password rules, mirrored by src/lib/password.ts so the meter a student sees
 * and the answer the server gives never disagree. One message at a time, so
 * the student is told the single thing that is missing.
 */
export function passwordProblem(value, { email: address = "", name = "" } = {}) {
  const raw = String(value ?? "");
  // Eight characters is the whole rule. The meter advises, nothing else refuses.
  void address;
  void name;
  if (raw.length < 8) return "Use a password with at least 8 characters.";
  if (raw.length > 128) return "Use a password with at most 128 characters.";
  return "";
}

/**
 * A student's name is a first name and a last name. Two words of letters, with
 * apostrophes and hyphens allowed inside a word, so O'Brien and Smith-Jones
 * pass and a single word does not. Mirrored by src/lib/name.ts so the message
 * a student sees and the answer the server gives never disagree.
 */
export const NAME_PROBLEM = "Enter your first and last name.";
const NAME_WORD = "\\p{L}+(?:['\u2019-]\\p{L}+)*";
const NAME_PATTERN = new RegExp(`^${NAME_WORD}(?:\\s+${NAME_WORD})+$`, "u");
export function nameProblem(value) {
  const raw = String(value ?? "").trim();
  if (raw.length > 80) return "Use a name with at most 80 characters.";
  return NAME_PATTERN.test(raw) ? "" : NAME_PROBLEM;
}
/**
 * Auto capitalisation, kept deliberately simple. The first letter of every
 * word goes up, and the rest of the word is left as it was typed, so McDonald
 * survives. An input typed entirely in lower case has the rest lowered too,
 * which is the same thing said plainly. A hyphen starts a new word, an
 * apostrophe does not, so "o'brien" becomes "O'brien".
 */
export function titleCaseName(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const allLower = raw === raw.toLowerCase();
  return raw.replace(
    /(^|[\s-])(\p{L})(\p{L}*)/gu,
    (_match, lead, first, rest) =>
      `${lead}${first.toUpperCase()}${allLower ? rest.toLowerCase() : rest}`,
  );
}
/** The name field, validated then capitalised before anything stores it. */
export const fullName = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = nameProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  })
  .transform(titleCaseName);

/** A standalone password field, used where no account context is available. */
export const password = z
  .string()
  .max(128)
  .superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
export const email = z.string().trim().toLowerCase().email().max(254);
export const campus = z.enum(CAMPUSES.map((item) => item.id));
/** Optional, defaults to unspecified, and never required to use Handoff. */
export const gender = z.enum(["woman", "man", "nonbinary", "unspecified"]);
/**
 * Roommate preference. Lawful only for shared living where the lister or their
 * roommates live in the home, so the server forces "any" on an entire place.
 */
export const genderPreference = z.enum([
  "any",
  "women_only",
  "women_preferred",
  "men_only",
  "men_preferred",
]);
export const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid date.");
/**
 * Contact channels. Email is the verified identity, so it is always in the
 * shared set and can never be taken out of it.
 */
export const CHANNELS = ["email", "phone", "instagram", "facebook"];
export const OPTIONAL_CHANNELS = ["phone", "instagram", "facebook"];
export const channel = z.enum(CHANNELS);

/**
 * A US phone number, stored in E.164. Ten digits, or eleven with a leading 1.
 * An empty field clears the number.
 */
export function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/[^0-9()+\-.\s]/.test(raw))
    throw new HttpError(400, "Enter a US phone number, like (213) 555-0142.");
  const digits = raw.replace(/\D/g, "");
  const national =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("1")
        ? digits.slice(1)
        : "";
  if (!national)
    throw new HttpError(400, "Enter a US phone number, like (213) 555-0142.");
  return `+1${national}`;
}

/**
 * An Instagram handle without the @. A pasted profile link is cut down to the
 * handle, so a student can paste whatever they have.
 */
export function normalizeInstagram(value) {
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  const link = raw.match(
    /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?instagram\.com\/([^/?#\s]+)/i,
  );
  if (link) raw = link[1];
  raw = raw.replace(/^@+/, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(raw))
    throw new HttpError(
      400,
      "Enter an Instagram handle of letters, numbers, periods and underscores.",
    );
  return raw;
}

/**
 * Facebook is either a profile link or a username. A link is kept as it was
 * typed, because Facebook profile links take several shapes.
 */
export function normalizeFacebook(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?facebook\.com\/\S*$/i.test(raw))
    return raw;
  const handle = raw.replace(/^@+/, "");
  if (!/^[A-Za-z0-9.]{5,50}$/.test(handle))
    throw new HttpError(
      400,
      "Enter a Facebook profile link or a username of at least 5 letters, numbers or periods.",
    );
  return handle;
}

/**
 * The channels shared when a request is accepted. Email is always in, and a
 * channel with nothing in it is dropped rather than promised.
 */
export function normalizeShareChannels(requested, values) {
  const available = new Set(["email"]);
  for (const name of OPTIONAL_CHANNELS)
    if (values?.[name]) available.add(name);
  const chosen = new Set(["email"]);
  for (const name of Array.isArray(requested) ? requested : [])
    if (available.has(name)) chosen.add(name);
  return CHANNELS.filter((name) => chosen.has(name));
}

/** The stored JSON array, read back safely whatever is in the column. */
export function readShareChannels(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return ["email"];
    const chosen = new Set(parsed.filter((name) => CHANNELS.includes(name)));
    chosen.add("email");
    return CHANNELS.filter((name) => chosen.has(name));
  } catch {
    return ["email"];
  }
}

/**
 * Signup takes no campus. The server reads the school out of the email, so a
 * student can never claim a campus that is not theirs.
 */
export const signupSchema = z
  .object({
    /* The name is asked for after the account exists, so signup may arrive
       without one. When it is there it follows the first and last name rule. */
    name: fullName.optional(),
    email,
    password: z.string().max(128),
    gender: gender.default("unspecified"),
  })
  .strict()
  .superRefine((data, ctx) => {
    const problem = passwordProblem(data.password, {
      email: data.email,
      name: data.name,
    });
    if (problem)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problem,
        path: ["password"],
      });
  });
export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const profileSchema = z
  .object({
    name: fullName,
    bio: text(600),
    gender: gender.optional(),
    /* Raw contact input. The server normalises and stores it. */
    phone: text(40).optional(),
    instagram: text(120).optional(),
    facebook: text(200).optional(),
    shareChannels: z.array(channel).max(CHANNELS.length).optional(),
  })
  .strict();
export const listingSchema = z
  .object({
    title: text(100).default(""),
    description: text(5000).default(""),
    address: text(200).default(""),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    price: z.number().min(0).max(50000).multipleOf(0.01).default(0),
    deposit: z.number().min(0).max(100000).multipleOf(0.01).default(0),
    originalPrice: z.number().min(0).max(50000).multipleOf(0.01).nullable().default(null),
    bedrooms: z.number().int().min(0).max(20).default(1),
    bathrooms: z.number().min(0).max(20).multipleOf(0.5).default(1),
    roomType: z.enum(["private", "shared", "entire"]).default("private"),
    genderPreference: genderPreference.default("any"),
    availableFrom: z.union([date, z.literal("")]).default(""),
    availableTo: z.union([date, z.literal("")]).default(""),
    amenities: z
      .array(text(50).min(1))
      .max(20)
      .transform((items) => [...new Set(items)])
      .default([]),
    photos: z
      .array(z.string().regex(/^\/uploads\/[a-f0-9-]{36}\.webp$/))
      .max(16)
      .transform((items) => [...new Set(items)])
      .default([]),
    status: z
      .enum(["draft", "active", "handed_off", "archived"])
      .default("draft"),
  })
  .strict();
export const createListingSchema = listingSchema.refine(
  (data) => ["draft", "active"].includes(data.status),
  { message: "A new listing must be a draft or active.", path: ["status"] },
);
// Remove creation defaults so a partial update preserves every omitted field.
export const patchListingSchema = z
  .object(
    Object.fromEntries(
      Object.entries(listingSchema.shape).map(([key, schema]) => [
        key,
        (schema instanceof z.ZodDefault
          ? schema.removeDefault()
          : schema
        ).optional(),
      ]),
    ),
  )
  .strict();
export const listingQuerySchema = z
  .object({
    campusId: campus.optional(),
    query: text(120).optional(),
    minPrice: z.coerce.number().min(0).max(50000).multipleOf(0.01).optional(),
    maxPrice: z.coerce.number().min(0).max(50000).multipleOf(0.01).optional(),
    from: date.optional(),
    to: date.optional(),
    roomType: z.enum(["private", "shared", "entire"]).optional(),
    gender: z.enum(["women", "men", "women_only", "men_only"]).optional(),
    bedrooms: z.coerce.number().int().min(0).max(20).optional(),
    amenities: text(1000).optional(),
    sort: z
      .enum(["newest", "price_asc", "price_desc", "savings"])
      .default("newest"),
  })
  .strict()
  .refine(
    (data) =>
      data.minPrice === undefined ||
      data.maxPrice === undefined ||
      data.minPrice <= data.maxPrice,
    { message: "Minimum price must not exceed maximum price." },
  )
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: "Move-out must be on or after move-in.",
  });
export const boostSchema = z
  .object({ kind: z.enum(["launch", "paid"]) })
  .strict();
export const requestSchema = z
  .object({
    listingId: z.string().uuid(),
    message: text(1500).min(
      10,
      "Write a short introduction of at least 10 characters.",
    ),
    /* What this one request shares, when it differs from the profile default. */
    shareChannels: z.array(channel).max(CHANNELS.length).optional(),
  })
  .strict();
export const requestUpdateSchema = z
  .object({ status: z.enum(["accepted", "declined", "withdrawn"]) })
  .strict();
export const reportSchema = z
  .object({
    listingId: z.string().uuid(),
    reason: text(80).min(3),
    details: text(2000).default(""),
  })
  .strict();
export function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first.path.join(".");
    throw new HttpError(400, `${field ? `${field}: ` : ""}${first.message}`);
  }
  return parsed.data;
}
export function today() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}
/**
 * Fair housing. A roommate preference is lawful only for shared living where
 * the lister or their roommates live in the home, so an entire place is always
 * open to anyone whatever the client sent.
 */
export function enforceGenderPreference(data) {
  if (data.roomType === "entire") data.genderPreference = "any";
  return data;
}
export function validateListing(data) {
  if (
    data.availableFrom &&
    data.availableTo &&
    data.availableFrom > data.availableTo
  )
    throw new HttpError(400, "Move-out must be on or after move-in.");
  if (data.status !== "active") return;
  if (data.title.length < 8)
    throw new HttpError(400, "Add a listing title with at least 8 characters.");
  if (data.description.length < 30)
    throw new HttpError(400, "Describe your place in at least 30 characters.");
  if (data.address.length < 5)
    throw new HttpError(400, "Add the property street or neighborhood.");
  if (data.price < 1 || data.bathrooms < 0.5)
    throw new HttpError(
      400,
      "Set a monthly rent and at least one half bathroom.",
    );
  if (!data.availableFrom || !data.availableTo || data.availableTo < today())
    throw new HttpError(400, "Choose current or future availability.");
  if (!data.photos.length)
    throw new HttpError(400, "Add at least one photo before publishing.");
}
