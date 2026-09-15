import { z } from "zod";
import { CAMPUSES } from "./config.js";
import { HttpError } from "./security.js";
import { isCommonPassword, normalizePassword } from "./common-passwords.js";

const text = (max) => z.string().trim().max(max);

/**
 * Password rules, mirrored by src/lib/password.ts so the meter a student sees
 * and the answer the server gives never disagree. One message at a time, so
 * the student is told the single thing that is missing.
 */
export function passwordProblem(value, { email: address = "", name = "" } = {}) {
  const raw = String(value ?? "");
  if (raw.length < 10) return "Use a password with at least 10 characters.";
  if (raw.length > 128) return "Use a password with at most 128 characters.";
  if (!/[a-zA-Z]/.test(raw)) return "Add at least one letter to your password.";
  if (!/\d/.test(raw)) return "Add at least one number to your password.";
  const folded = normalizePassword(raw);
  const local = String(address).split("@")[0].toLowerCase();
  if (local.length >= 3 && (folded.includes(local) || raw.toLowerCase().includes(local)))
    return "Do not put your email address in your password.";
  for (const part of String(name).toLowerCase().split(/[^a-z]+/))
    if (part.length >= 3 && (folded.includes(part) || raw.toLowerCase().includes(part)))
      return "Do not put your name in your password.";
  if (isCommonPassword(raw))
    return "That password is one of the most common ones. Choose something only you would pick.";
  return "";
}

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
 * Signup takes no campus. The server reads the school out of the email, so a
 * student can never claim a campus that is not theirs.
 */
export const signupSchema = z
  .object({
    name: text(80).min(2),
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
    name: text(80).min(2),
    bio: text(600),
    gender: gender.optional(),
  })
  .strict();
export const listingSchema = z
  .object({
    title: text(100).default(""),
    description: text(5000).default(""),
    address: text(200).default(""),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    price: z.number().int().min(0).max(50000).default(0),
    deposit: z.number().int().min(0).max(100000).default(0),
    originalPrice: z.number().int().min(0).max(50000).nullable().default(null),
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
      .max(8)
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
    minPrice: z.coerce.number().int().min(0).max(50000).optional(),
    maxPrice: z.coerce.number().int().min(0).max(50000).optional(),
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
