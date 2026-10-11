import type { ImportDraft } from "./import";

export type Referral = {
  id: string;
  status: "pending" | "claimed" | "revoked";
  campusId: "usc";
  authorName: string;
  sourceName: string;
  sourceUrl: string;
  sourcePostedAt: string | null;
  listing: Partial<ImportDraft>;
  photos: { id: string; url: string }[];
  missing: string[];
  claimedByMe: boolean;
  listingId: string | null;
  listingStatus: string | null;
};
export type ReferralResponse = {
  referral: Referral;
  next: { signUpUrl: string; signInUrl: string; reviewUrl: string };
};
export const referralPath = (token: string) =>
  `/referrals/${encodeURIComponent(token)}`;
export const missingLabel: Record<string, string> = {
  title: "title",
  description: "description",
  address: "address",
  price: "monthly rent",
  deposit: "deposit",
  originalPrice: "original rent",
  bedrooms: "bedroom count",
  bathrooms: "bathroom count",
  roomType: "room type",
  availableFrom: "move-in date",
  availableTo: "move-out date",
  lat: "map pin",
  lng: "map pin",
  photos: "photos",
};
