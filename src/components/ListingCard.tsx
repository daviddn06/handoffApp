import { useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Heart, Image, Zap } from "lucide-react";
import type { Campus, Listing } from "../types";
import { ROOM_LABELS } from "../types";
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
  const { user, notify } = useApp(),
    navigate = useNavigate();
  const [saved, setSaved] = useState(!!listing.saved),
    [busy, setBusy] = useState(false),
    [pop, setPop] = useState(false);
  async function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate(
        `/sign-in?next=${encodeURIComponent("/listings/" + listing.id)}`,
      );
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
  const beds = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bd`;
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
          {listing.boosted && (
            <span className="boost-tag" title="Boosted listing">
              <Zap size={11} fill="currentColor" strokeWidth={0} />
              Boosted
            </span>
          )}
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
        <p className="card-meta">
          {ROOM_LABELS[listing.roomType]} · {beds} · {listing.bathrooms} ba
        </p>
        <p className="card-meta">
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
