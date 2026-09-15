import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  dateLabel,
  errorMessage,
  json,
  money,
  useResource,
} from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Loading } from "../components/ui";
import {
  referralPath,
  missingLabel,
  type ReferralResponse,
} from "../lib/referrals";
import { ROOM_LABELS } from "../types";
import "../styles/referrals.css";

export default function Referral() {
  const { token = "" } = useParams();
  const { user, openAuth, retry } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useResource<ReferralResponse>(
    `${referralPath(token)}?track=0`,
  );
  const trackedToken = useRef("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [claimError, setClaimError] = useState("");
  const back = `/referral/${encodeURIComponent(token)}`;
  useEffect(() => {
    document.title = "Your sublease invitation · Handoff";
  }, []);
  useEffect(() => {
    if (trackedToken.current === token) return;
    trackedToken.current = token;
    // Only mounting the invitation counts as a visit. Auth and data refreshes do not.
    void api(referralPath(token)).catch(() => {
      trackedToken.current = "";
    });
  }, [token]);
  // A completed auth modal changes the actor without leaving this page.
  useEffect(() => {
    if (user?.id) refresh();
  }, [user?.id, refresh]);
  useEffect(() => {
    if (data?.referral.claimedByMe && data.referral.listingId) {
      navigate(`/listings/${data.referral.listingId}/edit`, { replace: true });
    }
  }, [data?.referral.claimedByMe, data?.referral.listingId, navigate]);
  if (loading && !data) return <Loading label="Opening your invitation…" />;
  if (error || !data)
    return (
      <main className="referral-page">
        <div className="referral-card referral-unavailable">
          <h1>This invitation is unavailable.</h1>
          <p>
            It may have been claimed, withdrawn, or expired. You can still
            create your own free listing.
          </p>
          <ErrorBox message={error || "Please try again."} retry={refresh} />
          <Link className="button primary" to="/listings/new">
            Create a listing
          </Link>
        </div>
      </main>
    );
  const r = data.referral;
  const listing = r.listing;
  const missing = [
    ...new Set(r.missing.map((key) => missingLabel[key] || key)),
  ];
  const ready = Boolean(user?.verified && user.campusId === "usc");
  async function claim() {
    setBusy(true);
    setClaimError("");
    try {
      const result = await api<ReferralResponse & { editUrl: string }>(
        `${referralPath(token)}/claim`,
        {
          method: "POST",
          body: json({ ownershipConfirmed: true, termsAccepted: true }),
        },
      );
      retry();
      navigate(result.editUrl);
    } catch (e) {
      setClaimError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="referral-page">
      <div className="referral-intro">
        <span className="pill blue">
          <ShieldCheck size={14} /> A personal invitation
        </span>
        <h1>Your sublease, ready for its next student.</h1>
        <p>
          Hi {r.authorName.split(" ")[0]}. We prepared a private draft from your
          sublease post so you can skip the busywork. Review it, confirm your
          USC email, and make it yours.
        </p>
      </div>
      <div className="referral-layout">
        <section
          className="referral-card referral-preview"
          aria-label="Your imported draft"
        >
          <div className="referral-photos">
            {r.photos.length ? (
              r.photos.map((photo, i) => (
                <img
                  key={photo.id}
                  src={photo.url}
                  alt={`Imported sublease photo ${i + 1}`}
                  loading={i ? "lazy" : "eager"}
                  referrerPolicy="no-referrer"
                />
              ))
            ) : (
              <div className="referral-photo-empty">
                Add your photos when you review the draft.
              </div>
            )}
          </div>
          <div className="referral-preview-body">
            <div className="referral-title-row">
              <span className="pill">Private draft</span>
              <span>University of Southern California</span>
            </div>
            <h2>{listing.title || "Your USC sublease"}</h2>
            <p className="referral-location">
              <MapPin size={15} />
              {listing.address || "Confirm your address in the review"}
            </p>
            <div className="referral-facts">
              <div>
                <strong>
                  {listing.price != null
                    ? money(listing.price)
                    : "Confirm rent"}
                </strong>
                <span>per month</span>
              </div>
              <div>
                <strong>
                  {listing.roomType
                    ? ROOM_LABELS[listing.roomType]
                    : "Confirm room type"}
                </strong>
                <span>
                  {listing.bathrooms != null
                    ? `${listing.bathrooms} bathroom${listing.bathrooms === 1 ? "" : "s"}`
                    : "Confirm bathrooms"}
                </span>
              </div>
              <div>
                <strong>
                  {listing.availableFrom
                    ? dateLabel(listing.availableFrom, true)
                    : "Confirm move-in"}
                </strong>
                <span>
                  {listing.availableTo
                    ? `Until ${dateLabel(listing.availableTo, true)}`
                    : "Confirm move-out"}
                </span>
              </div>
            </div>
            <p className="referral-description">
              {listing.description || "Your description will appear here."}
            </p>
            {!!listing.amenities?.length && (
              <div className="referral-amenities">
                {listing.amenities.map((a) => (
                  <span className="pill" key={a}>
                    {a}
                  </span>
                ))}
              </div>
            )}
            {missing.length > 0 && (
              <div className="notice">
                <strong>A few details need your confirmation</strong>
                <p>
                  {missing.join(", ")}. We left anything unclear for you to fill
                  in.
                </p>
              </div>
            )}
            <p className="referral-source">
              Prepared from your post in{" "}
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                {r.sourceName}
              </a>
              . Nothing is public until you publish.
            </p>
          </div>
        </section>
        <aside className="referral-card referral-claim">
          <span className="eyebrow">From one student to another</span>
          <h2>
            Free to list.
            <br />
            Easy to get started.
          </h2>
          <p>
            I'm David, a USC student and the founder of Handoff. We're a student
            startup making subleasing simpler. There's no catch and no fee to
            post or receive inquiries through this invitation.
          </p>
          <ol className="referral-steps">
            <li>
              <span>{user ? <Check size={14} /> : "1"}</span>
              <div>
                <strong>Create your account</strong>
                <p>Use your own USC email.</p>
              </div>
            </li>
            <li>
              <span>{ready ? <Check size={14} /> : "2"}</span>
              <div>
                <strong>Confirm you're a student</strong>
                <p>Enter the code from your email.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Review and publish</strong>
                <p>
                  Correct anything, confirm your dates, and post when ready.
                </p>
              </div>
            </li>
          </ol>
          {claimError && <ErrorBox message={claimError} />}
          {r.listingId && r.claimedByMe ? (
            <Link
              className="button primary"
              to={`/listings/${r.listingId}/edit`}
            >
              Manage your listing <ArrowRight size={16} />
            </Link>
          ) : r.claimedByMe ? (
            <Link className="button primary" to={data.next.reviewUrl}>
              Continue reviewing <ArrowRight size={16} />
            </Link>
          ) : !user ? (
            <>
              <Button
                onClick={() =>
                  openAuth({
                    mode: "signup",
                    next: back,
                    reason: "new-listing",
                  })
                }
              >
                Review my free listing <ArrowRight size={16} />
              </Button>
              <button
                className="text-button"
                onClick={() => openAuth({ mode: "signin", next: back })}
              >
                Already have an account? Sign in
              </button>
            </>
          ) : user.campusId !== "usc" ? (
            <div className="notice">
              This invitation is for a USC student. Sign in with your USC
              account to claim it.
            </div>
          ) : !user.verified ? (
            <Link
              className="button primary"
              to={`/verify?next=${encodeURIComponent(back)}`}
            >
              Verify my USC email <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <label className="check-label referral-consent">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  This is my sublease. I'm a current USC student and have
                  permission to offer it and use these photos. I agree to the{" "}
                  <Link to="/terms" target="_blank">
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" target="_blank">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              <Button busy={busy} disabled={!confirmed} onClick={claim}>
                Make this draft mine <ArrowRight size={16} />
              </Button>
            </>
          )}
          <p className="referral-footnote">
            <CheckCircle2 size={15} /> When someone requests your place, Handoff
            emails you. You choose who to connect with.
          </p>
          <p className="referral-footnote">
            We record invitation visits and signup progress to help with
            onboarding. Visits are counted by browser and do not identify you
            until you sign in or create an account.
          </p>
        </aside>
      </div>
    </main>
  );
}
