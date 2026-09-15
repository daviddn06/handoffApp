import { useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Heart, Image, Users, Zap } from "lucide-react";
import type { Campus, Listing } from "../types";
import { GENDER_PREFERENCE_LABELS, ROOM_LABELS } from "../types";
import { api, dateLabel, errorMessage, money, savings } from "../lib/api";
import { useApp } from "../lib/context";
import { distanceLabel, milesBetween, travelLabel } from "../lib/dps";

export function SaveButton({
  listing,
  onChange,
  large = false,
  size = "default",
}: {
  listing: Listing;
  onChange?: (saved: boolean) => void;
  large?: boolean;
  size?: "default" | "large";
}) {
  const { user, notify, openAuth } = useApp();
  const [saved, setSaved] = useState(!!listing.saved),
    [busy, setBusy] = useState(false),
    [pop, setPop] = useState(false);
  async function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      // Signed out, confirm who they are without leaving the page.
      openAuth({ reason: "save" });
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ saved: boolean }>(`/saved/${listing.id}`, {
        method: saved ? "DELETE" : "POST",
      });
      setSaved(result.saved);
      if (result.saved) {
        setPop(false);
        requestAnimationFrame(() => setPop(true));
      }
      onChange?.(result.saved);
      notify(
        result.saved
          ? "Added to your saved places."
          : "Removed from saved places.",
      );
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className={`${large ? `button secondary${size === "large" ? " large" : ""}` : "save-button"} ${saved ? "is-saved" : ""} ${pop ? "is-popping" : ""}`}
      disabled={busy}
      aria-label={saved ? "Unsave listing" : "Save listing"}
      aria-pressed={saved}
      onClick={toggle}
      onAnimationEnd={() => setPop(false)}
    >
      <Heart size={large ? 17 : 16} fill={saved ? "currentColor" : "none"} />
      {large && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}

/** "Save $250/mo" tag shown wherever a sublease is below the original lease. */
export function SavingsTag({
  listing,
  detailed = false,
}: {
  listing: Listing;
  detailed?: boolean;
}) {
  const save = savings(listing);
  if (!save) return null;
  return (
    <span
      className="savings-tag"
      title={`Original lease ${money(save.original)} per month`}
    >
      Save {money(save.amount)}
      {detailed ? ` (${save.percent}% below the original lease)` : "/mo"}
    </span>
  );
}

/** Boosted reads as one small mark over the photo, never a body pill. */
export function BoostBadge({ listing }: { listing: Listing }) {
  if (!listing.boosted) return null;
  return (
    <span className="boost-badge" title="Boosted" aria-label="Boosted listing">
      <Zap size={12} fill="currentColor" strokeWidth={0} />
    </span>
  );
}

/**
 * The roommate preference as a mark over the photo, beside the boost badge.
 * On one line of text it truncated, here it always reads.
 */
export function PreferenceBadge({ listing }: { listing: Listing }) {
  const preference = listing.genderPreference;
  if (preference === "any") return null;
  const tone = preference.startsWith("women") ? "rose" : "blue";
  return (
    <span
      className={`preference-badge tone-${tone}`}
      title={GENDER_PREFERENCE_LABELS[preference]}
      aria-label={GENDER_PREFERENCE_LABELS[preference]}
    >
      <Users size={12} />
    </span>
  );
}

/** Room, beds and baths. Nothing else, so it never has to truncate. */
export function CardFacts({ listing }: { listing: Listing }) {
  const beds = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bd`;
  return (
    <p className="card-meta card-facts">
      {ROOM_LABELS[listing.roomType]} · {beds} · {listing.bathrooms} ba
    </p>
  );
}

export function ListingCard({
  listing,
  campus,
  variant = "grid",
  active = false,
  onHover,
  onSaveChange,
  registerRef,
}: {
  listing: Listing;
  campus?: Campus;
  variant?: "grid" | "compact";
  active?: boolean;
  onHover?: (id: string | null) => void;
  onSaveChange?: (saved: boolean) => void;
  registerRef?: (id: string, el: HTMLElement | null) => void;
}) {
  const { user } = useApp();
  const [index, setIndex] = useState(0);
  const photos = listing.photos;
  const photo = photos[index] || photos[0];
  const miles = campus ? milesBetween(campus, listing) : null;
  const save = savings(listing);
  const hover = {
    onMouseEnter: () => onHover?.(listing.id),
    onMouseLeave: () => onHover?.(null),
    onFocus: () => onHover?.(listing.id),
    onBlur: () => onHover?.(null),
  };
  const step = (e: MouseEvent, dir: 1 | -1) => {
    e.preventDefault();
    e.stopPropagation();
    if (photos.length < 2) return;
    setIndex((index + dir + photos.length) % photos.length);
  };
  return (
    <article
      className={`listing-card ${variant} ${active ? "is-active" : ""}`}
      ref={(el) => registerRef?.(listing.id, el)}
      {...hover}
    >
      <Link
        to={`/listings/${listing.id}`}
        className="card-link"
        aria-label={`${listing.title}, ${money(listing.price)} per month`}
      />
      <div className="card-photo">
        <span className="card-badges">
          <BoostBadge listing={listing} />
          <PreferenceBadge listing={listing} />
        </span>
        {photo ? (
          <img src={photo} alt="" loading="lazy" />
        ) : (
          <div className="photo-placeholder">
            <Image size={22} strokeWidth={1.3} />
            <span>No photos yet</span>
          </div>
        )}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              className="photo-step prev"
              aria-label="Previous photo"
              onClick={(e) => step(e, -1)}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              className="photo-step next"
              aria-label="Next photo"
              onClick={(e) => step(e, 1)}
            >
              <ChevronRight size={15} />
            </button>
            <div className="photo-dots" aria-hidden="true">
              {photos.slice(0, 6).map((_, i) => (
                <span key={i} className={i === index ? "is-on" : ""} />
              ))}
            </div>
          </>
        )}
        {user?.id !== listing.ownerId && (
          <SaveButton
            key={String(listing.saved)}
            listing={listing}
            onChange={onSaveChange}
          />
        )}
      </div>
      <div className="card-body">
        <div className="card-topline">
          <div className="card-price">
            <strong>{money(listing.price)}</strong>
            <span>/mo</span>
          </div>
          {save && (
            <span
              className="savings-tag"
              title={`Original lease ${money(save.original)} a month`}
            >
              Save {money(save.amount)}
            </span>
          )}
        </div>
        <h2 className="card-title">{listing.title}</h2>
        <CardFacts listing={listing} />
        <p className="card-meta card-dates">
          {dateLabel(listing.availableFrom)} to {dateLabel(listing.availableTo)}
          {miles !== null && (
            <>
              {" · "}
              <span
                className="card-distance"
                title={`${distanceLabel(miles)} from ${campus?.name}`}
              >
                {travelLabel(miles)}
              </span>
            </>
          )}
        </p>
      </div>
    </article>
  );
}
