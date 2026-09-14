import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  ImagePlus,
  MapPin,
  Save,
  Star,
  Upload,
  X,
  Eye,
} from "lucide-react";
import { AMENITIES, ROOM_LABELS, type Listing } from "../types";
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
  PageHeading,
} from "../components/ui";
const Map = lazy(() => import("../components/Map"));
type Draft = {
  title: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  price: string;
  deposit: string;
  originalPrice: string;
  bedrooms: string;
  bathrooms: string;
  roomType: Listing["roomType"];
  availableFrom: string;
  availableTo: string;
  amenities: string[];
  photos: string[];
};
const STEPS = ["The basics", "The details", "Photos", "Review"];
const STEP_NOTES = [
  "Location and type",
  "Rent and availability",
  "Show the space",
  "Publish when ready",
];
const STEP_TITLES = [
  "Start with the place",
  "The details that matter",
  "Give them a look around",
  "One last look",
];
const STEP_SUBTITLES = [
  "Where is it, and what are you offering?",
  "Set expectations clearly, so the next conversation is easy.",
  "Add bright, recent photos that show the actual space.",
  "Check everything before your listing goes live.",
];
export default function ListingEditor() {
  const { id } = useParams(),
    { user, campuses, notify } = useApp(),
    navigate = useNavigate();
  const campus = campuses.find((c) => c.id === user?.campusId) || campuses[0];
  const { data, loading, error, refresh } = useResource<{ listing: Listing }>(
    id ? `/listings/${id}` : null,
  );
  const [draft, setDraft] = useState<Draft>({
      title: "",
      description: "",
      address: "",
      lat: campus?.lat || 34.0224,
      lng: campus?.lng || -118.2851,
      price: "",
      deposit: "0",
      originalPrice: "",
      bedrooms: "1",
      bathrooms: "1",
      roomType: "private",
      availableFrom: "",
      availableTo: "",
      amenities: [],
      photos: [],
    }),
    [step, setStep] = useState(0),
    [pinPlaced, setPinPlaced] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false),
    [pending, setPending] = useState(0),
    [dragOver, setDragOver] = useState(false),
    [formError, setFormError] = useState(""),
    [showPublish, setShowPublish] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    topRef = useRef<HTMLDivElement>(null),
    fieldsRef = useRef<HTMLDivElement>(null);
  // Error shake, transitions.dev 12-error-state-shake.
  function fail(message: string) {
    setFormError(message);
    const el = fieldsRef.current;
    if (!el) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
  }
  useEffect(() => {
    if (data?.listing) {
      const l = data.listing;
      setDraft({
        title: l.title,
        description: l.description,
        address: l.address,
        lat: l.lat,
        lng: l.lng,
        price: String(l.price),
        deposit: String(l.deposit),
        originalPrice: l.originalPrice ? String(l.originalPrice) : "",
        bedrooms: String(l.bedrooms),
        bathrooms: String(l.bathrooms),
        roomType: l.roomType,
        availableFrom: l.availableFrom,
        availableTo: l.availableTo,
        amenities: l.amenities,
        photos: l.photos,
      });
      setPinPlaced(true);
      setDirty(false);
    }
  }, [data]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setFormError("");
  }
  function validatePart(part: number) {
    if (part === 0) {
      if (draft.title.trim().length < 8)
        return "Give your listing a clear title of at least 8 characters.";
      if (draft.address.trim().length < 5)
        return "Add the street address or building name.";
      if (!pinPlaced)
        return "Place a pin on the map so students can find the area.";
      if (
        !Number.isFinite(draft.lat) ||
        !Number.isFinite(draft.lng) ||
        draft.lat > 90 ||
        draft.lat < -90 ||
        draft.lng > 180 ||
        draft.lng < -180
      )
        return "Please choose a valid location.";
    }
    if (part === 1) {
      if (
        !draft.price ||
        Number(draft.price) < 1 ||
        Number(draft.price) > 20000
      )
        return "Enter a monthly rent between $1 and $20,000.";
      if (Number(draft.deposit) < 0 || Number(draft.deposit) > 50000)
        return "Enter a deposit between $0 and $50,000.";
      if (
        draft.originalPrice &&
        (Number(draft.originalPrice) < 1 || Number(draft.originalPrice) > 50000)
      )
        return "Enter what you pay now, between $1 and $50,000, or leave it blank.";
      if (
        !draft.availableFrom ||
        !draft.availableTo ||
        draft.availableTo <= draft.availableFrom
      )
        return "Choose a move-out date after the move-in date.";
      if (draft.availableTo < new Date().toISOString().slice(0, 10))
        return "Choose an availability end date that hasn’t passed.";
      if (draft.description.trim().length < 40)
        return "Write at least 40 characters about the place, roommates, and lease details.";
    }
    if (part === 2 && !draft.photos.length)
      return "Add at least one photo before publishing.";
    return "";
  }
  function next(e: FormEvent) {
    e.preventDefault();
    const err = validatePart(step);
    if (err) {
      fail(err);
      return;
    }
    setStep((s) => Math.min(s + 1, 3));
    setFormError("");
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setFormError("");
    if (files.length + draft.photos.length > 8) {
      fail("Choose up to 8 photos in total.");
      return;
    }
    if (Array.from(files).some((f) => f.size > 8 * 1024 * 1024)) {
      fail("Each photo needs to be under 8 MB.");
      return;
    }
    if (
      Array.from(files).some(
        (f) => !["image/jpeg", "image/png", "image/webp"].includes(f.type),
      )
    ) {
      fail("Use JPG, PNG, or WebP photos.");
      return;
    }
    setUploading(true);
    setPending(files.length);
    const form = new FormData();
    for (const file of Array.from(files)) form.append("photos", file);
    try {
      const result = await api<{ photos: string[] }>("/uploads", {
        method: "POST",
        body: form,
      });
      setDraft((d) => ({ ...d, photos: [...d.photos, ...result.photos] }));
      setDirty(true);
      notify(
        `${result.photos.length} photo${result.photos.length === 1 ? "" : "s"} uploaded.`,
      );
    } catch (e) {
      fail(errorMessage(e));
    } finally {
      setUploading(false);
      setPending(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragOver(false);
    if (uploading || draft.photos.length >= 8) return;
    upload(e.dataTransfer.files);
  }
  async function save(status: "draft" | "active") {
    setFormError("");
    if (status === "active") {
      for (let i = 0; i < 3; i++) {
        const err = validatePart(i);
        if (err) {
          setStep(i);
          fail(err);
          setShowPublish(false);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...draft,
        price: Number(draft.price) || 0,
        deposit: Number(draft.deposit) || 0,
        originalPrice: draft.originalPrice ? Number(draft.originalPrice) : null,
        bedrooms: Number(draft.bedrooms),
        bathrooms: Number(draft.bathrooms),
        status,
      };
      const result = await api<{ listing: Listing }>(
        id ? `/listings/${id}` : "/listings",
        { method: id ? "PATCH" : "POST", body: json(payload) },
      );
      setDirty(false);
      setShowPublish(false);
      notify(
        status === "active"
          ? "Your listing is live."
          : "Draft saved. Pick it up from My listings.",
      );
      navigate(
        status === "active" ? `/listings/${result.listing.id}` : "/my-listings",
      );
    } catch (e) {
      fail(errorMessage(e));
      setShowPublish(false);
    } finally {
      setSaving(false);
    }
  }
  if (loading) return <Loading label="Loading your listing…" />;
  if (error)
    return (
      <div className="page-container narrow">
        <BackLink to="/my-listings" />
        <ErrorBox message={error} retry={refresh} />
      </div>
    );
  if (data && data.listing.ownerId !== user?.id)
    return (
      <div className="page-container narrow">
        <ErrorBox message="You can only edit your own listings." />
      </div>
    );
  const live = data?.listing.status === "active";
  return (
    <div className="page-container editor-page" ref={topRef}>
      <BackLink to="/my-listings">My listings</BackLink>
      <PageHeading
        title={id ? "Edit listing" : "List your place"}
        description={`Four short steps. Students at ${campus?.shortName || "your campus"} see it once you publish.`}
      >
        <span className={`pill ${live ? "green" : "blue"}`}>
          {live ? "Live" : "Draft"}
        </span>
      </PageHeading>
      <div className="editor-layout">
        <aside className="editor-rail">
          <ol className="step-rail">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`step-item ${i === step ? "is-current" : ""} ${i < step ? "is-done" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (i < step) {
                      setStep(i);
                      setFormError("");
                    }
                  }}
                  disabled={i > step}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className="step-dot">
                    {i < step ? (
                      <span
                        className="step-check"
                        data-state="in"
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12.5 10 17.5 19 7" />
                        </svg>
                      </span>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="step-text">
                    <strong>{label}</strong>
                    <small>{STEP_NOTES[i]}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="draft-note">
            {dirty
              ? "You have unsaved changes."
              : "Your draft stays private until you publish."}
          </p>
        </aside>
        <section className="editor-content">
          <form
            id="listing-form"
            onSubmit={
              step === 3
                ? (e) => {
                    e.preventDefault();
                    setShowPublish(true);
                  }
                : next
            }
          >
            <div className="editor-section-head">
              <div>
                <h2>{STEP_TITLES[step]}</h2>
                <p>{STEP_SUBTITLES[step]}</p>
              </div>
              <span className="step-count">Step {step + 1} of 4</span>
            </div>
            <div
              className="editor-fields"
              ref={fieldsRef}
              onAnimationEnd={() =>
                fieldsRef.current?.classList.remove("is-shaking")
              }
            >
              {step === 0 && (
                <div className="stack">
                  <Field
                    label="Listing title"
                    hint="Keep it specific. A feature, neighborhood, or building name works well."
                  >
                    <input
                      autoFocus
                      required
                      minLength={8}
                      maxLength={100}
                      value={draft.title}
                      onChange={(e) => update("title", e.target.value)}
                      placeholder="Sunny private room near campus"
                    />
                  </Field>
                  <fieldset className="room-type-field">
                    <legend>What are you offering?</legend>
                    <div className="room-options">
                      {Object.entries(ROOM_LABELS).map(([value, label]) => (
                        <label
                          key={value}
                          className={draft.roomType === value ? "selected" : ""}
                        >
                          <input
                            type="radio"
                            name="roomType"
                            value={value}
                            checked={draft.roomType === value}
                            onChange={() =>
                              update("roomType", value as Listing["roomType"])
                            }
                          />
                          <span>{label}</span>
                          <small>
                            {value === "private"
                              ? "A bedroom to yourself"
                              : value === "shared"
                                ? "A room with a roommate"
                                : "The whole home"}
                          </small>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Field
                    label="Street address or building"
                    hint="This is visible on your listing. Leave out your unit number."
                  >
                    <input
                      required
                      minLength={5}
                      maxLength={200}
                      autoComplete="street-address"
                      value={draft.address}
                      onChange={(e) => update("address", e.target.value)}
                      placeholder="123 West 30th Street, Los Angeles"
                    />
                  </Field>
                  <div className="field">
                    <div className="field-label">Put it on the map</div>
                    <p className="field-hint">
                      Place the pin at your building, so students can understand
                      the location.
                    </p>
                    {campus && (
                      <div className="editor-map">
                        <Suspense fallback={<Loading label="Loading map…" />}>
                          <Map
                            compact
                            campus={campus}
                            pin={
                              pinPlaced
                                ? { lat: draft.lat, lng: draft.lng }
                                : undefined
                            }
                            onPin={(point) => {
                              setDraft((d) => ({ ...d, ...point }));
                              setPinPlaced(true);
                              setDirty(true);
                              setFormError("");
                            }}
                          />
                        </Suspense>
                      </div>
                    )}
                    <div className={`pin-status ${pinPlaced ? "placed" : ""}`}>
                      <MapPin size={14} />
                      {pinPlaced
                        ? "Location pin placed"
                        : "Choose your building on the map"}
                    </div>
                    <details className="coordinate-fields">
                      <summary>Enter coordinates instead</summary>
                      <div className="field-row">
                        <Field label="Latitude">
                          <input
                            type="number"
                            step="any"
                            min="-90"
                            max="90"
                            value={draft.lat}
                            onChange={(e) => {
                              update("lat", Number(e.target.value));
                              setPinPlaced(true);
                            }}
                          />
                        </Field>
                        <Field label="Longitude">
                          <input
                            type="number"
                            step="any"
                            min="-180"
                            max="180"
                            value={draft.lng}
                            onChange={(e) => {
                              update("lng", Number(e.target.value));
                              setPinPlaced(true);
                            }}
                          />
                        </Field>
                      </div>
                    </details>
                  </div>
                </div>
              )}
              {step === 1 && (
                <div className="stack">
                  <div className="field-row">
                    <Field label="Monthly rent">
                      <div className="input-prefix">
                        <span>$</span>
                        <input
                          type="number"
                          required
                          min="1"
                          max="20000"
                          step="1"
                          value={draft.price}
                          onChange={(e) => update("price", e.target.value)}
                          placeholder="1,200"
                        />
                      </div>
                    </Field>
                    <Field
                      label="Security deposit"
                      hint="Enter 0 if there’s no deposit."
                    >
                      <div className="input-prefix">
                        <span>$</span>
                        <input
                          type="number"
                          required
                          min="0"
                          max="50000"
                          step="1"
                          value={draft.deposit}
                          onChange={(e) => update("deposit", e.target.value)}
                        />
                      </div>
                    </Field>
                  </div>
                  <div className="savings-field">
                    <Field
                      label="What you pay now (optional)"
                      hint="Your current monthly rent on the original lease. Students love seeing a deal, and this is what makes Handoff a win for both sides."
                    >
                      <div className="input-prefix">
                        <span>$</span>
                        <input
                          type="number"
                          min="1"
                          max="50000"
                          step="1"
                          value={draft.originalPrice}
                          onChange={(e) =>
                            update("originalPrice", e.target.value)
                          }
                          placeholder="Same as rent"
                        />
                      </div>
                    </Field>
                    {Number(draft.originalPrice) > Number(draft.price) &&
                      Number(draft.price) > 0 && (
                        <div className="savings-callout">
                          <strong>
                            Subleasers save{" "}
                            {money(
                              Number(draft.originalPrice) - Number(draft.price),
                            )}{" "}
                            a month
                          </strong>
                          <span>
                            That is{" "}
                            {Math.round(
                              ((Number(draft.originalPrice) -
                                Number(draft.price)) /
                                Number(draft.originalPrice)) *
                                100,
                            )}
                            % below your lease. Listings with savings are
                            highlighted on the map and sort to the top.
                          </span>
                        </div>
                      )}
                  </div>
                  <div className="field-row">
                    <Field label="Available from">
                      <input
                        type="date"
                        required
                        value={draft.availableFrom}
                        onChange={(e) =>
                          update("availableFrom", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="Available until">
                      <input
                        type="date"
                        required
                        min={draft.availableFrom || undefined}
                        value={draft.availableTo}
                        onChange={(e) => update("availableTo", e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Bedrooms in the home">
                      <select
                        value={draft.bedrooms}
                        onChange={(e) => update("bedrooms", e.target.value)}
                      >
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>
                            {n === 0 ? "Studio" : n}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Bathrooms in the home">
                      <select
                        value={draft.bathrooms}
                        onChange={(e) => update("bathrooms", e.target.value)}
                      >
                        {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label="Tell them about the place"
                    hint="Mention roommates, utilities, lease requirements, and what makes the space work for a student."
                  >
                    <textarea
                      required
                      minLength={40}
                      maxLength={5000}
                      rows={6}
                      value={draft.description}
                      onChange={(e) => update("description", e.target.value)}
                      placeholder="The room gets morning light and comes furnished. You’d be living with…"
                    />
                  </Field>
                  <fieldset className="amenities-field">
                    <legend>What’s included?</legend>
                    <div className="amenity-chips">
                      {AMENITIES.map((a) => {
                        const on = draft.amenities.includes(a);
                        return (
                          <label
                            key={a}
                            className={`chip amenity-chip ${on ? "is-active" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={on}
                              onChange={(e) =>
                                update(
                                  "amenities",
                                  e.target.checked
                                    ? [...draft.amenities, a]
                                    : draft.amenities.filter((v) => v !== a),
                                )
                              }
                            />
                            <Check size={14} aria-hidden="true" />
                            {a}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </div>
              )}
              {step === 2 && (
                <div className="stack">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => upload(e.target.files)}
                  />
                  <button
                    className={`photo-dropzone ${dragOver ? "is-dragover" : ""}`}
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || draft.photos.length >= 8}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                  >
                    <span className="upload-symbol">
                      <ImagePlus size={24} />
                    </span>
                    <strong>
                      {draft.photos.length >= 8
                        ? "All 8 photo spots filled"
                        : "Drag photos here, or choose files"}
                    </strong>
                    <span className="dropzone-hint">
                      JPG, PNG, or WebP. Up to 8 photos, 8 MB each.
                    </span>
                    <span className="button secondary small">
                      <Upload size={15} />
                      Choose photos
                    </span>
                  </button>
                  {(draft.photos.length > 0 || uploading) && (
                    <div className="photo-manager">
                      <div className="photo-upload-heading">
                        <strong>{draft.photos.length} of 8 photos</strong>
                        <span>The first photo is the cover.</span>
                      </div>
                      <div className="uploaded-photos">
                        {draft.photos.map((url, i) => (
                          <div key={url} className="uploaded-photo">
                            <img src={url} alt={`Listing photo ${i + 1}`} />
                            {i === 0 && <span className="cover-label">Cover</span>}
                            <div className="photo-tools">
                              <button
                                type="button"
                                className="photo-tool"
                                disabled={i === 0}
                                aria-label={`Move photo ${i + 1} earlier`}
                                onClick={() => {
                                  const p = [...draft.photos];
                                  [p[i - 1], p[i]] = [p[i], p[i - 1]];
                                  update("photos", p);
                                }}
                              >
                                <ChevronLeft size={16} />
                              </button>
                              {i > 0 && (
                                <button
                                  type="button"
                                  className="photo-tool cover-tool"
                                  aria-label={`Make photo ${i + 1} the cover`}
                                  onClick={() => {
                                    const p = draft.photos.filter(
                                      (p) => p !== url,
                                    );
                                    update("photos", [url, ...p]);
                                  }}
                                >
                                  <Star size={14} />
                                  Make cover
                                </button>
                              )}
                              <button
                                type="button"
                                className="photo-tool"
                                disabled={i === draft.photos.length - 1}
                                aria-label={`Move photo ${i + 1} later`}
                                onClick={() => {
                                  const p = [...draft.photos];
                                  [p[i + 1], p[i]] = [p[i], p[i + 1]];
                                  update("photos", p);
                                }}
                              >
                                <ChevronRight size={16} />
                              </button>
                            </div>
                            <button
                              type="button"
                              className="photo-remove"
                              aria-label={`Remove photo ${i + 1}`}
                              onClick={() =>
                                update(
                                  "photos",
                                  draft.photos.filter((p) => p !== url),
                                )
                              }
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ))}
                        {uploading &&
                          Array.from({ length: pending || 1 }).map((_, i) => (
                            <div
                              key={`pending-${i}`}
                              className="uploaded-photo is-pending"
                            >
                              <div className="skeleton" />
                            </div>
                          ))}
                      </div>
                      {uploading && (
                        <p className="upload-status" role="status">
                          Uploading your photos…
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {step === 3 && (
                <div className="review-listing">
                  <article className="listing-card compact review-card">
                    <div className="card-photo">
                      {draft.photos[0] ? (
                        <img src={draft.photos[0]} alt="" />
                      ) : (
                        <div className="photo-placeholder">
                          <ImageIcon size={18} strokeWidth={1.5} />
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="card-body">
                      <div className="card-topline">
                        <div className="card-price">
                          <strong>{money(Number(draft.price))}</strong>
                          <span>/mo</span>
                        </div>
                        <span className="pill blue">
                          {ROOM_LABELS[draft.roomType]}
                        </span>
                      </div>
                      <div className="card-title">{draft.title}</div>
                      <div className="card-address">
                        <MapPin size={13} />
                        <span>{draft.address}</span>
                      </div>
                      <div className="card-details">
                        <span>
                          <BedDouble size={13} />
                          {draft.bedrooms === "0"
                            ? "Studio"
                            : `${draft.bedrooms} bd`}
                        </span>
                        <span>
                          <Bath size={13} />
                          {draft.bathrooms} ba
                        </span>
                        <span>
                          <CalendarRange size={13} />
                          {dateLabel(draft.availableFrom)} to{" "}
                          {dateLabel(draft.availableTo)}
                        </span>
                      </div>
                    </div>
                  </article>
                  <dl className="review-facts">
                    <div>
                      <dt>Monthly rent</dt>
                      <dd>{money(Number(draft.price))}</dd>
                    </div>
                    <div>
                      <dt>Deposit</dt>
                      <dd>{money(Number(draft.deposit))}</dd>
                    </div>
                    {Number(draft.originalPrice) > 0 && (
                      <div>
                        <dt>Original lease</dt>
                        <dd>{money(Number(draft.originalPrice))} a month</dd>
                      </div>
                    )}
                    <div>
                      <dt>Available</dt>
                      <dd>
                        {dateLabel(draft.availableFrom, true)} to{" "}
                        {dateLabel(draft.availableTo, true)}
                      </dd>
                    </div>
                    <div>
                      <dt>The space</dt>
                      <dd>
                        {draft.bedrooms === "0"
                          ? "Studio"
                          : `${draft.bedrooms} bed`}{" "}
                        · {draft.bathrooms} bath
                      </dd>
                    </div>
                    <div>
                      <dt>Campus</dt>
                      <dd>{campus?.name}</dd>
                    </div>
                    <div>
                      <dt>Photos</dt>
                      <dd>
                        {draft.photos.length} uploaded
                      </dd>
                    </div>
                  </dl>
                  <div className="review-block">
                    <h3>Description</h3>
                    <p className="preserve-lines">{draft.description}</p>
                  </div>
                  {draft.amenities.length > 0 && (
                    <div className="review-block">
                      <h3>Included</h3>
                      <div className="review-amenities">
                        {draft.amenities.map((a) => (
                          <span key={a} className="pill">
                            <Check size={12} />
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="review-reminder">
                    <Check size={16} />
                    <p>
                      By publishing, you confirm that this listing is accurate
                      and that you’re allowed to offer this space for sublease.
                    </p>
                  </div>
                </div>
              )}
              {formError && <ErrorBox message={formError} />}
            </div>
          </form>
        </section>
      </div>
      <div className="editor-bar">
        <div className="editor-bar-inner">
          {step > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep((s) => s - 1);
                setFormError("");
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : (
            <Link className="button ghost" to="/my-listings">
              Cancel
            </Link>
          )}
          <div className="editor-bar-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => save("draft")}
              busy={saving}
              disabled={uploading}
            >
              <Save size={16} />
              Save draft
            </Button>
            <Button
              type="submit"
              form="listing-form"
              disabled={uploading || saving}
            >
              {step === 3 ? (
                <>
                  <Eye size={16} />
                  {id && data?.listing.status === "active"
                    ? "Save & publish"
                    : "Publish"}
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      <Modal
        open={showPublish}
        onClose={() => !saving && setShowPublish(false)}
        title="Ready to put it on the map?"
      >
        <p className="muted">
          Your listing will be visible to anyone browsing {campus?.shortName}.
          Verified students can send you a request to connect.
        </p>
        <div className="modal-actions">
          <Button
            variant="secondary"
            onClick={() => setShowPublish(false)}
            disabled={saving}
          >
            Keep reviewing
          </Button>
          <Button onClick={() => save("active")} busy={saving}>
            Publish listing
            <ArrowRight size={17} />
          </Button>
        </div>
      </Modal>
    </div>
  );
}
