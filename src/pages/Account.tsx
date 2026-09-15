import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
  Image,
  CalendarDays,
  Pencil,
  Eye,
  RotateCcw,
  ChevronRight,
  LogOut,
  Zap,
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
  GENDER_LABELS,
  ROOM_LABELS,
  STATUS_LABELS,
  type Gender,
  type HandoffRequest,
  type Listing,
  type User,
} from "../types";
import { GenderChoice } from "../components/Gender";
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Modal,
  PageHeading,
} from "../components/ui";
import { ListingCard } from "../components/ListingCard";
import { BoostModal, daysLeft } from "../components/BoostModal";
import { SchoolNotLive } from "../components/SchoolNotLive";

type TabItem = { value: string; label: string; count?: number };

/* Sliding tabs, transitions.dev 16-tabs-sliding. JS writes the active
   tab's offsetLeft and offsetWidth onto the pill, CSS owns the tween. */
function Tabs({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | null>(null);
  const signature = tabs.map((t) => `${t.value}:${t.count ?? ""}`).join(",");
  useLayoutEffect(() => {
    const bar = barRef.current,
      pill = pillRef.current;
    if (!bar || !pill) return;
    function move(animate: boolean) {
      const tab = bar!.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab || !pill) return;
      if (!animate) {
        const prior = pill.style.transition;
        pill.style.transition = "none";
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.style.width = `${tab.offsetWidth}px`;
        void pill.offsetWidth;
        pill.style.transition = prior;
      } else {
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.style.width = `${tab.offsetWidth}px`;
      }
    }
    move(previous.current !== null && previous.current !== value);
    previous.current = value;
    const onResize = () => move(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value, signature]);
  return (
    <div className="tab-bar" role="tablist" aria-label={label} ref={barRef}>
      <span className="tab-pill" aria-hidden="true" ref={pillRef} />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="count-pill">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="card-skeleton">
      <div className="skeleton" />
      <div>
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="row-skeleton">
      <div className="skeleton" />
      <div>
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div>
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </div>
  );
}

function RequestSkeleton() {
  return (
    <div className="rq-skeleton">
      <div>
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
}

const LISTING_TONE: Record<Listing["status"], string> = {
  active: "green",
  draft: "amber",
  handed_off: "blue",
  archived: "",
};
const REQUEST_TONE: Record<HandoffRequest["status"], string> = {
  pending: "amber",
  accepted: "green",
  declined: "red",
  withdrawn: "",
};

export function Saved() {
  const { user, campuses } = useApp();
  const campus = campuses.find((c) => c.id === user?.campusId);
  const { data, loading, error, refresh, setData } = useResource<{
    listings: Listing[];
  }>("/saved");
  const count = data?.listings.length || 0;
  return (
    <div className="page-container account-page">
      <PageHeading
        title="Saved places"
        description={
          loading
            ? "Loading your shortlist."
            : `${count} place${count === 1 ? "" : "s"} on your shortlist.`
        }
      >
        <Link className="button secondary" to="/browse">
          Browse places
          <ArrowRight size={16} />
        </Link>
      </PageHeading>
      {loading ? (
        <div className="listings-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : data?.listings.length ? (
        <div className="listings-grid enter-stagger">
          {data.listings.map((l) => (
            <ListingCard
              key={l.id}
              listing={{ ...l, saved: true }}
              campus={campus}
              variant="grid"
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
    { notify, user } = useApp();
  // Listing is the one thing a school that is not open yet holds back.
  const canPost = Boolean(user?.campusId);
  const [filter, setFilter] = useState("all"),
    [action, setAction] = useState<{
      listing: Listing;
      status: Listing["status"];
    } | null>(null),
    [boost, setBoost] = useState<Listing | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const listings =
    data?.listings.filter((l) => filter === "all" || l.status === filter) || [];
  const countFor = (value: string) =>
    data?.listings.filter((l) => value === "all" || l.status === value)
      .length || 0;
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
  const total = data?.listings.length || 0;
  return (
    <div className="page-container account-page">
      <PageHeading
        title="Your listings"
        description={
          loading
            ? "Loading your listings."
            : `${total} listing${total === 1 ? "" : "s"}, ${countFor("active")} live right now.`
        }
      >
        {canPost && (
          <Link className="button primary" to="/listings/new">
            <Plus size={17} />
            New listing
          </Link>
        )}
      </PageHeading>
      <Tabs
        label="Listing status"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "all", label: "All", count: countFor("all") },
          { value: "active", label: "Live", count: countFor("active") },
          { value: "draft", label: "Draft", count: countFor("draft") },
          {
            value: "handed_off",
            label: "Handed off",
            count: countFor("handed_off"),
          },
          {
            value: "archived",
            label: "Archived",
            count: countFor("archived"),
          },
        ]}
      />
      {loading ? (
        <div className="mg-list" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : listings.length ? (
        <div className="mg-list enter-stagger">
          {listings.map((l) => (
            <article className="mg-row" key={l.id}>
              <Link
                className="mg-row-link"
                to={`/listings/${l.id}`}
                aria-hidden="true"
                tabIndex={-1}
              />
              <Link
                className="mg-thumb"
                aria-label={`View ${l.title || "draft listing"}`}
                to={`/listings/${l.id}`}
              >
                {l.photos[0] ? (
                  <img src={l.photos[0]} alt="" loading="lazy" />
                ) : (
                  <span className="thumb-placeholder">
                    <Image size={18} strokeWidth={1.4} />
                  </span>
                )}
              </Link>
              <div className="mg-main">
                <div className="mg-title">
                  <h2>
                    <Link to={`/listings/${l.id}`}>
                      {l.title || "Untitled draft"}
                    </Link>
                  </h2>
                  <span className={`pill ${LISTING_TONE[l.status]}`}>
                    {STATUS_LABELS[l.status]}
                  </span>
                </div>
                <div className="mg-facts">
                  <strong>
                    {money(l.price)}
                    <span>/mo</span>
                  </strong>
                  <span>{ROOM_LABELS[l.roomType]}</span>
                  {l.address && <span>{l.address}</span>}
                  {l.availableFrom && l.availableTo && (
                    <span>
                      <CalendarDays size={13} />
                      {dateLabel(l.availableFrom)} to {dateLabel(l.availableTo)}
                    </span>
                  )}
                </div>
                <p className="mg-updated">
                  Updated {dateLabel(l.updatedAt, true)}
                </p>
              </div>
              <span className="mg-chevron" aria-hidden="true">
                <ChevronRight size={18} />
              </span>
              <div className="mg-actions">
                <Link
                  className="button small secondary"
                  to={`/listings/${l.id}/edit`}
                >
                  <Pencil size={14} />
                  {l.status === "draft" ? "Finish" : "Edit"}
                </Link>
                <Link className="button small ghost" to={`/listings/${l.id}`}>
                  <Eye size={14} />
                  View
                </Link>
                {l.status === "active" ? (
                  <>
                    {!canPost ? null : l.boosted ? (
                      <button
                        type="button"
                        className="boost-pill"
                        onClick={() => setBoost(l)}
                      >
                        <Zap size={13} fill="currentColor" strokeWidth={0} />
                        Boosted · {daysLeft(l.boostUntil)} day
                        {daysLeft(l.boostUntil) === 1 ? "" : "s"} left
                      </button>
                    ) : (
                      <button
                        className="button small secondary"
                        onClick={() => setBoost(l)}
                      >
                        <Zap size={14} />
                        Boost
                      </button>
                    )}
                    <Link className="button small ghost" to="/requests">
                      Requests
                      <ArrowUpRight size={14} />
                    </Link>
                    <button
                      className="button small ghost"
                      onClick={() => {
                        setAction({ listing: l, status: "handed_off" });
                        setActionError("");
                      }}
                    >
                      <CheckCircle2 size={14} />
                      Handed off
                    </button>
                  </>
                ) : (
                  l.status !== "draft" && (
                    <button
                      className="button small ghost"
                      onClick={() => {
                        setAction({ listing: l, status: "active" });
                        setActionError("");
                      }}
                    >
                      <RotateCcw size={14} />
                      Publish
                    </button>
                  )
                )}
                {l.status !== "archived" && (
                  <button
                    className="button small ghost quiet"
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
      ) : !canPost && filter === "all" ? (
        <SchoolNotLive compact />
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
          {filter === "all" && canPost && (
            <Link className="button primary" to="/listings/new">
              <Plus size={17} />
              List your place
            </Link>
          )}
        </EmptyState>
      )}
      {boost && (
        <BoostModal
          listing={boost}
          open={!!boost}
          onClose={() => {
            setBoost(null);
            refresh();
          }}
          onBoosted={() => refresh()}
        />
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
    <div className="page-container account-page requests-page">
      <PageHeading
        title="Requests"
        description={
          loading
            ? "Loading your requests."
            : pendingCount > 0
              ? `${items.length} request${items.length === 1 ? "" : "s"}, ${pendingCount} awaiting ${tab === "incoming" ? "your reply" : "a reply"}.`
              : `${items.length} request${items.length === 1 ? "" : "s"} in this view.`
        }
      />
      <Tabs
        label="Request direction"
        value={tab}
        onChange={(value) => setParams({ tab: value })}
        tabs={[
          {
            value: "incoming",
            label: "Received",
            count: data?.incoming.length || 0,
          },
          {
            value: "outgoing",
            label: "Sent",
            count: data?.outgoing.length || 0,
          },
        ]}
      />
      {loading ? (
        <div className="rq-list" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <RequestSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : items.length ? (
        <div className="rq-list enter-stagger">
          {items.map((r) => (
            <article className="rq-card" key={r.id}>
              <div className="rq-head">
                <Link className="rq-thumb" to={`/listings/${r.listingId}`}>
                  {r.listingPhoto ? (
                    <img src={r.listingPhoto} alt="" loading="lazy" />
                  ) : (
                    <span className="thumb-placeholder">
                      <House size={16} strokeWidth={1.4} />
                    </span>
                  )}
                </Link>
                <div className="rq-head-text">
                  <h2>
                    <Link to={`/listings/${r.listingId}`}>
                      {r.listingTitle}
                    </Link>
                  </h2>
                  <p>
                    <span className="avatar tiny">
                      {initials(
                        tab === "incoming" ? r.requesterName : r.ownerName,
                      )}
                    </span>
                    {tab === "incoming" ? r.requesterName : r.ownerName}
                    {tab === "incoming" && r.requesterGender && (
                      <em>· {GENDER_LABELS[r.requesterGender]}</em>
                    )}
                    <em>· {dateLabel(r.createdAt, true)}</em>
                  </p>
                </div>
                <span className={`pill ${REQUEST_TONE[r.status]}`}>
                  {r.status === "pending" && <Clock size={11} />}
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <blockquote className="rq-quote">
                <span className="eyebrow">
                  {tab === "incoming" ? "Their message" : "Your message"}
                </span>
                <p>{r.message}</p>
              </blockquote>
              {r.status === "accepted" && r.contact ? (
                <div className="rq-contact">
                  <CheckCircle2 size={18} />
                  <div>
                    <strong>
                      You’re connected with {r.contact.name.split(" ")[0]}.
                    </strong>
                    <small>
                      Arrange a visit and talk through the lease together.
                    </small>
                  </div>
                  <a
                    href={`mailto:${r.contact.email}`}
                    className="button small secondary"
                  >
                    <Mail size={14} />
                    <span>{r.contact.email}</span>
                  </a>
                </div>
              ) : r.status === "pending" ? (
                <div className="rq-actions">
                  {tab === "incoming" ? (
                    <>
                      <p>Your emails are shared when you accept.</p>
                      <Button
                        variant="secondary"
                        className="small"
                        onClick={() => {
                          setAction({ request: r, status: "declined" });
                          setActionError("");
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        className="small"
                        onClick={() => {
                          setAction({ request: r, status: "accepted" });
                          setActionError("");
                        }}
                      >
                        <Check size={15} />
                        Accept
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        <Clock size={14} />
                        Waiting for {r.ownerName.split(" ")[0]} to respond.
                      </p>
                      <Button
                        variant="secondary"
                        className="small"
                        onClick={() => {
                          setAction({ request: r, status: "withdrawn" });
                          setActionError("");
                        }}
                      >
                        Withdraw
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="rq-actions">
                  <p>
                    {r.status === "declined"
                      ? "This request was declined."
                      : r.status === "withdrawn"
                        ? "This request was withdrawn."
                        : "The connection is accepted. Refresh to load contact details."}
                  </p>
                </div>
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
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || ""),
    [bio, setBio] = useState(user?.bio || ""),
    [gender, setGender] = useState<Gender>(user?.gender || "unspecified"),
    [busy, setBusy] = useState(false),
    [signingOut, setSigningOut] = useState(false),
    [error, setError] = useState("");
  const campus = campuses.find((c) => c.id === user?.campusId);
  useEffect(() => {
    setName(user?.name || "");
    setBio(user?.bio || "");
    setGender(user?.gender || "unspecified");
  }, [user]);
  async function signOut() {
    setSigningOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      navigate("/browse");
      notify("You’re signed out.");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setSigningOut(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("/profile", {
        method: "PATCH",
        body: json({ name, bio, gender }),
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
    <div className="page-container account-page profile-page">
      <PageHeading
        title="Profile"
        description="How you appear to students on your listings and requests."
      />
      <div className="pf-layout enter-stagger">
        <aside className="pf-identity">
          <span className="avatar pf-avatar">{initials(user?.name || "")}</span>
          <h2>{user?.name}</h2>
          <p className="pf-email">{user?.email}</p>
          <p className="pf-campus">{campus?.name}</p>
          {user?.verified && (
            <span className="pill green pf-verified">
              <ShieldCheck size={13} />
              Student email verified
            </span>
          )}
          <p className="field-hint pf-note">
            Your email stays private until you accept a request or your own
            request is accepted.
          </p>
        </aside>
        <form className="pf-card" onSubmit={submit}>
          <h2>Profile details</h2>
          <div className="stack">
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
            <GenderChoice
              name="profile-gender"
              value={gender}
              onChange={setGender}
            />
            <div className="field-row">
              <Field label="Student email" hint="Verified, and never public.">
                <input value={user?.email || ""} readOnly disabled />
              </Field>
              <Field label="Campus" hint="Set from your student email domain.">
                <input value={campus?.name || ""} readOnly disabled />
              </Field>
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="pf-actions">
            <Link className="text-button" to="/forgot-password">
              Change password
              <ArrowUpRight size={15} />
            </Link>
            <Button
              busy={busy}
              disabled={
                name === user?.name &&
                bio === (user?.bio || "") &&
                gender === (user?.gender || "unspecified")
              }
            >
              Save changes
              <Check size={16} />
            </Button>
          </div>
        </form>
        <button
          type="button"
          className="pf-signout"
          onClick={signOut}
          disabled={signingOut}
        >
          <LogOut size={17} />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
