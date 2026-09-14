export type Campus = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  domain: string;
};
export type User = {
  id: string;
  name: string;
  email: string;
  campusId: string;
  verified: boolean;
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
  saved?: boolean;
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
