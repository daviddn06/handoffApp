import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Bath,
  BedDouble,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Flag,
  Footprints,
  Grid2X2,
  Image,
  Mail,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Sofa,
  Wallet,
  Zap,
} from "lucide-react";
import {
  ROOM_LABELS,
  STATUS_LABELS,
  type HandoffRequest,
  type Listing,
} from "../types";
import {
  api,
  dateLabel,
  errorMessage,
  json,
  money,
  useResource,
  savings,
} from "../lib/api";
import { useApp } from "../lib/context";
import { BackLink, Button, ErrorBox, Field, Loading, Modal } from "../components/ui";
import { SaveButton } from "../components/ListingCard";
import {
  GenderTag,
  preferenceMismatch,
  preferenceSentence,
} from "../components/Gender";
import { BoostModal, daysLeft } from "../components/BoostModal";
import { milesBetween, tripLabel } from "../lib/dps";
const Map = lazy(() => import("../components/Map"));

function DetailSkeleton() {
  return (
    <div className="page-container detail-page" aria-busy="true">
      <div className="detail-top">
        <span className="skeleton sk-line sk-back" />
      </div>
      <div className="gallery gallery-skeleton">
        <span className="skeleton sk-photo" />
        <span className="skeleton sk-photo" />
        <span className="skeleton sk-photo" />
        <span className="skeleton sk-photo" />
        <span className="skeleton sk-photo" />
      </div>
      <div className="detail-layout">
        <div className="detail-main">
          <div className="sk-block">
            <span className="skeleton sk-line" style={{ width: "30%" }} />
            <span className="skeleton sk-line sk-title" />
            <span className="skeleton sk-line" style={{ width: "45%" }} />
          </div>
          <span className="skeleton sk-strip" />
          <div className="sk-block">
            <span className="skeleton sk-line" style={{ width: "92%" }} />
            <span className="skeleton sk-line" style={{ width: "85%" }} />
            <span className="skeleton sk-line" style={{ width: "60%" }} />
          </div>
          <span className="skeleton sk-map" />
        </div>
        <aside className="detail-aside">
          <span className="skeleton sk-card" />
        </aside>
      </div>
    </div>
  );
}

export default function ListingDetail() {
  const { id } = useParams(),
    { user, campuses, notify, openAuth } = useApp();
  const { data, error, loading, refresh } = useResource<{ listing: Listing }>(
    `/listings/${id}`,
  );
  const { data: requests, refresh: refreshRequests } = useResource<{
    incoming: HandoffRequest[];
    outgoing: HandoffRequest[];
  }>(user ? "/requests" : null);
  const [photo, setPhoto] = useState<number | null>(null),
    [galleryIndex, setGalleryIndex] = useState(0),
    [requestOpen, setRequestOpen] = useState(false),
    [reportOpen, setReportOpen] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [requestError, setRequestError] = useState(""),
    [createdRequest, setCreatedRequest] = useState<HandoffRequest | null>(null),
    [reportReason, setReportReason] = useState("Misleading listing"),
    [reportDetails, setReportDetails] = useState(""),
    [reportError, setReportError] = useState(""),
    [reportBusy, setReportBusy] = useState(false),
    [boostOpen, setBoostOpen] = useState(false);
  useEffect(() => {
    setPhoto(null);
    setGalleryIndex(0);
    setMessage("");
    setCreatedRequest(null);
    setRequestError("");
    setRequestOpen(false);
    setReportOpen(false);
    setReportError("");
    setBoostOpen(false);
  }, [id]);
  const listing = data?.listing,
    campus = campuses.find((c) => c.id === listing?.campusId),
    own = user?.id === listing?.ownerId;
  const request =
    createdRequest ||
    requests?.outgoing.find(
      (r) =>
        r.listingId === id &&
        (r.status === "pending" || r.status === "accepted"),
    );
  async function sendRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRequestError("");
    try {
      const result = await api<{
        request: HandoffRequest;
        notification?: { emailSent: boolean };
      }>("/requests", {
        method: "POST",
        body: json({ listingId: id, message }),
      });
      setCreatedRequest(result.request);
      refreshRequests();
      notify(
        result.notification?.emailSent === false
          ? "Request saved. The email notification couldn’t be delivered."
          : "Request sent. You can follow it in Requests.",
      );
    } catch (e) {
      setRequestError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitReport(e: FormEvent) {
    e.preventDefault();
    setReportBusy(true);
    setReportError("");
    try {
      await api("/reports", {
        method: "POST",
        body: json({
          listingId: id,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      setReportOpen(false);
      notify("Report received. Thank you for letting us know.");
    } catch (e) {
      setReportError(errorMessage(e));
    } finally {
      setReportBusy(false);
    }
  }
  if (loading) return <DetailSkeleton />;
  if (error || !listing)
    return (
      <div className="page-container narrow">
        <BackLink />
        <ErrorBox
          message={error || "This listing is no longer available."}
          retry={refresh}
        />
      </div>
    );
  const photos = listing.photos;
  const miles = campus ? milesBetween(campus, listing) : null;
  const beds =
    listing.bedrooms === 0
      ? "Studio"
      : `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`;
  const furnished = listing.amenities.some((a) => /furnish/i.test(a));
  const facts: Array<{ icon: ReactNode; label: string }> = [
    { icon: <BedDouble size={16} />, label: beds },
    {
      icon: <Bath size={16} />,
      label: `${listing.bathrooms} bath${listing.bathrooms === 1 ? "" : "s"}`,
    },
    { icon: <DoorOpen size={16} />, label: ROOM_LABELS[listing.roomType] },
    {
      icon: <CalendarDays size={16} />,
      label: `${dateLabel(listing.availableFrom)} to ${dateLabel(listing.availableTo)}`,
    },
    {
      icon: <Wallet size={16} />,
      label: listing.deposit
        ? `${money(listing.deposit)} deposit`
        : "No deposit",
    },
  ];
  if (furnished)
    facts.splice(3, 0, { icon: <Sofa size={16} />, label: "Furnished" });
  const save = savings(listing);
  const initials =
    listing.ownerName
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("") || "S";

  function primaryAction(size: "large" | "small") {
    if (!listing) return null;
    const cls = `button primary full-width${size === "large" ? " large" : ""}`;
    if (own)
      return (
        <Link className={cls} to="/requests">
          View requests
          <ArrowRight size={17} />
        </Link>
      );
    if (request)
      return (
        <Link className={cls} to="/requests?tab=outgoing">
          Go to requests
          <ArrowRight size={17} />
        </Link>
      );
    if (!user)
      return (
        <button className={cls} onClick={() => openAuth()}>
          <MessageSquare size={17} />
          Request handoff
        </button>
      );
    return (
      <button className={cls} onClick={() => setRequestOpen(true)}>
        <MessageSquare size={17} />
        Request handoff
      </button>
    );
  }

  return (
    <div className="page-container detail-page">
      <div className="detail-top">
        <BackLink />
        <div className="detail-top-actions">
          {listing.status !== "active" && (
            <span className={`pill ${listing.status === "handed_off" ? "blue" : "amber"}`}>
              {STATUS_LABELS[listing.status]}
            </span>
          )}
          {own && (
            <Link
              className="button secondary small"
              to={`/listings/${listing.id}/edit`}
            >
              Edit listing
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
      </div>

      <div className="gallery-wrap">
      <div
        className={`gallery count-${Math.min(photos.length, 5)}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!photos.length) return;
          const step = el.scrollWidth / photos.length;
          const at = step ? Math.round(el.scrollLeft / step) : 0;
          setGalleryIndex(Math.min(photos.length - 1, Math.max(0, at)));
        }}
      >
        {photos.length ? (
          photos.map((url, i) => (
            <button
              key={url}
              onClick={() => setPhoto(i)}
              className="gallery-photo"
              aria-label={`View photo ${i + 1} of ${photos.length}`}
            >
              <img
                src={url}
                alt={`${listing.title}, photo ${i + 1}`}
                loading={i > 1 ? "lazy" : undefined}
              />
            </button>
          ))
        ) : (
          <div className="gallery-empty">
            <Image size={26} strokeWidth={1.4} />
            <span>No photos added yet</span>
          </div>
        )}
        {photos.length > 1 && (
          <>
            <button
              className="button secondary small all-photos"
              onClick={() => setPhoto(0)}
            >
              <Grid2X2 size={15} />
              Show all {photos.length} photos
            </button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <span className="gallery-counter" aria-hidden="true">
          {galleryIndex + 1} / {photos.length}
        </span>
      )}
      </div>

      <div className="detail-layout">
        <div className="detail-main enter-stagger">
          <header className="detail-head">
            <div className="eyebrow">
              {ROOM_LABELS[listing.roomType]} · {campus?.name}
            </div>
            <h1>{listing.title}</h1>
            <p className="detail-address">
              <MapPin size={15} />
              <span>{listing.address}</span>
            </p>
            {miles !== null && campus && (
              <p className="detail-distance">
                <Footprints size={15} />
                {tripLabel(miles)} to {campus.name}
              </p>
            )}
          </header>

          <ul className="fact-strip">
            {facts.map((f) => (
              <li key={f.label}>
                {f.icon}
                <span>{f.label}</span>
              </li>
            ))}
          </ul>

          {listing.genderPreference !== "any" && (
            <p className="detail-preference">
              <GenderTag preference={listing.genderPreference} />
              <span>
                The lister asked for {preferenceSentence(listing.genderPreference)}.
                This is a shared home, so the people already living there set
                who they share it with.
              </span>
            </p>
          )}

          <section className="detail-section">
            <h2>About the place</h2>
            <p className="preserve-lines">
              {listing.description ||
                "The student hasn’t added a description yet."}
            </p>
          </section>

          {listing.amenities.length > 0 && (
            <section className="detail-section">
              <h2>What comes with it</h2>
              <ul className="amenity-grid">
                {listing.amenities.map((a) => (
                  <li key={a}>
                    <Check size={14} />
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="detail-section">
            <h2>The neighborhood</h2>
            {campus && (
              <div className="detail-map">
                <Suspense fallback={<Loading label="Loading location…" />}>
                  <Map
                    compact
                    campus={campus}
                    pin={{ lat: listing.lat, lng: listing.lng }}
                  />
                </Suspense>
              </div>
            )}
            <p className="field-hint">
              The pin is placed by the student, so confirm the address before
              you commit.
            </p>
          </section>

          <section className="host-card">
            <span className="avatar large">{initials}</span>
            <div className="host-text">
              <strong>Listed by {listing.ownerName || "a student"}</strong>
              <span className="host-verified">
                <ShieldCheck size={14} />
                Verified {campus?.name} student
              </span>
            </div>
          </section>

          <div className="detail-guidance">
            <ShieldCheck size={18} />
            <div>
              <strong>A thoughtful handoff starts with a conversation.</strong>
              <p>
                Visit the place, confirm landlord approval, and review the lease
                together. Handoff does not process rent or deposits.
              </p>
            </div>
          </div>

          {!own && (
            <button className="report-link" onClick={() => setReportOpen(true)}>
              <Flag size={14} />
              Report this listing
            </button>
          )}
        </div>

        <aside className="detail-aside">
          <div className="request-card">
            <div className="request-price">
              <strong>{money(listing.price)}</strong>
              <span>/ month</span>
              {save && <s className="request-original">{money(save.original)}</s>}
              {listing.boosted && (
                <span className="boost-tag" title="Boosted listing">
                  <Zap size={11} fill="currentColor" strokeWidth={0} />
                  Boosted
                </span>
              )}
            </div>
            {save && (
              <div className="savings-box">
                <strong>You save {money(save.amount)} a month</strong>
                <span>
                  {save.percent}% below the original lease of{" "}
                  {money(save.original)}. Both sides win, the lister covers
                  their rent and you pay less.
                </span>
              </div>
            )}
            <div className="request-dates">
              <CalendarDays size={16} />
              <div>
                <small>Available</small>
                <strong>
                  {dateLabel(listing.availableFrom, true)} to{" "}
                  {dateLabel(listing.availableTo, true)}
                </strong>
              </div>
            </div>
            <div className="request-line">
              <span>Security deposit</span>
              <strong>
                {listing.deposit ? money(listing.deposit) : "None listed"}
              </strong>
            </div>
            {own ? (
              <>
                <p className="request-note">
                  This is your listing. Manage it from My listings.
                </p>
                <div className="request-actions">
                  {primaryAction("large")}
                  <Link className="button secondary full-width" to="/my-listings">
                    Manage listing
                  </Link>
                </div>
                {listing.status === "active" && (
                  <div className="boost-callout">
                    <div className="boost-callout-head">
                      <Zap size={17} fill="currentColor" strokeWidth={0} />
                      {listing.boosted ? "This listing is boosted" : "Boost this listing"}
                    </div>
                    <p>
                      {listing.boosted
                        ? `Top of the list with a filled pin for ${daysLeft(listing.boostUntil)} more day${daysLeft(listing.boostUntil) === 1 ? "" : "s"}. Open it for views and requests.`
                        : "Seven days at the top of its map area, a filled pin, a Boosted tag, and stats. The launch boost is free."}
                    </p>
                    <button
                      className="button primary full-width"
                      onClick={() => setBoostOpen(true)}
                    >
                      <Zap size={16} />
                      {listing.boosted ? "See boost stats" : "Boost this listing"}
                    </button>
                  </div>
                )}
              </>
            ) : request ? (
              <>
                <div className="request-status">
                  <span className="pill green">
                    <Check size={12} />
                    {request.status === "accepted" ? "Accepted" : "Request sent"}
                  </span>
                  <p>
                    {request.status === "accepted"
                      ? `${listing.ownerName.split(" ")[0]} accepted your request. Get in touch to talk through the details.`
                      : "The student will review your message. Check Requests for updates."}
                  </p>
                </div>
                <div className="request-actions">
                  {request.contact && (
                    <a
                      className="button primary full-width large"
                      href={`mailto:${request.contact.email}`}
                    >
                      <Mail size={17} />
                      Email {request.contact.name.split(" ")[0]}
                    </a>
                  )}
                  {request.contact ? (
                    <Link
                      className="button secondary full-width"
                      to="/requests?tab=outgoing"
                    >
                      Go to requests
                      <ArrowRight size={16} />
                    </Link>
                  ) : (
                    primaryAction("large")
                  )}
                  <SaveButton
                    key={`${listing.id}-${listing.saved}`}
                    listing={listing}
                    large
                    size="large"
                  />
                </div>
              </>
            ) : (
              <>
                <p className="request-note">
                  {user
                    ? "Introduce yourself and share your dates. Your email is shared only if they accept."
                    : "Confirm you are a student to ask about the place and connect."}
                </p>
                <div className="request-actions">
                  {primaryAction("large")}
                  <SaveButton
                    key={`${listing.id}-${listing.saved}`}
                    listing={listing}
                    large
                    size="large"
                  />
                </div>
                <p className="request-fineprint">
                  No payment or commitment required.
                </p>
              </>
            )}
            {listing.status !== "active" && (
              <p className="request-status-note">
                This listing is {STATUS_LABELS[listing.status].toLowerCase()}.
              </p>
            )}
          </div>
        </aside>
      </div>

      <div className="detail-bar">
        <div className="request-price">
          <strong>{money(listing.price)}</strong>
          <span>/ mo</span>
          {save && <em className="savings-tag">Save {money(save.amount)}</em>}
        </div>
        <div className="detail-bar-actions">{primaryAction("small")}</div>
      </div>

      <Modal
        open={photo !== null}
        onClose={() => setPhoto(null)}
        title={`Photos · ${(photo || 0) + 1} of ${photos.length}`}
        wide
      >
        {photo !== null && (
          <div className="photo-viewer">
            <img
              src={photos[photo]}
              alt={`${listing.title}, photo ${photo + 1}`}
            />
            {photos.length > 1 && (
              <div className="photo-controls">
                <button
                  className="icon-button"
                  aria-label="Previous photo"
                  onClick={() =>
                    setPhoto((photo - 1 + photos.length) % photos.length)
                  }
                >
                  <ChevronLeft size={20} />
                </button>
                <span>
                  {photo + 1} / {photos.length}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next photo"
                  onClick={() => setPhoto((photo + 1) % photos.length)}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {own && (
        <BoostModal
          listing={listing}
          open={boostOpen}
          onClose={() => setBoostOpen(false)}
          onBoosted={() => refresh()}
        />
      )}

      <Modal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title={createdRequest ? "Request sent" : "Request this handoff"}
      >
        {createdRequest ? (
          <div className="request-sent">
            <span className="t-success-check" data-state="in" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none" width="46" height="46">
                <path
                  d="M14 24.5 21 31.5 34 17.5"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h3>Your request is in.</h3>
            <p className="muted">
              {listing.ownerName.split(" ")[0]} will review your message. You
              can follow it in Requests.
            </p>
            <div className="modal-actions">
              <Link
                className="button secondary"
                to="/requests?tab=outgoing"
                onClick={() => setRequestOpen(false)}
              >
                Go to requests
              </Link>
              <Button variant="primary" onClick={() => setRequestOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="request-form" onSubmit={sendRequest}>
            <p className="muted">
              Your email is shared only if they accept.
            </p>
            <Field label="Your message">
              <textarea
                required
                minLength={20}
                maxLength={2000}
                rows={5}
                placeholder="Hi! I’m looking for a place for the spring semester…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <span className="field-hint">
                At least 20 characters, no contact details.
              </span>
            </Field>
            {preferenceMismatch(listing.genderPreference, user?.gender) && (
              <p className="notice request-preference-note">
                This lister asked for{" "}
                {preferenceSentence(listing.genderPreference)}. You can still
                send a request, the lister decides.
              </p>
            )}
            {requestError && <ErrorBox message={requestError} />}
            <div className="modal-actions">
              <span className="request-fineprint">
                No payment or commitment required.
              </span>
              <Button type="submit" busy={busy}>
                <MessageSquare size={17} />
                Send request
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report this listing"
      >
        {!user ? (
          <>
            <p className="muted">
              Confirm you are a student so we can follow up.
            </p>
            <button
              className="button primary full-width"
              onClick={() => {
                setReportOpen(false);
                openAuth();
              }}
            >
              Confirm you are a student
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <form className="stack" onSubmit={submitReport}>
            <p className="muted">
              Tell us what does not look right.
            </p>
            <Field label="Reason">
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
              >
                {[
                  "Misleading listing",
                  "Suspicious or fraudulent",
                  "Already unavailable",
                  "Inappropriate content",
                  "Other",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Details">
              <textarea
                rows={4}
                required
                minLength={10}
                maxLength={2000}
                placeholder="What should we know?"
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
              />
            </Field>
            {reportError && <ErrorBox message={reportError} />}
            <div className="modal-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setReportOpen(false)}
              >
                Cancel
              </Button>
              <Button busy={reportBusy}>Submit report</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
