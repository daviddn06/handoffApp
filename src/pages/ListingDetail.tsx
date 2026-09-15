import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  Pencil,
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
  Lock,
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
import { MobileAccount } from "../components/AccountButton";
import { SaveButton } from "../components/ListingCard";
import { Avatar } from "../components/Avatar";
import {
  GenderTag,
  preferenceMismatch,
  preferenceSentence,
} from "../components/Gender";
import { BoostModal, daysLeft } from "../components/BoostModal";
import { milesBetween, tripLabel } from "../lib/dps";
const Map = lazy(() => import("../components/Map"));

/**
 * A locked preview keeps the shape of the real thing without ever carrying
 * the real thing. The server sends null for the address, the description and
 * the lister when nobody is signed in, so what stands in for them here is
 * fixed filler written into this file. It is blurred, unselectable and out of
 * the accessibility tree, and it has nothing to do with the listing, so there
 * is nothing to unblur and nothing to read out.
 */
const LOCKED_FILLER = [
  "A bright room in a shared student house, a short walk from campus and the bus line that runs along the main avenue every ten minutes.",
  "The lease runs through the end of the spring term. Furniture stays, the kitchen is shared, and laundry is in the building.",
  "Message the student for a tour and to talk through dates, deposit and how the handoff would work.",
];
const LOCKED_ADDRESS = "1200 Example Avenue, Apt 4";
const LOCKED_NAME = "A verified student";
function LockedText({
  lines = LOCKED_FILLER,
  className = "",
}: {
  lines?: string[];
  className?: string;
}) {
  return (
    <span className={`locked-text ${className}`.trim()} aria-hidden="true">
      {lines.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </span>
  );
}
function StudentsOnlyChip() {
  return (
    <span className="locked-chip">
      <Lock size={12} />
      Students only
    </span>
  );
}
/** The one row that explains the hold and opens all of it. */
function LockedGate({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="locked-gate">
      <div className="locked-gate-row">
        <span className="locked-gate-icon" aria-hidden="true">
          <Lock size={16} />
        </span>
        <span className="locked-gate-text">
          <strong>Students only</strong>
          <span>Confirm your student email to see the full listing.</span>
        </span>
        <button className="button primary" onClick={onUnlock}>
          Confirm you are a student
        </button>
      </div>
    </div>
  );
}

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
    [boostOpen, setBoostOpen] = useState(false),
    [preferenceWarning, setPreferenceWarning] = useState(false);
  /* Confirming who you are unlocks the address, the description and the
     lister, so the listing is fetched again the moment the session changes. */
  const signedInId = user?.id || "";
  const lastSession = useRef(signedInId);
  useEffect(() => {
    if (lastSession.current === signedInId) return;
    lastSession.current = signedInId;
    refresh();
  }, [signedInId, refresh]);
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
    setPreferenceWarning(false);
  }, [id]);
  const listing = data?.listing,
    campus = campuses.find((c) => c.id === listing?.campusId),
    own = user?.id === listing?.ownerId;
  // The server holds back the address, the description, the lister and the
  // exact point for anyone who has not confirmed they study.
  const locked = Boolean(listing?.locked);
  const unlock = (reason: "details" | "request" | "save") =>
    openAuth({ next: `/listings/${id}`, reason });
  const request =
    createdRequest ||
    requests?.outgoing.find(
      (r) =>
        r.listingId === id &&
        (r.status === "pending" || r.status === "accepted"),
    );
  /* A lister who asked for women only or men only is a hard preference, so a
     requester who does not match is warned before the request sheet opens.
     The soft "preferred" cases keep the inline note inside the sheet. */
  const hardPreference =
    listing?.genderPreference === "women_only" ||
    listing?.genderPreference === "men_only";
  const blockedByPreference =
    hardPreference && preferenceMismatch(listing!.genderPreference, user?.gender);
  function openRequest() {
    if (blockedByPreference) setPreferenceWarning(true);
    else setRequestOpen(true);
  }
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
        <button
          className={cls}
          onClick={() =>
            openAuth({ next: `/listings/${listing.id}`, reason: "request" })
          }
        >
          <MessageSquare size={17} />
          Request handoff
        </button>
      );
    return (
      <button className={cls} onClick={openRequest}>
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
              <Pencil size={15} />
              Edit listing
            </Link>
          )}
        </div>
      </div>

      <div className="gallery-wrap">
      <MobileAccount floating className="detail-account" />
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
            {locked ? (
              <p className="detail-address is-locked">
                <MapPin size={15} />
                <LockedText className="is-inline" lines={[LOCKED_ADDRESS]} />
                <span className="sr-only">
                  The address is hidden until you confirm you are a student.
                </span>
                <StudentsOnlyChip />
              </p>
            ) : (
              <p className="detail-address">
                <MapPin size={15} />
                <span>{listing.address}</span>
              </p>
            )}
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
            {locked ? (
              <div className="locked-block">
                <LockedText />
                <LockedGate onUnlock={() => unlock("details")} />
              </div>
            ) : (
              <p className="preserve-lines">
                {listing.description ||
                  "The student hasn’t added a description yet."}
              </p>
            )}
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
                    approx={locked}
                    campus={campus}
                    pin={{ lat: listing.lat, lng: listing.lng }}
                  />
                </Suspense>
              </div>
            )}
            <p className="field-hint">
              {locked
                ? "The circle covers roughly where the place is. The exact pin and address open once you confirm you are a student."
                : "The pin is placed by the student, so confirm the address before you commit."}
            </p>
          </section>

          {locked ? (
            <section className="host-card is-locked">
              <span className="locked-avatar" aria-hidden="true" />
              <div className="host-text">
                <LockedText className="is-inline" lines={[LOCKED_NAME]} />
                <span className="host-verified">
                  <ShieldCheck size={14} />
                  Verified student
                </span>
                <span className="sr-only">
                  The lister is hidden until you confirm you are a student.
                </span>
              </div>
              <button
                type="button"
                className="button secondary small"
                onClick={() => unlock("details")}
              >
                <Lock size={14} />
                Unlock
              </button>
            </section>
          ) : (
            <section className="host-card">
              <Avatar
                src={listing.ownerAvatar}
                name={listing.ownerName}
                size={48}
              />
              <div className="host-text">
                <strong>Listed by {listing.ownerName || "a student"}</strong>
                <span className="host-verified">
                  <ShieldCheck size={14} />
                  Verified student
                </span>
              </div>
            </section>
          )}

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
            {save &&
              (own ? (
                <div className="savings-box">
                  <strong>
                    Subleasers save {money(save.amount)} a month against your
                    lease
                  </strong>
                  <span>
                    {save.percent}% below your original {money(save.original)}.
                    That gap is the reason students open your listing first.
                  </span>
                </div>
              ) : (
                <div className="savings-box">
                  <strong>You save {money(save.amount)} a month</strong>
                  <span>
                    {save.percent}% below the original lease of{" "}
                    {money(save.original)}. Both sides win, the lister covers
                    their rent and you pay less.
                  </span>
                </div>
              ))}
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
                      className="button secondary full-width"
                      onClick={() => setBoostOpen(true)}
                    >
                      <Zap size={16} />
                      {listing.boosted ? "See boost stats" : "Start the boost"}
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

      {/* A hard preference gets an interstitial, not a note the requester
          only meets after writing the message. */}
      <Modal
        open={preferenceWarning}
        onClose={() => setPreferenceWarning(false)}
        title={`This lister asked for ${preferenceSentence(
          listing.genderPreference,
        )}`}
        description="Your profile does not match that, so the chances of being accepted are low. You can still send a request and the lister decides."
      >
        <div className="modal-actions">
          <Button
            variant="secondary"
            onClick={() => setPreferenceWarning(false)}
          >
            Go back
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setPreferenceWarning(false);
              setRequestOpen(true);
            }}
          >
            Send anyway
          </Button>
        </div>
      </Modal>

      <Modal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title={createdRequest ? "Request sent" : "Request this handoff"}
        description={
          createdRequest
            ? undefined
            : "Your email is shared only if they accept."
        }
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
            {!hardPreference &&
              preferenceMismatch(listing.genderPreference, user?.gender) && (
                <p className="notice request-preference-note">
                  This lister asked for{" "}
                  {preferenceSentence(listing.genderPreference)}. You can still
                  send a request, the lister decides.
                </p>
              )}
            {requestError && <ErrorBox message={requestError} />}
            <div className="modal-actions spread">
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
        description={
          user
            ? "Tell us what does not look right."
            : "Confirm you are a student so we can follow up."
        }
      >
        {!user ? (
          <>
            <button
              className="button primary full-width"
              onClick={() => {
                setReportOpen(false);
                unlock("details");
              }}
            >
              Confirm you are a student
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <form className="stack" onSubmit={submitReport}>
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
