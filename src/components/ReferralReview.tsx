import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, MapPin, Mail, ArrowRight } from "lucide-react";
import { api, errorMessage, json, money, today } from "../lib/api";
import { useApp } from "../lib/context";
import { emptyDraft, type ImportDraft } from "../lib/import";
import { referralPath, type Referral } from "../lib/referrals";
import {
  AMENITIES,
  ROOM_LABELS,
  type Listing,
  type User,
  type ShareChannel,
} from "../types";
import { Button, ErrorBox, Field, Loading } from "./ui";
import { PreferenceChoice } from "./Gender";
import { ContactFields, type ContactValues } from "./Contact";
const Map = lazy(() => import("./Map"));

export function ReferralReview({
  referral: r,
  token,
}: {
  referral: Referral;
  token: string;
}) {
  const { user, setUser, campuses } = useApp();
  const [contact, setContact] = useState<ContactValues>({
    phone: user?.phone || "",
    instagram: user?.instagram || "",
    facebook: user?.facebook || "",
  });
  const [channels, setChannels] = useState<ShareChannel[]>(
    user?.shareChannels || ["email"],
  );
  const [contactOpen, setContactOpen] = useState(false);
  const key = `handoff:referral-review:${r.id}:${user?.id}`;
  const [draft, setDraft] = useState<ImportDraft>(() => {
    const original = {
      ...emptyDraft(),
      ...r.listing,
      photos: r.listing.photos || [],
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      return saved && typeof saved === "object"
        ? { ...original, ...saved }
        : original;
    } catch {
      return original;
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [published, setPublished] = useState<Listing | null>(null);
  const [editOpen, setEditOpen] = useState(
    !draft.title || draft.description.length < 30 || !draft.photos.length,
  );
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false),
    [matches, setMatches] = useState<
      { line: string; place: string; lat: number; lng: number }[]
    >([]);
  const campus = campuses.find((c) => c.id === "usc");
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* The server retains the imported draft. */
    }
  }, [key, draft]);
  const update = <K extends keyof ImportDraft>(
    name: K,
    value: ImportDraft[K],
  ) => {
    setDraft((d) => ({ ...d, [name]: value }));
    setError("");
  };
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (
      files.length + draft.photos.length > 16 ||
      Array.from(files).some((f) => f.size > 8 * 1024 * 1024)
    ) {
      setError("Choose up to 16 photos, no more than 8 MB each.");
      return;
    }
    setUploading(true);
    setError("");
    const body = new FormData();
    Array.from(files).forEach((f) => body.append("photos", f));
    try {
      const result = await api<{ photos: string[] }>("/uploads", {
        method: "POST",
        body,
      });
      setDraft((d) => ({ ...d, photos: [...d.photos, ...result.photos] }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }
  async function locate() {
    if (!draft.address || draft.address.trim().length < 5) {
      setError("Add your building or street address first.");
      return;
    }
    setLocating(true);
    setError("");
    try {
      const response = await api<{ results: typeof matches }>(
        `/geocode?q=${encodeURIComponent(draft.address)}&campusId=usc`,
      );
      setMatches(response.results);
      if (!response.results.length)
        setError("Choose your location on the map below.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLocating(false);
    }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (
      draft.title.trim().length < 8 ||
      draft.description.trim().length < 30 ||
      !draft.photos.length
    ) {
      setEditOpen(true);
      setError(
        "Add a clear title, a description of at least 30 characters and one photo.",
      );
      return;
    }
    if (
      draft.price === null ||
      draft.deposit === null ||
      draft.bedrooms === null ||
      draft.bathrooms === null ||
      !draft.roomType
    ) {
      setError("Confirm the rent, deposit, room type, bedrooms and bathrooms.");
      return;
    }
    if (draft.address.trim().length < 5) {
      setError("Add your building or street address.");
      return;
    }
    if (
      draft.price < 1 ||
      draft.price > 50000 ||
      draft.deposit < 0 ||
      draft.deposit > 100000 ||
      !Number.isInteger(draft.bedrooms) ||
      draft.bedrooms < 0 ||
      draft.bedrooms > 20 ||
      draft.bathrooms < 0.5 ||
      draft.bathrooms > 20 ||
      !Number.isInteger(draft.bathrooms * 2)
    ) {
      setError(
        "Check the rent, deposit, bedrooms and bathrooms. Bathrooms can use half steps.",
      );
      return;
    }
    if (
      [draft.price, draft.deposit, draft.originalPrice].some(
        (value) =>
          value != null &&
          Math.abs(value * 100 - Math.round(value * 100)) > 0.000001,
      )
    ) {
      setError("Use dollars and cents, with no more than two decimal places.");
      return;
    }
    if (draft.lat === null || draft.lng === null) {
      setError("Choose the location on the map.");
      return;
    }
    if (
      !draft.availableFrom ||
      !draft.availableTo ||
      draft.availableTo <= draft.availableFrom ||
      draft.availableTo < today()
    ) {
      setError("Confirm move-in and move-out dates that are still available.");
      return;
    }
    if (!confirmed) {
      setError(
        "Confirm that the details are accurate and the place is still available.",
      );
      return;
    }
    setBusy(true);
    try {
      if (
        user &&
        (contact.phone !== (user.phone || "") ||
          contact.instagram !== (user.instagram || "") ||
          contact.facebook !== (user.facebook || "") ||
          channels.join(",") !== user.shareChannels.join(","))
      ) {
        try {
          const result = await api<{ user: User }>("/profile", {
            method: "PATCH",
            body: json({
              name: user.name,
              bio: user.bio,
              gender: user.gender,
              ...contact,
              shareChannels: channels,
            }),
          });
          setUser(result.user);
        } catch (reason) {
          setContactOpen(true);
          throw reason;
        }
      }
      const { pinSource, ...payload } = draft;
      void pinSource;
      const result = await api<{ listing: Listing }>(
        `${referralPath(token)}/listing`,
        {
          method: "POST",
          body: json({
            ...payload,
            genderPreference:
              draft.roomType === "entire" ? "any" : draft.genderPreference,
            status: "active",
          }),
        },
      );
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Nothing to clear. */
      }
      setPublished(result.listing);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const numeric = (
    name: "price" | "deposit" | "bedrooms" | "bathrooms" | "originalPrice",
    label: string,
    min: number,
    max: number,
    step: string,
  ) => (
    <Field key={name} label={label}>
      <input
        type="number"
        inputMode={step === "1" ? "numeric" : "decimal"}
        required={name !== "originalPrice"}
        min={min}
        max={max}
        step={step}
        value={draft[name] ?? ""}
        onChange={(e) =>
          update(name, e.target.value === "" ? null : Number(e.target.value))
        }
        placeholder="Confirm"
      />
    </Field>
  );
  if (published)
    return (
      <div className="referral-published">
        <CheckCircle2 size={52} />
        <span className="eyebrow">You are all set</span>
        <h1>Your sublease is live.</h1>
        <p>
          We'll email <strong>{user?.email}</strong> when someone is interested.
          Your requests and listing are always in your account.
        </p>
        <div className="referral-published-card">
          {published.photos[0] && (
            <img src={published.photos[0]} alt={published.title} />
          )}
          <div>
            <h2>{published.title}</h2>
            <strong>{money(published.price)} / month</strong>
          </div>
        </div>
        <Link className="button primary" to="/my-listings">
          Manage my listing <ArrowRight size={16} />
        </Link>
        <Link className="button secondary" to={`/listings/${published.id}`}>
          View my live listing
        </Link>
      </div>
    );
  return (
    <form className="referral-review" onSubmit={publish} noValidate>
      <header>
        <span className="pill blue">
          <CheckCircle2 size={14} /> Your USC email is verified
        </span>
        <h1>A quick check, then you're live.</h1>
        <p>
          We've filled in your post and photos. Confirm anything missing and
          make it yours.
        </p>
      </header>
      <section className="referral-card referral-review-summary">
        <div className="referral-carousel" aria-label="Imported listing photos">
          {draft.photos.map((url, i) => (
            <img
              key={url}
              src={url}
              alt={`Your sublease, photo ${i + 1} of ${draft.photos.length}`}
              loading={i ? "lazy" : "eager"}
            />
          ))}
        </div>
        <div>
          <span className="eyebrow">{draft.photos.length} photos imported</span>
          <h2>{draft.title}</h2>
          <strong>
            {draft.price !== null
              ? `${money(draft.price)} / month`
              : "Confirm monthly rent below"}
          </strong>
        </div>
      </section>
      <section className="referral-card referral-review-fields">
        <h2>Confirm your availability</h2>
        <div className="referral-review-grid">
          <Field label="Move-in date">
            <input
              type="date"
              required
              value={draft.availableFrom}
              onChange={(e) => update("availableFrom", e.target.value)}
            />
          </Field>
          <Field label="Move-out date">
            <input
              type="date"
              required
              min={draft.availableFrom || today()}
              value={draft.availableTo}
              onChange={(e) => update("availableTo", e.target.value)}
            />
          </Field>
          {numeric("price", "Monthly rent ($)", 1, 50000, "0.01")}
          {numeric("deposit", "Security deposit ($)", 0, 100000, "0.01")}
        </div>
        <p className="field-hint">Use 0 only if there is no deposit.</p>
      </section>
      <section className="referral-card referral-review-fields">
        <h2>Your place</h2>
        <Field label="Building or street address">
          <input
            required
            minLength={5}
            maxLength={200}
            autoComplete="street-address"
            value={draft.address}
            onChange={(e) => {
              update("address", e.target.value);
              update("lat", null);
              update("lng", null);
              setMatches([]);
            }}
          />
        </Field>
        <div className="referral-review-grid">
          <Field label="Room type">
            <select
              required
              value={draft.roomType}
              onChange={(e) =>
                update("roomType", e.target.value as ImportDraft["roomType"])
              }
            >
              <option value="">Choose your space</option>
              {Object.entries(ROOM_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {numeric("bedrooms", "Bedrooms in the home", 0, 20, "1")}
          {numeric("bathrooms", "Bathrooms in the home", 0.5, 20, "0.5")}
        </div>
        <details
          className="referral-location-check"
          open={draft.lat === null || draft.lng === null}
        >
          <summary>
            <MapPin size={15} />
            {draft.lat === null
              ? "Place your map pin"
              : "Map location selected, tap to check"}
          </summary>
          <p>
            Search your address, choose the matching result, or tap the map.
          </p>
          <Button
            variant="secondary"
            type="button"
            busy={locating}
            onClick={locate}
          >
            Find my address
          </Button>
          {matches.map((m) => (
            <button
              className="referral-address-result"
              type="button"
              key={`${m.lat}:${m.lng}`}
              onClick={() => {
                setDraft((d) => ({ ...d, lat: m.lat, lng: m.lng }));
                setMatches([]);
              }}
            >
              {m.line}
              <small>{m.place}</small>
            </button>
          ))}
          {campus && (
            <Suspense fallback={<Loading label="Loading the map…" />}>
              <Map
                compact
                campus={campus}
                pin={
                  draft.lat !== null && draft.lng !== null
                    ? { lat: draft.lat, lng: draft.lng }
                    : undefined
                }
                onPin={(p) => setDraft((d) => ({ ...d, ...p }))}
              />
            </Suspense>
          )}
        </details>
      </section>
      <details
        className="referral-card referral-review-fields"
        open={editOpen}
        onToggle={(e) => setEditOpen(e.currentTarget.open)}
      >
        <summary>Edit description, preferences and photos</summary>
        <div className="stack">
          <Field label="Listing title">
            <input
              required
              minLength={8}
              maxLength={100}
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
            />
          </Field>
          <Field label="Description">
            <textarea
              required
              minLength={30}
              maxLength={5000}
              rows={6}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>
          {numeric(
            "originalPrice",
            "Your original monthly rent ($)",
            1,
            50000,
            "0.01",
          )}
          <PreferenceChoice
            value={draft.genderPreference}
            onChange={(v) => update("genderPreference", v)}
            roomType={draft.roomType || "private"}
          />
          <div className="check-grid">
            {AMENITIES.map((a) => (
              <label className="check-label" key={a}>
                <input
                  type="checkbox"
                  checked={draft.amenities.includes(a)}
                  onChange={(e) =>
                    update(
                      "amenities",
                      e.target.checked
                        ? [...draft.amenities, a]
                        : draft.amenities.filter((v) => v !== a),
                    )
                  }
                />
                {a}
              </label>
            ))}
          </div>
          <div className="referral-review-photo-list">
            {draft.photos.map((url, i) => (
              <div key={url}>
                <img src={url} alt={`Photo ${i + 1}`} />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "photos",
                      draft.photos.filter((p) => p !== url),
                    )
                  }
                >
                  Remove photo {i + 1}
                </button>
              </div>
            ))}
          </div>
          <Field label="Add photos">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={uploading || busy}
              onChange={(e) => upload(e.target.files)}
            />
          </Field>
          <p className="field-hint">
            Up to 16 photos, 8 MB each. Your first photo is the cover.
          </p>
        </div>
      </details>
      <section className="referral-card referral-review-fields">
        <h2>We'll handle the next step.</h2>
        <p className="referral-email">
          <Mail size={18} /> New requests go to {user?.email}. You choose who to
          connect with.
        </p>
        <details
          className="referral-contact-options"
          open={contactOpen}
          onToggle={(event) => setContactOpen(event.currentTarget.open)}
        >
          <summary>Choose other ways to connect (optional)</summary>
          <p>
            We will email new requests. You can also share these contact details
            when you accept one.
          </p>
          <ContactFields
            email={user?.email || ""}
            values={contact}
            onValues={setContact}
            channels={channels}
            onChannels={setChannels}
          />
        </details>
        <label className="check-label referral-consent">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            These details and photos are accurate, my sublease is still
            available, and I'm ready to publish.
          </span>
        </label>
        {error && <ErrorBox message={error} />}
      </section>
      <div className="referral-review-submit">
        <span>Free to list. No payment needed.</span>
        <Button type="submit" busy={busy} disabled={uploading}>
          Publish my listing <ArrowRight size={16} />
        </Button>
      </div>
    </form>
  );
}
