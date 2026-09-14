import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  Bath,
  BedDouble,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Grid2X2,
  Image,
  MapPin,
  ShieldCheck,
  Mail,
  MessageSquare,
  ArrowUpRight,
} from "lucide-react";
import {
  AMENITIES,
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
} from "../lib/api";
import { useApp } from "../lib/context";
import {
  BackLink,
  Button,
  ErrorBox,
  Field,
  Loading,
  Modal,
  Notice,
} from "../components/ui";
import { SaveButton } from "../components/ListingCard";
const Map = lazy(() => import("../components/Map"));
export default function ListingDetail() {
  const { id } = useParams(),
    { user, campuses, notify } = useApp();
  const { data, error, loading, refresh } = useResource<{ listing: Listing }>(
    `/listings/${id}`,
  );
  const { data: requests, refresh: refreshRequests } = useResource<{
    incoming: HandoffRequest[];
    outgoing: HandoffRequest[];
  }>(user ? "/requests" : null);
  const [photo, setPhoto] = useState<number | null>(null),
    [reportOpen, setReportOpen] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [requestError, setRequestError] = useState(""),
    [createdRequest, setCreatedRequest] = useState<HandoffRequest | null>(null),
    [reportReason, setReportReason] = useState("Misleading listing"),
    [reportDetails, setReportDetails] = useState(""),
    [reportError, setReportError] = useState(""),
    [reportBusy, setReportBusy] = useState(false);
  useEffect(() => {
    setPhoto(null);
    setMessage("");
    setCreatedRequest(null);
    setRequestError("");
    setReportOpen(false);
    setReportError("");
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
  if (loading) return <Loading label="Opening this place…" />;
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
  return (
    <div className="page-container detail-page">
      <div className="detail-topline">
        <BackLink />
        <div className="detail-top-actions">
          {listing.status !== "active" && (
            <span className={`status-badge ${listing.status}`}>
              {STATUS_LABELS[listing.status]}
            </span>
          )}
          {!own && (
            <SaveButton
              key={`${listing.id}-${listing.saved}`}
              listing={listing}
              large
            />
          )}
          {own && (
            <Link
              className="button secondary"
              to={`/listings/${listing.id}/edit`}
            >
              Edit listing
              <ArrowUpRight size={16} />
            </Link>
          )}
        </div>
      </div>
      <div
        className={`photo-gallery photos-${Math.min(listing.photos.length, 3)}`}
      >
        {listing.photos.length ? (
          listing.photos.slice(0, 3).map((url, i) => (
            <button
              key={url}
              onClick={() => setPhoto(i)}
              className={`gallery-photo photo-${i}`}
              aria-label={`View photo ${i + 1} of ${listing.photos.length}`}
            >
              <img src={url} alt={`${listing.title}, photo ${i + 1}`} />
            </button>
          ))
        ) : (
          <div className="gallery-empty">
            <Image size={35} />
            <span>No photos added yet</span>
          </div>
        )}
        {listing.photos.length > 1 && (
          <button
            className="button secondary all-photos"
            onClick={() => setPhoto(0)}
          >
            <Grid2X2 size={16} />
            All {listing.photos.length} photos
          </button>
        )}
      </div>
      <div className="detail-layout">
        <div className="detail-content">
          <div className="detail-heading">
            <div className="eyebrow">
              {ROOM_LABELS[listing.roomType]} · {campus?.shortName}
            </div>
            <h1>{listing.title}</h1>
            <p>
              <MapPin size={17} />
              {listing.address}
            </p>
          </div>
          <div className="property-facts">
            <span>
              <BedDouble size={22} />
              {listing.bedrooms === 0
                ? "Studio"
                : `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`}
            </span>
            <span>
              <Bath size={22} />
              {listing.bathrooms} bathroom{listing.bathrooms === 1 ? "" : "s"}
            </span>
            <span>
              <CalendarDays size={22} />
              {dateLabel(listing.availableFrom)} to{" "}
              {dateLabel(listing.availableTo, true)}
            </span>
          </div>
          <section className="detail-section">
            <h2>A little about the place</h2>
            <p className="preserve-lines">
              {listing.description ||
                "The student hasn’t added a description yet."}
            </p>
          </section>
          {listing.amenities.length > 0 && (
            <section className="detail-section">
              <h2>What comes with it</h2>
              <div className="amenity-list">
                {listing.amenities.map((a) => (
                  <div key={a}>
                    <Check size={18} />
                    {AMENITIES.includes(a) ? a : a}
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="detail-section">
            <h2>Your neighborhood</h2>
            <p>{listing.address}</p>
            {campus && (
              <div className="detail-map">
                <Suspense fallback={<Loading label="Loading location…" />}>
                  <Map
                    campus={campus}
                    pin={{ lat: listing.lat, lng: listing.lng }}
                  />
                </Suspense>
              </div>
            )}
            <p className="field-hint">
              The pin is placed by the student. Confirm the address and arrange
              a visit before committing.
            </p>
          </section>
          <section className="owner-section">
            <span className="avatar large">
              {listing.ownerName
                ?.split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("") || "S"}
            </span>
            <div>
              <h2>Listed by {listing.ownerName || "a student"}</h2>
              <p>
                <ShieldCheck size={15} />
                {campus?.shortName} student
              </p>
            </div>
          </section>
          <div className="detail-guidance">
            <ShieldCheck size={22} />
            <div>
              <strong>A thoughtful handoff starts with a conversation.</strong>
              <p>
                Visit the place, confirm landlord approval, and review the lease
                together. Handoff connects students and doesn’t process rent or
                deposits.
              </p>
            </div>
          </div>
          {!own && (
            <button className="report-link" onClick={() => setReportOpen(true)}>
              <Flag size={15} />
              Report this listing
            </button>
          )}
        </div>
        <aside className="request-sidebar">
          <div className="request-card">
            <div className="detail-price">
              <strong>{money(listing.price)}</strong>
              <span>/ month</span>
            </div>
            <div className="cost-row">
              <span>Security deposit</span>
              <strong>
                {listing.deposit ? money(listing.deposit) : "None listed"}
              </strong>
            </div>
            <div className="availability-box">
              <CalendarDays size={18} />
              <div>
                <span>Available</span>
                <strong>
                  {dateLabel(listing.availableFrom, true)} to{" "}
                  {dateLabel(listing.availableTo, true)}
                </strong>
              </div>
            </div>
            {own ? (
              <>
                <p className="request-description">
                  This is your listing. Manage its availability and incoming
                  requests from your dashboard.
                </p>
                <Link className="button primary full-width" to="/requests">
                  View requests
                  <ArrowRight size={17} />
                </Link>
                <Link className="button secondary full-width" to="/my-listings">
                  Manage listing
                </Link>
              </>
            ) : request ? (
              <div className="request-confirmation">
                <div className="confirmation-icon">
                  <Check size={23} />
                </div>
                <h2>
                  {request.status === "accepted"
                    ? "You’re connected."
                    : "Your request is in."}
                </h2>
                <p>
                  {request.status === "accepted"
                    ? `${listing.ownerName.split(" ")[0]} accepted your request. Get in touch to talk through the details.`
                    : "The student will review your message. Check Requests for updates."}
                </p>
                {request.contact && (
                  <a
                    className="button primary full-width"
                    href={`mailto:${request.contact.email}`}
                  >
                    <Mail size={17} />
                    Email {request.contact.name.split(" ")[0]}
                  </a>
                )}
                <Link
                  className={`button ${request.contact ? "secondary" : "primary"} full-width`}
                  to="/requests?tab=outgoing"
                >
                  Go to requests
                  <ArrowRight size={17} />
                </Link>
              </div>
            ) : user ? (
              <form onSubmit={sendRequest}>
                <h2 className="request-title">
                  Could this be your next place?
                </h2>
                <p className="request-description">
                  Introduce yourself and share your dates. Your email is shared
                  only if they accept.
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
                    At least 20 characters. Keep contact details out of this
                    message.
                  </span>
                </Field>
                {requestError && <ErrorBox message={requestError} />}
                <Button className="full-width" type="submit" busy={busy}>
                  <MessageSquare size={17} />
                  Send a request
                </Button>
                <p className="request-fineprint">
                  No payment or commitment required.
                </p>
              </form>
            ) : (
              <>
                <h2 className="request-title">
                  Could this be your next place?
                </h2>
                <p className="request-description">
                  Sign in with your student account to ask about the place and
                  connect.
                </p>
                <Link
                  className="button primary full-width"
                  to={`/sign-in?next=${encodeURIComponent("/listings/" + id)}`}
                >
                  Sign in to connect
                  <ArrowRight size={17} />
                </Link>
                <p className="request-fineprint">
                  No payment or commitment required.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
      <Modal
        open={photo !== null}
        onClose={() => setPhoto(null)}
        title={`Photos · ${(photo || 0) + 1} of ${listing.photos.length}`}
        wide
      >
        {photo !== null && (
          <div className="photo-viewer">
            <img
              src={listing.photos[photo]}
              alt={`${listing.title}, photo ${photo + 1}`}
            />
            {listing.photos.length > 1 && (
              <div className="photo-controls">
                <button
                  className="button secondary"
                  aria-label="Previous photo"
                  onClick={() =>
                    setPhoto(
                      (photo - 1 + listing.photos.length) %
                        listing.photos.length,
                    )
                  }
                >
                  <ChevronLeft size={20} />
                </button>
                <span>
                  {photo + 1} / {listing.photos.length}
                </span>
                <button
                  className="button secondary"
                  aria-label="Next photo"
                  onClick={() => setPhoto((photo + 1) % listing.photos.length)}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </div>
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
              Sign in to submit a report so we can follow up if needed.
            </p>
            <Link
              className="button primary full-width"
              to={`/sign-in?next=${encodeURIComponent("/listings/" + id)}`}
            >
              Sign in
              <ArrowRight size={17} />
            </Link>
          </>
        ) : (
          <form className="stack" onSubmit={submitReport}>
            <p className="muted">
              Help keep Handoff useful for everyone. Tell us what doesn’t look
              right.
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
