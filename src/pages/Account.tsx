import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  Check,
  CheckCircle2,
  Clock,
  Heart,
  House,
  Inbox,
  Mail,
  MessageSquare,
  Plus,
  ShieldCheck,
  UserRound,
  Image,
  CalendarDays,
  Pencil,
  Send,
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
import {
  ROOM_LABELS,
  STATUS_LABELS,
  type HandoffRequest,
  type Listing,
  type User,
} from "../types";
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeading,
} from "../components/ui";
import { ListingCard } from "../components/ListingCard";
export function Saved() {
  const { data, loading, error, refresh, setData } = useResource<{
    listings: Listing[];
  }>("/saved");
  return (
    <div className="page-container">
      <PageHeading
        eyebrow="Your shortlist"
        title="Good places. Kept close."
        description="Everything you’ve saved, ready when you are."
      />
      <div className="section-topline">
        <span>
          {data?.listings.length || 0} saved place
          {data?.listings.length !== 1 ? "s" : ""}
        </span>
        <Link className="text-button" to="/browse">
          Keep exploring
          <ArrowRight size={16} />
        </Link>
      </div>
      {loading ? (
        <Loading label="Finding your saved places…" />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : data?.listings.length ? (
        <div className="listings-grid saved-grid">
          {data.listings.map((l) => (
            <ListingCard
              key={l.id}
              listing={{ ...l, saved: true }}
              onSaveChange={(saved) => {
                if (!saved)
                  setData((current) =>
                    current
                      ? {
                          listings: current.listings.filter(
                            (item) => item.id !== l.id,
                          ),
                        }
                      : current,
                  );
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Heart size={28} strokeWidth={1.5} />}
          title="A shortlist starts with one."
          description="Tap the heart on a place you like. We’ll keep it here so you can come back to it."
        >
          <Link className="button primary" to="/browse">
            Explore places
            <ArrowRight size={17} />
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
export function MyListings() {
  const { data, loading, error, refresh } = useResource<{
      listings: Listing[];
    }>("/my-listings"),
    { notify } = useApp();
  const [filter, setFilter] = useState("all"),
    [action, setAction] = useState<{
      listing: Listing;
      status: Listing["status"];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const listings =
    data?.listings.filter((l) => filter === "all" || l.status === filter) || [];
  async function confirm() {
    if (!action) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`/listings/${action.listing.id}`, {
        method: "PATCH",
        body: json({ status: action.status }),
      });
      notify(
        action.status === "handed_off"
          ? "Marked as handed off. Here’s to what’s next."
          : action.status === "archived"
            ? "Listing archived. You can still find it here."
            : "Your listing is live.",
      );
      setAction(null);
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-container">
      <PageHeading
        eyebrow="Your spaces"
        title="Your place. The next chapter."
        description="Keep your listings up to date and make room for a smooth handoff."
      >
        <Link className="button primary" to="/listings/new">
          <Plus size={17} />
          New listing
        </Link>
      </PageHeading>
      <div className="tabs" role="group" aria-label="Listing status">
        {[
          ["all", "All listings"],
          ["active", "Live"],
          ["draft", "Drafts"],
          ["handed_off", "Handed off"],
          ["archived", "Archived"],
        ].map(([value, label]) => (
          <button
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>
              {data?.listings.filter(
                (l) => value === "all" || l.status === value,
              ).length || 0}
            </span>
          </button>
        ))}
      </div>
      {loading ? (
        <Loading label="Loading your listings…" />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : listings.length ? (
        <div className="manage-listings">
          {listings.map((l) => (
            <article className="manage-listing" key={l.id}>
              <Link
                className="manage-photo"
                aria-label={`View ${l.title || "draft listing"}`}
                to={`/listings/${l.id}`}
              >
                {l.photos[0] ? (
                  <img
                    src={l.photos[0]}
                    alt={l.title || "Your draft listing"}
                  />
                ) : (
                  <div className="photo-placeholder">
                    <Image size={27} />
                  </div>
                )}
              </Link>
              <div className="manage-info">
                <div className="manage-meta">
                  <span className={`status-badge ${l.status}`}>
                    {STATUS_LABELS[l.status]}
                  </span>
                  <span>{ROOM_LABELS[l.roomType]}</span>
                </div>
                <h2>
                  <Link to={`/listings/${l.id}`}>
                    {l.title || "Untitled draft"}
                  </Link>
                </h2>
                <p>{l.address || "Add an address to your draft"}</p>
                <div className="manage-facts">
                  <strong>
                    {money(l.price)}
                    <span> / month</span>
                  </strong>
                  {l.availableFrom && l.availableTo && (
                    <span>
                      <CalendarDays size={14} />
                      {dateLabel(l.availableFrom)} to {dateLabel(l.availableTo)}
                    </span>
                  )}
                </div>
              </div>
              <div className="manage-actions">
                <Link
                  className="button secondary"
                  to={`/listings/${l.id}/edit`}
                >
                  <Pencil size={15} />
                  {l.status === "draft" ? "Finish listing" : "Edit listing"}
                </Link>
                {l.status === "active" ? (
                  <>
                    <Link className="button ghost" to="/requests">
                      View requests
                      <ArrowUpRight size={15} />
                    </Link>
                    <button
                      className="text-button"
                      onClick={() => {
                        setAction({ listing: l, status: "handed_off" });
                        setActionError("");
                      }}
                    >
                      <CheckCircle2 size={15} />
                      Mark handed off
                    </button>
                  </>
                ) : (
                  l.status !== "draft" && (
                    <button
                      className="button ghost"
                      onClick={() => {
                        setAction({ listing: l, status: "active" });
                        setActionError("");
                      }}
                    >
                      Relist
                      <ArrowUpRight size={15} />
                    </button>
                  )
                )}
                {l.status !== "archived" && (
                  <button
                    className="archive-button"
                    onClick={() => {
                      setAction({ listing: l, status: "archived" });
                      setActionError("");
                    }}
                  >
                    <Archive size={14} />
                    Archive
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<House size={29} strokeWidth={1.5} />}
          title={
            filter === "all"
              ? "A new home for your old place."
              : `No ${filter === "active" ? "live" : filter === "handed_off" ? "completed" : filter} listings yet.`
          }
          description={
            filter === "all"
              ? "Have a place opening up? Add the details, show the space, and connect with your next student."
              : "Your listings will appear here when their status changes."
          }
        >
          {filter === "all" && (
            <Link className="button primary" to="/listings/new">
              <Plus size={17} />
              List your place
            </Link>
          )}
        </EmptyState>
      )}
      <Modal
        open={!!action}
        onClose={() => !busy && setAction(null)}
        title={
          action?.status === "handed_off"
            ? "Found your next student?"
            : action?.status === "archived"
              ? "Archive this listing?"
              : "Put this place back on the map?"
        }
      >
        <p className="muted">
          {action?.status === "handed_off"
            ? "This removes your listing from browse. Keep working through the lease and final details directly with the student."
            : action?.status === "archived"
              ? "Your listing will be hidden from browse and kept in your archive. You can relist it later."
              : "Your listing will become visible in browse again. Make sure the photos, rent, and availability dates are still accurate."}
        </p>
        {actionError && <ErrorBox message={actionError} />}
        <div className="modal-actions">
          <Button
            variant="secondary"
            onClick={() => setAction(null)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button busy={busy} onClick={confirm}>
            {action?.status === "handed_off"
              ? "Mark handed off"
              : action?.status === "archived"
                ? "Archive listing"
                : "Relist listing"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export function Requests() {
  const { data, loading, error, refresh } = useResource<{
      incoming: HandoffRequest[];
      outgoing: HandoffRequest[];
    }>("/requests"),
    { user, notify } = useApp();
  const [params, setParams] = useSearchParams(),
    tab =
      params.get("tab") === "incoming"
        ? "incoming"
        : params.get("tab") === "outgoing"
          ? "outgoing"
          : data && !data.incoming.length && data.outgoing.length
            ? "outgoing"
            : "incoming";
  const [action, setAction] = useState<{
      request: HandoffRequest;
      status: "accepted" | "declined" | "withdrawn";
    } | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const items = data?.[tab] || [];
  const pendingCount = items.filter((r) => r.status === "pending").length;
  async function confirm() {
    if (!action) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{
        request: HandoffRequest;
        notification?: { emailSent: boolean };
      }>(`/requests/${action.request.id}`, {
        method: "PATCH",
        body: json({ status: action.status }),
      });
      notify(
        result.notification?.emailSent === false
          ? "Request updated. The email notification couldn’t be delivered."
          : action.status === "accepted"
            ? "Request accepted. You can now get in touch."
            : `Request ${action.status}.`,
      );
      setAction(null);
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-container requests-page">
      <PageHeading
        eyebrow="Make a connection"
        title="Good handoffs start here."
        description="A first message, a few details, and a step closer to your next place."
      />
      <div className="tabs" role="group" aria-label="Request direction">
        <button
          aria-pressed={tab === "incoming"}
          onClick={() => setParams({ tab: "incoming" })}
        >
          <Inbox size={17} />
          Received<span>{data?.incoming.length || 0}</span>
        </button>
        <button
          aria-pressed={tab === "outgoing"}
          onClick={() => setParams({ tab: "outgoing" })}
        >
          <Send size={16} />
          Sent<span>{data?.outgoing.length || 0}</span>
        </button>
      </div>
      {!loading && items.length > 0 && (
        <div className="requests-summary">
          <span>
            {items.length} request{items.length === 1 ? "" : "s"}
          </span>
          {pendingCount > 0 && (
            <span>
              <span className="blue-dot" />
              {pendingCount} awaiting{" "}
              {tab === "incoming" ? "your reply" : "a reply"}
            </span>
          )}
        </div>
      )}
      {loading ? (
        <Loading label="Catching up on your requests…" />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : items.length ? (
        <div className="request-list">
          {items.map((r) => (
            <article className="request-item" key={r.id}>
              <div className="request-item-top">
                <div className="request-person">
                  <span className="avatar">
                    {(tab === "incoming" ? r.requesterName : r.ownerName)
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <h2>
                      {tab === "incoming" ? r.requesterName : r.ownerName}
                    </h2>
                    <span>
                      {tab === "incoming"
                        ? "Interested in your place"
                        : "Your request"}{" "}
                      · {dateLabel(r.createdAt, true)}
                    </span>
                  </div>
                </div>
                <span className={`status-badge ${r.status}`}>
                  {r.status === "pending" && <Clock size={12} />}{" "}
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <Link
                className="request-listing-link"
                to={`/listings/${r.listingId}`}
              >
                {r.listingPhoto ? (
                  <img src={r.listingPhoto} alt="" />
                ) : (
                  <span className="small-photo-placeholder">
                    <House size={18} />
                  </span>
                )}
                <span>{r.listingTitle}</span>
                <ArrowUpRight size={16} />
              </Link>
              <div className="request-message">
                <span className="eyebrow">
                  {tab === "incoming" ? "Their message" : "Your message"}
                </span>
                <p>{r.message}</p>
              </div>
              {r.status === "accepted" && r.contact ? (
                <div className="contact-reveal">
                  <div>
                    <CheckCircle2 size={20} />
                    <span>
                      <strong>
                        You’re connected with {r.contact.name.split(" ")[0]}.
                      </strong>
                      <small>
                        Arrange a visit and talk through the lease together.
                      </small>
                    </span>
                  </div>
                  <a
                    href={`mailto:${r.contact.email}`}
                    className="button primary"
                  >
                    <Mail size={16} />
                    <span>{r.contact.email}</span>
                    <ArrowUpRight size={15} />
                  </a>
                </div>
              ) : r.status === "pending" ? (
                <div className="request-item-actions">
                  {tab === "incoming" ? (
                    <>
                      <p>Your emails are shared when you accept.</p>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAction({ request: r, status: "declined" });
                          setActionError("");
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        onClick={() => {
                          setAction({ request: r, status: "accepted" });
                          setActionError("");
                        }}
                      >
                        <Check size={16} />
                        Accept request
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        <Clock size={15} />
                        Waiting for {r.ownerName.split(" ")[0]} to respond.
                      </p>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setAction({ request: r, status: "withdrawn" });
                          setActionError("");
                        }}
                      >
                        Withdraw request
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <p className="request-closed">
                  {r.status === "declined"
                    ? "This request was declined."
                    : r.status === "withdrawn"
                      ? "This request was withdrawn."
                      : "The connection is accepted. Refresh to load contact details."}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={
            tab === "incoming" ? (
              <Inbox size={29} strokeWidth={1.5} />
            ) : (
              <MessageSquare size={29} strokeWidth={1.5} />
            )
          }
          title={
            tab === "incoming"
              ? "Your next conversation starts here."
              : "See a place you can picture yourself in?"
          }
          description={
            tab === "incoming"
              ? "When a student is interested in your listing, their message will land here."
              : "Send the student a thoughtful introduction. Keep track of the conversation right here."
          }
        >
          <Link
            className="button primary"
            to={tab === "incoming" ? "/my-listings" : "/browse"}
          >
            {tab === "incoming" ? "Go to your listings" : "Find your place"}
            <ArrowRight size={17} />
          </Link>
        </EmptyState>
      )}
      <Modal
        open={!!action}
        onClose={() => !busy && setAction(null)}
        title={
          action?.status === "accepted"
            ? "Ready to connect?"
            : action?.status === "declined"
              ? "Decline this request?"
              : "Withdraw your request?"
        }
      >
        <p className="muted">
          {action?.status === "accepted"
            ? `We’ll share your email (${user?.email}) with ${action.request.requesterName.split(" ")[0]}, and reveal theirs to you. Accepting starts a conversation and doesn’t commit you to a lease.`
            : action?.status === "declined"
              ? "The student will see that their request was declined. Your contact details will stay private."
              : "The listing owner will see that you’ve withdrawn. You can send a new request later if the place is still available."}
        </p>
        {actionError && <ErrorBox message={actionError} />}
        <div className="modal-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setAction(null)}
          >
            Cancel
          </Button>
          <Button busy={busy} onClick={confirm}>
            {action?.status === "accepted"
              ? "Accept & share emails"
              : action?.status === "declined"
                ? "Decline request"
                : "Withdraw request"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export function Profile() {
  const { user, setUser, campuses, notify } = useApp();
  const [name, setName] = useState(user?.name || ""),
    [bio, setBio] = useState(user?.bio || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const campus = campuses.find((c) => c.id === user?.campusId);
  useEffect(() => {
    setName(user?.name || "");
    setBio(user?.bio || "");
  }, [user]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("/profile", {
        method: "PATCH",
        body: json({ name, bio }),
      });
      setUser(r.user);
      notify("Your profile is up to date.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-container profile-page">
      <PageHeading
        eyebrow="Your account"
        title="A little about you."
        description="Make a good first introduction to your campus community."
      />
      <div className="profile-layout">
        <aside className="profile-identity">
          <span className="avatar profile-avatar">
            {user?.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
          <h2>{user?.name}</h2>
          <p>{campus?.name}</p>
          {user?.verified && (
            <span className="verified-badge">
              <ShieldCheck size={15} />
              Student email verified
            </span>
          )}
          <div className="profile-privacy">
            <ShieldCheck size={20} />
            <p>
              Your email stays private until you accept a request or your own
              request is accepted.
            </p>
          </div>
        </aside>
        <form className="profile-form" onSubmit={submit}>
          <h2>Profile details</h2>
          <Field
            label="Your name"
            hint="This is the name students see on your listings and requests."
          >
            <input
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label="About you"
            hint="Optional. A few words about your studies or what you’re looking for."
          >
            <textarea
              maxLength={1000}
              rows={4}
              placeholder="I’m studying…"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </Field>
          <div className="profile-readonly">
            <div>
              <span>Student email</span>
              <strong>{user?.email}</strong>
              <ShieldCheck size={17} />
            </div>
            <div>
              <span>Campus</span>
              <strong>{campus?.name}</strong>
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="profile-actions">
            <Link className="text-button" to="/forgot-password">
              Change password
              <ArrowUpRight size={15} />
            </Link>
            <Button
              busy={busy}
              disabled={name === user?.name && bio === (user?.bio || "")}
            >
              Save changes
              <Check size={16} />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
