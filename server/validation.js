import { z } from "zod";
import { CAMPUSES } from "./config.js";
import { HttpError } from "./security.js";

const text = (max) => z.string().trim().max(max);
export const password = z
  .string()
  .min(10, "Use a password with at least 10 characters.")
  .max(128);
export const email = z.string().trim().toLowerCase().email().max(254);
export const campus = z.enum(CAMPUSES.map((item) => item.id));
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
export const signupSchema = z
  .object({ name: text(80).min(2), email, password, campusId: campus })
  .strict()
  .refine(
    (data) => {
      const domain = data.email.split("@")[1];
      const school = CAMPUSES.find((item) => item.id === data.campusId);
      return domain === school.domain || domain.endsWith(`.${school.domain}`);
    },
    { message: "Use your selected university email address.", path: ["email"] },
  );
export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const profileSchema = z
  .object({ name: text(80).min(2), bio: text(600) })
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
