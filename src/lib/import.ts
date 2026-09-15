// Shared pieces of Smart import. The draft shape the server returns, the
// handover to the editor through sessionStorage, and the two small transitions
// the import and chat screens use.
import type { GenderPreference, Listing } from "../types";

export type ImportDraft = {
  title: string;
  description: string;
  address: string;
  price: number | null;
  deposit: number | null;
  originalPrice: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  roomType: Listing["roomType"] | "";
  genderPreference: GenderPreference;
  availableFrom: string;
  availableTo: string;
  amenities: string[];
  lat: number | null;
  lng: number | null;
  photos: string[];
  pinSource?: "auto";
};
export type ImportResult = {
  draft: ImportDraft;
  missing: string[];
  notes: string;
};
export type ChatResult = ImportResult & { reply: string; done: boolean };
/** The handover key. Written by import or chat, read once by the editor. */
export const IMPORT_KEY = "handoff:import";
/** Labels for the fields the wizard needs, used by hints and the chat panel. */
export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  address: "Address",
  price: "Monthly rent",
  deposit: "Deposit",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  roomType: "Room type",
  availableFrom: "Move-in date",
  availableTo: "Move-out date",
  photos: "Photos",
};
/** Which wizard step each field lives on, so the rail can mark the step. */
export const FIELD_STEP: Record<string, number> = {
  title: 0,
  roomType: 0,
  bedrooms: 0,
  bathrooms: 0,
  address: 1,
  price: 2,
  deposit: 2,
  availableFrom: 2,
  availableTo: 2,
  description: 3,
  photos: 4,
};
export const emptyDraft = (): ImportDraft => ({
  title: "",
  description: "",
  address: "",
  price: null,
  deposit: null,
  originalPrice: null,
  bedrooms: null,
  bathrooms: null,
  roomType: "",
  genderPreference: "any",
  availableFrom: "",
  availableTo: "",
  amenities: [],
  lat: null,
  lng: null,
  photos: [],
});
export function storeImport(result: ImportResult) {
  try {
    sessionStorage.setItem(
      IMPORT_KEY,
      JSON.stringify({ draft: result.draft, missing: result.missing }),
    );
  } catch {
    // A private window with storage off still gets the empty wizard.
  }
}
export function takeImport(): {
  draft: Partial<ImportDraft>;
  missing: string[];
} | null {
  try {
    const raw = sessionStorage.getItem(IMPORT_KEY);
    sessionStorage.removeItem(IMPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.draft !== "object") return null;
    return {
      draft: parsed.draft,
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    };
  } catch {
    return null;
  }
}
/** True once the chat has enough for the editor to be worth opening. */
export const readyForEditor = (draft: ImportDraft) =>
  Boolean(draft.title && draft.roomType && draft.price && draft.address);
