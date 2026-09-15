/** How a student describes themselves. Never required, never public. */
export type Gender = "woman" | "man" | "nonbinary" | "unspecified";
/**
 * A lister's roommate preference. Offered only on private and shared rooms,
 * where the lister or their roommates live in the home.
 */
export type GenderPreference =
  | "any"
  | "women_only"
  | "women_preferred"
  | "men_only"
  | "men_preferred";
export const GENDERS: Gender[] = ["woman", "man", "nonbinary", "unspecified"];
export const GENDER_LABELS: Record<Gender, string> = {
  woman: "Woman",
  man: "Man",
  nonbinary: "Non-binary",
  unspecified: "Prefer not to say",
};
export const GENDER_PREFERENCES: GenderPreference[] = [
  "any",
  "women_preferred",
  "women_only",
  "men_preferred",
  "men_only",
];
export const GENDER_PREFERENCE_LABELS: Record<GenderPreference, string> = {
  any: "Anyone",
  women_preferred: "Women preferred",
  women_only: "Women only",
  men_preferred: "Men preferred",
  men_only: "Men only",
};
export type Campus = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  domain: string;
  /** Campuses students can pick today. The rest are waitlist only. */
  live?: boolean;
};
/** The student's own school, whether or not Handoff has opened there. */
export type School = {
  name: string;
  domain: string;
  /** True when listing is open at this school. */
  live: boolean;
};
export type User = {
  id: string;
  name: string;
  email: string;
  /** The live campus this student may post at, null when theirs is not open. */
  campusId: string | null;
  school: School;
  verified: boolean;
  termsAccepted: boolean;
  bio: string;
  /** Shared with listers only through roommate preferences. */
  gender: Gender;
  /** Opens the internal dashboard at /admin. False for every student. */
  isAdmin: boolean;
};
export type Listing = {
  id: string;
  ownerId: string;
  ownerName: string;
  campusId: string;
  title: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  price: number;
  deposit: number;
  /** What the lister pays on the original lease, when shared. */
  originalPrice: number | null;
  bedrooms: number;
  bathrooms: number;
  roomType: "private" | "shared" | "entire";
  /** Roommate preference. Always "any" for an entire place. */
  genderPreference: GenderPreference;
  availableFrom: string;
  availableTo: string;
  amenities: string[];
  photos: string[];
  status: "draft" | "active" | "handed_off" | "archived";
  createdAt: string;
  updatedAt: string;
  /** End of the current boost window, ISO timestamp, or null. */
  boostUntil: string | null;
  /** True while boostUntil is still in the future. */
  boosted: boolean;
  saved?: boolean;
};
export type BoostStats = {
  views: number;
  requests: number;
  boostUntil: string | null;
};
export type HandoffRequest = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPhoto: string;
  requesterId: string;
  requesterName: string;
  ownerId: string;
  ownerName: string;
  message: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  createdAt: string;
  updatedAt: string;
  contact?: { name: string; email: string };
  /** Only sent to the lister, and only when the requester shared it. */
  requesterGender?: Gender;
};
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
export const ROOM_LABELS = {
  private: "Private room",
  shared: "Shared room",
  entire: "Entire place",
};
export const STATUS_LABELS = {
  draft: "Draft",
  active: "Live",
  handed_off: "Handed off",
  archived: "Archived",
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
};
