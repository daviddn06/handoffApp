import { useEffect, useState } from "react";
import {
  ArrowUpNarrowWide,
  BarChart3,
  MapPin,
  Tag,
  Zap,
} from "lucide-react";
import type { BoostStats, Listing } from "../types";
import { api, dateLabel, errorMessage, json } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Modal } from "./ui";

/** Whole days left on a boost window, at least one while it is still running. */
export function daysLeft(boostUntil: string | null) {
  if (!boostUntil) return 0;
  const ms = new Date(boostUntil).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 86400000));
}

export function isBoosted(listing: { boosted?: boolean; boostUntil?: string | null }) {
  if (listing.boosted) return true;
  return Boolean(listing.boostUntil && new Date(listing.boostUntil) > new Date());
}

const BENEFITS = [
  {
    icon: ArrowUpNarrowWide,
    title: "Top of the list for its map area",
    body: "Your place sits above the rest wherever it shows up in browse.",
  },
  {
    icon: MapPin,
    title: "Filled pin on the map",
    body: "A solid blue pin stands out against every other price on the map.",
  },
  {
    icon: Tag,
    title: "Boosted tag on the card",
    body: "Students see the tag next to your rent before they even open it.",
  },
  {
    icon: BarChart3,
    title: "Views and requests stats",
    body: "See how many students looked and how many asked, since the boost started.",
  },
];

function SuccessCheck() {
  return (
    <span className="t-success-check" data-state="in" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" width="44" height="44">
        <path
          d="M14 24.5 21 31.5 34 17.5"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function BoostModal({
  listing,
  open,
  onClose,
  onBoosted,
}: {
  listing: Listing;
  open: boolean;
  onClose: () => void;
  onBoosted?: (listing: Listing) => void;
}) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [boosted, setBoosted] = useState<Listing | null>(null),
    [stats, setStats] = useState<BoostStats | null>(null),
    [statsError, setStatsError] = useState("");
  const current = boosted || listing;
  const running = isBoosted(current);
  useEffect(() => {
    if (!open) return;
    setError("");
    setBoosted(null);
  }, [open, listing.id]);
  useEffect(() => {
    if (!open || !running) {
      setStats(null);
      return;
    }
    let live = true;
    setStatsError("");
    api<BoostStats>(`/listings/${listing.id}/boost-stats`)
      .then((result) => {
        if (live) setStats(result);
      })
      .catch((e) => {
        if (live) setStatsError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [open, running, listing.id, boosted]);

  async function useLaunchBoost() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ listing: Listing }>(
        `/listings/${listing.id}/boost`,
        { method: "POST", body: json({ kind: "launch" }) },
      );
      setBoosted(result.listing);
      onBoosted?.(result.listing);
      notify("Your listing is boosted.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const left = daysLeft(current.boostUntil);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        boosted
          ? "Your listing is boosted"
          : running
            ? "This listing is boosted"
            : "Boost this listing"
      }
    >
      {boosted ? (
        <div className="boost-done">
          <SuccessCheck />
          <h3>
            Boosted until {dateLabel(boosted.boostUntil || "", true)}
          </h3>
          <p className="muted">
            Your place sits at the top of its map area with a Boosted tag.
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : running ? (
        <div className="boost-live">
          <div className="boost-live-head">
            <span className="boost-pill">
              <Zap size={13} />
              Boosted
            </span>
            <span className="muted">
              {left} day{left === 1 ? "" : "s"} left, until{" "}
              {dateLabel(current.boostUntil || "", true)}
            </span>
          </div>
          {statsError ? (
            <ErrorBox message={statsError} />
          ) : (
            <div className="boost-stats">
              <div className="boost-stat">
                <strong>{stats ? stats.views : "…"}</strong>
                <span>Views</span>
              </div>
              <div className="boost-stat">
                <strong>{stats ? stats.requests : "…"}</strong>
                <span>Requests</span>
              </div>
              <div className="boost-stat">
                <strong>{left}</strong>
                <span>Day{left === 1 ? "" : "s"} left</span>
              </div>
            </div>
          )}
          <p className="boost-note">
            Views and requests are counted from the moment the boost started.
            One boost runs at a time. You can boost this listing again once this
            one ends on {dateLabel(current.boostUntil || "", true)}.
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="boost-offer">
          <div className="boost-price-card">
            <div className="boost-price">
              <s>$9</s>
              <strong>Free</strong>
            </div>
            <div className="boost-price-copy">
              <strong>$9 for 7 days</strong>
              <span className="boost-launch">Launch offer: free</span>
            </div>
          </div>
          <ul className="boost-benefits">
            {BENEFITS.map((item) => (
              <li key={item.title}>
                <span className="boost-benefit-icon" aria-hidden="true">
                  <item.icon size={16} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              </li>
            ))}
          </ul>
          {error && <ErrorBox message={error} />}
          <div className="boost-actions">
            <div className="boost-pay">
              <Button variant="primary" className="full-width" disabled>
                Pay $9 and boost
              </Button>
              <span className="boost-caption">Payments open soon</span>
            </div>
            <Button
              variant="secondary"
              className="full-width large boost-free"
              busy={busy}
              onClick={useLaunchBoost}
            >
              <Zap size={17} />
              Use my free launch boost
            </Button>
            <p className="boost-fineprint">
              One free launch boost per listing, seven days, nothing to pay.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default BoostModal;
