import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { api, errorMessage, json, useResource } from "../../lib/api";
import { useApp } from "../../lib/context";
import { Button, ErrorBox, Field, Loading } from "../../components/ui";
import {
  AdminPage,
  Pager,
  SearchField,
  Select,
  Status,
  TableShell,
  Toolbar,
  when,
} from "./parts";
import type { Referral } from "../../lib/referrals";
import { emptyDraft, type ImportDraft } from "../../lib/import";
import { AMENITIES, ROOM_LABELS } from "../../types";
import "../../styles/referral-admin.css";

type Metrics = {
  opens: number;
  uniqueVisits: number;
  accountCreated: number;
  verified: number;
  claimed: number;
  published: number;
};
type AdminReferral = Referral & {
  link: string;
  authorProfileUrl: string;
  sourceText: string;
  evidence: { student: string; usc: string; sublease: string };
  outreachStatus: string;
  outreachNotes: string;
  outreachDraft: string;
  metrics: Metrics;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type ReferralList = {
  referrals: AdminReferral[];
  totals: Metrics & { referrals: number };
  page: number;
  pages: number;
  total: number;
};
type ReferralDetail = {
  referral: AdminReferral;
  events: {
    id: string;
    type: string;
    createdAt: string;
    actorId: string | null;
    actorName: string | null;
    details: Record<string, unknown>;
  }[];
};
const STATES = [
  { value: "draft", label: "Drafting" },
  { value: "ready", label: "Ready to contact" },
  { value: "sent", label: "Message sent" },
  { value: "replied", label: "Replied" },
  { value: "declined", label: "Declined" },
  { value: "do_not_contact", label: "Do not contact" },
];
const METRICS = [
  ["opens", "Link opens"],
  ["uniqueVisits", "Unique browsers"],
  ["accountCreated", "Accounts created"],
  ["verified", "Emails verified"],
  ["claimed", "Drafts claimed"],
  ["published", "Published"],
] as const;
const EVENT_NAMES: Record<string, string> = {
  created: "Imported draft",
  opened: "Link opened",
  open: "Link opened",
  account_created: "Account created",
  signed_in: "Signed in",
  verified: "Email verified",
  claimed: "Draft claimed",
  listing_created: "Listing saved",
  listing_published: "Listing published",
  outreach_updated: "Outreach updated",
  updated: "Draft updated",
  photos_added: "Photos imported",
  photos_uploaded: "Photos imported",
  logged_in: "Signed in",
  listing_status_changed: "Listing status changed",
  revoked: "Invitation revoked",
};

const listingInput = (value: Partial<ImportDraft>) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, value]) =>
        !["photos", "pinSource"].includes(key) &&
        value !== null &&
        value !== undefined &&
        value !== "",
    ),
  );
function Counts({ values }: { values: Metrics }) {
  return (
    <div className="referral-metrics">
      {METRICS.map(([key, label]) => (
        <div key={key}>
          <strong>{values[key] || 0}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
function CopyButton({
  value,
  label = "Copy link",
}: {
  value: string;
  label?: string;
}) {
  const { notify } = useApp();
  return (
    <button
      className="button secondary small"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          notify("Copied.");
        } catch {
          notify("Copy unavailable. Select the text and copy it.", "error");
        }
      }}
    >
      <Copy size={14} />
      {label}
    </button>
  );
}
function ListingFields({
  value,
  onChange,
}: {
  value: Partial<ImportDraft>;
  onChange: (d: Partial<ImportDraft>) => void;
}) {
  const textField = (key: keyof ImportDraft, label: string, type = "text") => (
    <Field label={label} key={key}>
      <input
        type={type}
        step={key === "bathrooms" ? "0.5" : "any"}
        value={value[key] == null ? "" : String(value[key])}
        onChange={(e) =>
          onChange({
            ...value,
            [key]:
              type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : e.target.value,
          })
        }
      />
    </Field>
  );
  return (
    <div className="referral-form-grid">
      {textField("title", "Listing title")}
      {textField("address", "Address")}
      <Field label="Description">
        <textarea
          rows={5}
          value={value.description || ""}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </Field>
      <Field label="Room type">
        <select
          value={value.roomType || ""}
          onChange={(e) =>
            onChange({
              ...value,
              roomType: e.target.value as ImportDraft["roomType"],
            })
          }
        >
          <option value="">Unknown, owner confirms</option>
          {Object.entries(ROOM_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {textField("price", "Monthly rent ($)", "number")}
      {textField("deposit", "Deposit ($)", "number")}
      {textField("originalPrice", "Original monthly rent ($)", "number")}
      {textField("bedrooms", "Bedrooms", "number")}
      {textField("bathrooms", "Bathrooms", "number")}
      {textField("availableFrom", "Available from", "date")}
      {textField("availableTo", "Available until", "date")}
      {textField("lat", "Map latitude", "number")}
      {textField("lng", "Map longitude", "number")}
      <div className="referral-form-wide">
        <span className="field-label">Amenities stated in the post</span>
        <div className="check-grid">
          {AMENITIES.map((a) => (
            <label className="check-label" key={a}>
              <input
                type="checkbox"
                checked={value.amenities?.includes(a) || false}
                onChange={(e) =>
                  onChange({
                    ...value,
                    amenities: e.target.checked
                      ? [...(value.amenities || []), a]
                      : (value.amenities || []).filter((x) => x !== a),
                  })
                }
              />
              {a}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
function NewReferral({ cancel }: { cancel: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    authorName: "",
    authorProfileUrl: "",
    sourceName: "",
    sourceUrl: "",
    sourcePostedAt: "",
    sourceText: "",
    evidence: { student: "", usc: "", sublease: "" },
  });
  const [listing, setListing] = useState<Partial<ImportDraft>>(emptyDraft());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = (
    key:
      | "authorName"
      | "authorProfileUrl"
      | "sourceName"
      | "sourceUrl"
      | "sourcePostedAt",
    label: string,
    required = true,
  ) => (
    <Field key={key} label={label}>
      <input
        type={
          key.endsWith("Url")
            ? "url"
            : key === "sourcePostedAt"
              ? "date"
              : "text"
        }
        required={required}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ referral: AdminReferral }>(
        "/admin/referrals",
        {
          method: "POST",
          body: json({
            ...form,
            sourcePostedAt: form.sourcePostedAt
              ? `${form.sourcePostedAt}T12:00:00.000Z`
              : null,
            listing: listingInput(listing),
            outreachStatus: "draft",
          }),
        },
      );
      navigate(`/referrals/${result.referral.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="referral-admin-card stack" onSubmit={submit}>
      <h2>Import a student sublease</h2>
      <p className="admin-help">
        Use a public post from a USC student offering their own sublease. Leave
        unstated listing details blank. This creates a private invitation.
      </p>
      {error && <ErrorBox message={error} />}
      <div className="referral-form-grid">
        {field("authorName", "Student name")}
        {field("authorProfileUrl", "Student profile URL", false)}
        {field("sourceName", "Group or forum")}
        {field("sourceUrl", "Original post URL")}
        {field("sourcePostedAt", "Post date", false)}
      </div>
      <Field label="Original post text">
        <textarea
          required
          rows={7}
          value={form.sourceText}
          onChange={(e) => setForm({ ...form, sourceText: e.target.value })}
        />
      </Field>
      <h3>Qualification evidence</h3>
      <p className="admin-help">
        Record the actual wording or public profile evidence for each check. A
        group name alone does not establish student status.
      </p>
      <div className="referral-form-grid">
        {(["student", "usc", "sublease"] as const).map((key) => (
          <Field
            key={key}
            label={
              {
                student: "Current student evidence",
                usc: "USC and Los Angeles evidence",
                sublease: "Personal sublease evidence",
              }[key]
            }
          >
            <textarea
              required
              rows={3}
              value={form.evidence[key]}
              onChange={(e) =>
                setForm({
                  ...form,
                  evidence: { ...form.evidence, [key]: e.target.value },
                })
              }
            />
          </Field>
        ))}
      </div>
      <h3>Imported listing</h3>
      <ListingFields value={listing} onChange={setListing} />
      <div className="referral-admin-actions">
        <Button type="submit" busy={busy}>
          Create private invitation
        </Button>
        <button type="button" className="button secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function Detail({ id }: { id: string }) {
  const { data, error, loading, refresh } = useResource<ReferralDetail>(
    `/admin/referrals/${id}`,
  );
  if (loading) return <Loading label="Loading invitation…" />;
  if (error || !data)
    return (
      <ErrorBox message={error || "Invitation unavailable."} retry={refresh} />
    );
  return (
    <DetailContent
      key={`${id}-${data.referral.updatedAt}`}
      data={data}
      refresh={refresh}
    />
  );
}
function DetailContent({
  data,
  refresh,
}: {
  data: ReferralDetail;
  refresh: () => void;
}) {
  const r = data.referral;
  const { notify } = useApp();
  const [status, setStatus] = useState(r.outreachStatus);
  const [draft, setDraft] = useState(r.outreachDraft);
  const [notes, setNotes] = useState(r.outreachNotes);
  const [note, setNote] = useState("");
  const [listing, setListing] = useState(r.listing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  async function mutate(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/referrals/${r.id}${path}`, {
        method: path ? "POST" : "PATCH",
        body: body === undefined ? undefined : json(body),
      });
      notify("Invitation updated.");
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("photos", f));
    setBusy(true);
    setError("");
    try {
      await api(`/admin/referrals/${r.id}/photos`, {
        method: "POST",
        body: form,
      });
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="referral-admin-heading">
        <Link to="/referrals" className="back-link">
          <ArrowLeft size={15} />
          All invitations
        </Link>
        <div>
          <Status
            value={r.status}
            label={r.status === "pending" ? "Private invitation" : undefined}
          />
          {r.listingStatus && <Status value={r.listingStatus} />}
        </div>
      </div>
      <div className="referral-admin-card referral-link-card">
        <div>
          <span className="eyebrow">
            Personal invitation for {r.authorName}
          </span>
          <h2>{r.listing.title || "USC sublease"}</h2>
          <a
            className="referral-long-link"
            href={r.link}
            target="_blank"
            rel="noreferrer"
          >
            {r.link}
          </a>
        </div>
        <CopyButton value={r.link} />
      </div>
      <Counts values={r.metrics} />
      <p className="admin-help">
        Unique visits count browsers, not confirmed people. Signup and
        verification events identify the account that used the link. Only a
        verified claim associates that account with this sublease. Opening the
        invitation above counts as a visit; use the preview below for internal
        review.
      </p>
      {error && <ErrorBox message={error} />}
      <div className="referral-admin-layout">
        <div className="stack">
          <section className="referral-admin-card stack">
            <div className="referral-section-heading">
              <h2>Outreach</h2>
              <Status
                value={status}
                label={STATES.find((x) => x.value === status)?.label}
              />
            </div>
            <Field label="Outreach status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATES.map((s) => (
                  <option value={s.value} key={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Personal message draft">
              <textarea
                rows={10}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </Field>
            <div className="referral-admin-actions">
              <CopyButton value={draft} label="Copy message" />
              {r.authorProfileUrl && (
                <a
                  className="button secondary small"
                  href={r.authorProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  Facebook profile
                </a>
              )}
            </div>
            <p className="admin-help">
              Copying a message does not send it. Mark it sent only after you
              send it yourself.
            </p>
            <Field label="Outreach notes">
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Field label="Add a timeline note">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reply received, follow-up context, or a correction"
              />
            </Field>
            <Button
              busy={busy}
              onClick={() =>
                mutate("", {
                  outreachStatus: status,
                  outreachDraft: draft,
                  outreachNotes: notes,
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              }
            >
              Save outreach update
            </Button>
          </section>
          <section className="referral-admin-card stack">
            <div className="referral-section-heading">
              <h2>Source and qualification</h2>
              <a
                className="button secondary small"
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} />
                Original post
              </a>
            </div>
            <p>
              {r.sourceName} ·{" "}
              {r.sourcePostedAt
                ? when(r.sourcePostedAt, false)
                : "Post date not recorded"}
            </p>
            <dl className="referral-evidence">
              {Object.entries(r.evidence).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {{ student: "Student", usc: "USC", sublease: "Sublease" }[
                      key
                    ] || key}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Read original post</summary>
              <p className="referral-source-text">{r.sourceText}</p>
            </details>
          </section>
          <section className="referral-admin-card stack">
            <h2>Private listing preview</h2>
            <div className="referral-admin-photos">
              {r.photos.map((p, i) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                  <img
                    src={p.url}
                    alt={`Imported photo ${i + 1}`}
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
            {r.status === "pending" && (
              <label className="button secondary referral-upload">
                <Upload size={15} />
                Import listing photos
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={busy}
                  onChange={(e) => upload(e.target.files)}
                />
              </label>
            )}
            <p className="admin-help">
              Use photos of the actual space from the source post. Imported
              photos remain private until the owner publishes.
            </p>
            {r.status === "pending" ? (
              <>
                <ListingFields value={listing} onChange={setListing} />
                <Button
                  busy={busy}
                  onClick={() => mutate("", { listing: listingInput(listing) })}
                >
                  Save imported details
                </Button>
              </>
            ) : (
              <>
                <p>{r.listing.description}</p>
                {r.listingId && (
                  <Link
                    to={`/listings?listing=${r.listingId}`}
                    className="button secondary"
                  >
                    View listing in dashboard
                  </Link>
                )}
                <p className="admin-help">
                  The student owns the claimed draft. Imported details are no
                  longer editable here.
                </p>
              </>
            )}
          </section>
        </div>
        <aside className="stack">
          <section className="referral-admin-card">
            <div className="referral-section-heading">
              <h2>Activity timeline</h2>
              <button
                className="icon-button"
                onClick={refresh}
                aria-label="Refresh activity"
              >
                <RefreshCw size={15} />
              </button>
            </div>
            <p className="admin-help">
              Last opened {r.lastOpenedAt ? when(r.lastOpenedAt) : "never"}
            </p>
            <ol className="referral-timeline">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="referral-timeline-dot" />
                  <div>
                    <strong>
                      {EVENT_NAMES[e.type] || e.type.replaceAll("_", " ")}
                    </strong>
                    <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
                    {e.actorName && (
                      <span className="referral-event-actor">
                        {e.actorName}
                      </span>
                    )}
                    {Object.keys(e.details).length > 0 && (
                      <dl>
                        {Object.entries(e.details).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k.replaceAll("_", " ")}</dt>
                            <dd>
                              {typeof v === "string" ? v : JSON.stringify(v)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {!data.events.length && (
              <p className="admin-help">No activity yet.</p>
            )}
          </section>
          <section className="referral-admin-card stack">
            <h3>Invitation controls</h3>
            <p className="admin-help">
              Created {when(r.createdAt)}. Revoking stops new claims and opens.
              A listing already claimed remains under its owner's control.
            </p>
            {r.status !== "revoked" &&
              (confirmRevoke ? (
                <>
                  <p>Revoke this invitation link?</p>
                  <Button busy={busy} onClick={() => mutate("/revoke")}>
                    Revoke invitation
                  </Button>
                  <button
                    className="button secondary"
                    onClick={() => setConfirmRevoke(false)}
                  >
                    Keep invitation
                  </button>
                </>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setConfirmRevoke(true)}
                >
                  Revoke invitation
                </button>
              ))}
          </section>
        </aside>
      </div>
    </>
  );
}
export default function Referrals() {
  const { id } = useParams();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useResource<ReferralList>(
    id
      ? null
      : `/admin/referrals?query=${encodeURIComponent(query)}${status ? `&outreachStatus=${encodeURIComponent(status)}` : ""}&page=${page}`,
  );
  return (
    <AdminPage
      title="Student outreach"
      description="From a public USC sublease post to a verified student listing."
      actions={
        !id && (
          <Button onClick={() => setCreating(!creating)}>
            <Plus size={16} />
            Import a sublease
          </Button>
        )
      }
    >
      {id ? (
        <Detail id={id} />
      ) : creating ? (
        <NewReferral cancel={() => setCreating(false)} />
      ) : (
        <>
          {data && <Counts values={data.totals} />}
          <Toolbar>
            <SearchField
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder="Search students, posts, or listings"
            />
            <Select
              label="Outreach"
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[{ value: "", label: "All stages" }, ...STATES]}
            />
            <button
              className="icon-button"
              onClick={refresh}
              aria-label="Refresh invitations"
            >
              <RefreshCw size={16} />
            </button>
          </Toolbar>
          {error ? (
            <ErrorBox message={error} retry={refresh} />
          ) : (
            <TableShell
              loading={loading}
              empty={!data?.referrals.length}
              emptyLabel="No invitations yet. Import a qualifying USC student sublease to start."
              columns={[
                { key: "student", label: "Student / listing" },
                { key: "outreach", label: "Outreach" },
                { key: "opens", label: "Opens / unique", numeric: true },
                { key: "signup", label: "Accounts", numeric: true },
                { key: "verified", label: "Verified", numeric: true },
                { key: "result", label: "Listing" },
                { key: "last", label: "Last opened" },
                { key: "link", label: "Invitation" },
              ]}
            >
              {data?.referrals.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      className="referral-row-title"
                      to={`/referrals/${r.id}`}
                    >
                      {r.authorName}
                    </Link>
                    <span className="referral-row-sub">
                      {r.listing.title || r.sourceName}
                    </span>
                  </td>
                  <td>
                    <Status
                      value={r.outreachStatus}
                      label={
                        STATES.find((x) => x.value === r.outreachStatus)?.label
                      }
                    />
                  </td>
                  <td className="numeric">
                    {r.metrics.opens} / {r.metrics.uniqueVisits}
                  </td>
                  <td className="numeric">{r.metrics.accountCreated}</td>
                  <td className="numeric">{r.metrics.verified}</td>
                  <td>
                    <Status value={r.listingStatus || r.status} />
                  </td>
                  <td>
                    {r.lastOpenedAt ? when(r.lastOpenedAt) : "Not opened"}
                  </td>
                  <td>
                    <CopyButton value={r.link} />
                    <Link
                      className="referral-row-sub"
                      to={`/referrals/${r.id}`}
                    >
                      Details and timeline
                    </Link>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
          {data && (
            <Pager
              page={data.page}
              pages={data.pages}
              total={data.total}
              onPage={setPage}
            />
          )}
          <p className="admin-help">
            Invitations stay private until a verified USC student claims,
            reviews, and publishes. No outreach is sent automatically.
          </p>
        </>
      )}
    </AdminPage>
  );
}
