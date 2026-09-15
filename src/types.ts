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
