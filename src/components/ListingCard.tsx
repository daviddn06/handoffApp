import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BedDouble,
  CalendarDays,
  Heart,
  Image,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import type { Listing } from "../types";
import { ROOM_LABELS } from "../types";
import { api, dateLabel, errorMessage, money } from "../lib/api";
import { useApp } from "../lib/context";
export function SaveButton({
  listing,
  onChange,
  large = false,
}: {
  listing: Listing;
  onChange?: (saved: boolean) => void;
  large?: boolean;
}) {
  const { user, notify } = useApp(),
    navigate = useNavigate();
  const [saved, setSaved] = useState(!!listing.saved),
    [busy, setBusy] = useState(false);
  async function toggle() {
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
      className={`${large ? "button secondary" : "save-button"} ${saved ? "is-saved" : ""}`}
      disabled={busy}
      aria-label={saved ? "Unsave listing" : "Save listing"}
      aria-pressed={saved}
      onClick={toggle}
    >
      <Heart size={18} fill={saved ? "currentColor" : "none"} />
      {large && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
export function ListingCard({
  listing,
  onSaveChange,
}: {
  listing: Listing;
  onSaveChange?: (saved: boolean) => void;
}) {
  const { user } = useApp();
  return (
    <article className="listing-card">
      <div className="card-photo">
        <Link to={`/listings/${listing.id}`} tabIndex={-1} aria-hidden="true">
          {listing.photos[0] ? (
            <img src={listing.photos[0]} alt="" loading="lazy" />
          ) : (
            <div className="photo-placeholder">
              <Image size={28} strokeWidth={1.3} />
              <span>No photos yet</span>
            </div>
          )}
        </Link>
        <span className="room-badge">{ROOM_LABELS[listing.roomType]}</span>
        {user?.id !== listing.ownerId && (
          <SaveButton
            key={String(listing.saved)}
            listing={listing}
            onChange={onSaveChange}
          />
        )}
      </div>
      <div className="card-body">
        <div className="card-price">
          <strong>{money(listing.price)}</strong>
          <span>/ month</span>
        </div>
        <h2>
          <Link to={`/listings/${listing.id}`}>
            {listing.title}
            <ArrowUpRight size={17} />
          </Link>
        </h2>
        <p className="card-address">
          <MapPin size={14} />
          {listing.address}
        </p>
        <div className="card-details">
          <span>
            <BedDouble size={15} />
            {listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`}
            {" · "}
            {listing.bathrooms} bath
          </span>
          <span>
            <CalendarDays size={14} />
            {dateLabel(listing.availableFrom)} to{" "}
            {dateLabel(listing.availableTo)}
          </span>
        </div>
      </div>
    </article>
  );
}
