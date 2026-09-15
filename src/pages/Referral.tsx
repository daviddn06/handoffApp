import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Mail,
} from "lucide-react";
import { api, dateLabel, json, money, useResource } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Loading, Modal } from "../components/ui";
import { ReferralAccess } from "../components/ReferralAccess";
import { ReferralReview } from "../components/ReferralReview";
import {
  referralPath,
  missingLabel,
  type ReferralResponse,
} from "../lib/referrals";
import { ROOM_LABELS, type User } from "../types";
import "../styles/referrals.css";

export default function Referral() {
  const { token = "" } = useParams();
  const { user, setUser } = useApp();
  const navigate = useNavigate();
  const { data, setData, error, loading, refresh } =
    useResource<ReferralResponse>(`${referralPath(token)}?track=0`);
  const trackedToken = useRef("");
  const [accessOpen, setAccessOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => {
    document.body.classList.add("referral-surface");
    return () => document.body.classList.remove("referral-surface");
  }, []);
  useEffect(() => {
    if (trackedToken.current === token) return;
    trackedToken.current = token;
    // One visit per mounted invitation. Editor and auth refreshes do not count.
    void api(referralPath(token)).catch(() => {
      trackedToken.current = "";
    });
  }, [token]);
  useEffect(() => {
    if (!user?.id) return;
    let current = true;
    // Refresh ownership without unmounting the signup and verification dialog.
    void api<ReferralResponse>(`${referralPath(token)}?track=0`)
      .then((result) => {
        if (current)
          setData((previous) =>
            previous?.referral.claimedByMe && !result.referral.claimedByMe
              ? previous
              : result,
          );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [user?.id, token, setData]);
  useEffect(() => {
    if (data?.referral.claimedByMe && data.referral.listingId)
      navigate(`/listings/${data.referral.listingId}/edit`, { replace: true });
  }, [data?.referral.claimedByMe, data?.referral.listingId, navigate]);
  async function claim() {
    const result = await api<ReferralResponse>(`${referralPath(token)}/claim`, {
      method: "POST",
      body: json({ ownershipConfirmed: true, termsAccepted: true }),
    });
    setData(result);
    setAccessOpen(false);
    void api<{ user: User }>("/session")
      .then((session) => setUser(session.user))
      .catch(() => {});
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  if (loading && !data) return <Loading label="Finding your sublease…" />;
  if (error || !data)
    return (
      <div className="referral-page">
        <div className="referral-card referral-unavailable">
          <h1>This invitation is unavailable.</h1>
          <p>
            It may have been claimed or withdrawn. You can still create your own
            free listing.
          </p>
          <ErrorBox message={error || "Please try again."} retry={refresh} />
          <Link className="button primary" to="/listings/new">
            Create a listing
          </Link>
        </div>
      </div>
    );
  const r = data.referral,
    l = r.listing;
  if (r.claimedByMe)
    return (
      <div className="referral-page">
        <ReferralReview key={r.id} referral={r} token={token} />
      </div>
    );
  const missing = [
    ...new Set(r.missing.map((key) => missingLabel[key] || key)),
  ];
  return (
    <div className="referral-page">
      <header className="referral-intro">
        <span className="pill blue">
          <ShieldCheck size={14} /> A personal invitation
        </span>
        <h1>
          Hey {r.authorName.split(" ")[0]},<br />
          your sublease is ready.
        </h1>
        <p>Your post. Your photos. Already filled in.</p>
      </header>
      <div className="referral-layout">
        <section
          className="referral-card referral-preview"
          aria-label="Your imported draft"
        >
          <div className="referral-gallery">
            <div
              className="referral-carousel"
              onScroll={(e) =>
                setPhotoIndex(
                  Math.round(
                    e.currentTarget.scrollLeft / e.currentTarget.clientWidth,
                  ),
                )
              }
              aria-label="Swipe through your listing photos"
            >
              {r.photos.length ? (
                r.photos.map((p, i) => (
                  <img
                    key={p.id}
                    src={p.url}
                    alt={`Your sublease, photo ${i + 1} of ${r.photos.length}`}
                    loading={i ? "lazy" : "eager"}
                    referrerPolicy="no-referrer"
                  />
                ))
              ) : (
                <div className="referral-photo-empty">
                  Your listing photos will go here.
                </div>
              )}
            </div>
            {r.photos.length > 0 && (
              <span className="referral-photo-count">
                {Math.min(photoIndex + 1, r.photos.length)} / {r.photos.length}
              </span>
            )}
          </div>
          <div className="referral-preview-body">
            <span className="pill">Only you can publish this</span>
            <h2>{l.title || "Your USC sublease"}</h2>
            <p className="referral-location">
              <MapPin size={15} />
              {l.address || "Confirm your address"}
            </p>
            <div className="referral-price">
              <strong>
                {l.price != null ? money(l.price) : "Confirm rent"}
              </strong>
              <span>/ month</span>
            </div>
            <div className="referral-key-facts">
              <span>
                {l.roomType ? ROOM_LABELS[l.roomType] : "Confirm room type"}
              </span>
              {l.bathrooms != null && (
                <span>
                  {l.bathrooms} bath{l.bathrooms === 1 ? "" : "s"}
                </span>
              )}
              <span>USC</span>
            </div>
            {(l.availableFrom || l.availableTo) && (
              <p className="referral-dates">
                {l.availableFrom
                  ? dateLabel(l.availableFrom, true)
                  : "Confirm move-in"}{" "}
                to{" "}
                {l.availableTo
                  ? dateLabel(l.availableTo, true)
                  : "confirm move-out"}
              </p>
            )}
            {!!l.amenities?.length && (
              <div className="referral-amenities">
                {l.amenities.map((a) => (
                  <span className="pill" key={a}>
                    {a}
                  </span>
                ))}
              </div>
            )}
            <details className="referral-post-copy">
              <summary>Read your imported description</summary>
              <p className="referral-description">
                {l.description || "Add your description before publishing."}
              </p>
            </details>
            {!!missing.length && (
              <p className="referral-missing">
                Just {missing.length} details to confirm before posting.
                Anything unclear was left for you.
              </p>
            )}
            <p className="referral-source">
              From your{" "}
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                {r.sourceName} post
              </a>
              . Still private.
            </p>
          </div>
        </section>
        <aside className="referral-card referral-claim">
          <span className="eyebrow">From one student to another</span>
          <h2>A head start on your next handoff.</h2>
          <p>
            I'm David, a USC student and Handoff's founder. We prepared this for
            you to make subleasing easier. No catch. No fee.
          </p>
          <ol className="referral-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Make it yours</strong>
                <p>Create an account with your USC email.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Confirm and post</strong>
                <p>Check any missing details, then you're live.</p>
              </div>
            </li>
          </ol>
          <Button
            className="referral-desktop-cta"
            onClick={() => setAccessOpen(true)}
          >
            Make it mine <ArrowRight size={16} />
          </Button>
          <p className="referral-footnote">
            <Mail size={16} />
            We'll email you when someone reaches out. You manage the listing and
            choose who to connect with.
          </p>
          <p className="referral-tracking-note">
            Invitation visits and signup progress are recorded to help with
            onboarding.
          </p>
        </aside>
      </div>
      <div className="referral-mobile-cta">
        <div>
          <CheckCircle2 size={15} />
          <span>Free. Already filled in.</span>
        </div>
        <Button onClick={() => setAccessOpen(true)}>
          Make it mine <ArrowRight size={16} />
        </Button>
      </div>
      <Modal
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        title="Make this listing yours"
        description="Your post and photos are already here."
        className="referral-access-modal"
      >
        <ReferralAccess authorName={r.authorName} onReady={claim} />
      </Modal>
    </div>
  );
}
