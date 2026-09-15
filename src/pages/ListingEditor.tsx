import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  CalendarRange,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  House,
  Image as ImageIcon,
  ImagePlus,
  ListChecks,
  LocateFixed,
  MapPin,
  Rocket,
  Save,
  Sparkles,
  Star,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  AMENITIES,
  GENDER_PREFERENCE_LABELS,
  ROOM_LABELS,
  type Listing,
  type User,
} from "../types";
import { PreferenceChoice } from "../components/Gender";
import {
  api,
  dateLabel,
  errorMessage,
  json,
  money,
  today,
  useResource,
} from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Field, Loading } from "../components/ui";
import { MobileAccount } from "../components/AccountButton";
import { SchoolNotLive } from "../components/SchoolNotLive";
import { DateField } from "../components/DateField";
import { FIELD_STEP, takeImport } from "../lib/import";
const Map = lazy(() => import("../components/Map"));
type AddressMatch = { line: string; place: string; lat: number; lng: number };
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
  genderPreference: Listing["genderPreference"];
  availableFrom: string;
  availableTo: string;
  amenities: string[];
  photos: string[];
};
type Errors = Record<string, string>;
const STEPS = [
  {
    key: "basics",
    label: "Basics",
    note: "Title and space",
    icon: House,
    title: "Start with the basics",
    sub: "What are you offering, and how big is the place?",
  },
  {
    key: "location",
    label: "Location",
    note: "Address and pin",
    icon: MapPin,
    title: "Where is it?",
    sub: "Drop the pin on your building so students understand the area.",
  },
  {
    key: "terms",
    label: "Dates and price",
    note: "When and how much",
    icon: Wallet,
    title: "Dates and price",
    sub: "Set expectations clearly, so the next conversation is easy.",
  },
  {
    key: "details",
    label: "Amenities",
    note: "What is included",
    icon: ListChecks,
    title: "Amenities and details",
    sub: "Tell them what comes with the place.",
  },
  {
    key: "photos",
    label: "Photos",
    note: "Show the space",
    icon: Camera,
    title: "Give them a look around",
    sub: "Bright, recent photos of the actual space work best.",
  },
  {
    key: "review",
    label: "Review",
    note: "Publish when ready",
    icon: ClipboardCheck,
    title: "Review and publish",
    sub: "One last look before students can find it.",
  },
] as const;
const LAST = STEPS.length - 1;
export default function ListingEditor() {
  const { id } = useParams(),
    { user, setUser, campuses, notify } = useApp(),
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
      genderPreference: "any",
      availableFrom: "",
      availableTo: "",
      amenities: [],
      photos: [],
    }),
    [step, setStep] = useState(0),
    [reached, setReached] = useState(0),
    [dir, setDir] = useState<"fwd" | "back">("fwd"),
    [pinPlaced, setPinPlaced] = useState(false),
    [pinSource, setPinSource] = useState<"" | "auto" | "manual">(""),
    [locating, setLocating] = useState(false),
    [matches, setMatches] = useState<AddressMatch[]>([]),
    [lookupNote, setLookupNote] = useState(""),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false),
    [pending, setPending] = useState(0),
    [dragOver, setDragOver] = useState(false),
    [agreed, setAgreed] = useState(false),
    [published, setPublished] = useState(false),
    [errors, setErrors] = useState<Errors>({}),
    [imported, setImported] = useState<string[]>([]),
    [bannerOpen, setBannerOpen] = useState(false),
    [formError, setFormError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null),
    bodyRef = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const termsAccepted = Boolean(user?.termsAccepted);
  const addressWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!matches.length) return;
    const away = (e: PointerEvent) => {
      if (!addressWrap.current?.contains(e.target as Node)) setMatches([]);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMatches([]);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [matches.length]);
  const placedRef = useRef(false);
  placedRef.current = pinPlaced;
  const lookedUp = useRef(""),
    lookupPromise = useRef<Promise<void> | null>(null);
  /** Put the pin where the typed address is. Listers confirm or drag it. */
  function locate(force = false) {
    const q = draft.address.trim();
    if (q.length < 5) return;
    if (!force && (pinSource === "manual" || lookedUp.current === q)) return;
    lookedUp.current = q;
    setLocating(true);
    setLookupNote("");
    setMatches([]);
    const run = (async () => {
      try {
        const { results } = await api<{ results: AddressMatch[] }>(
          `/geocode?q=${encodeURIComponent(q)}&campusId=${encodeURIComponent(campus?.id || "")}`,
        );
        if (lookedUp.current !== q) return;
        if (!results.length) {
          setLookupNote("We could not find that address. Tap the map to place the pin.");
          return;
        }
        const [best] = results;
        setDraft((d) => ({ ...d, lat: best.lat, lng: best.lng }));
        placedRef.current = true;
        setPinPlaced(true);
        setPinSource("auto");
        setDirty(true);
        setErrors((e) => ({ ...e, pin: "" }));
        setMatches(results.length > 1 ? results : []);
      } catch (e) {
        setLookupNote(errorMessage(e));
      } finally {
        if (lookedUp.current === q) setLocating(false);
      }
    })();
    lookupPromise.current = run;
    return run;
  }
  // Look the address up once typing pauses, so the pin lands without a
  // blur or Enter. Manual pins are never overridden.
  useEffect(() => {
    if (step !== 1 || pinSource === "manual") return;
    const q = draft.address.trim();
    if (q.length < 5 || lookedUp.current === q) return;
    const t = setTimeout(() => locate(), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.address, step, pinSource]);
  function choose(m: AddressMatch) {
    setDraft((d) => ({ ...d, address: `${m.line}, ${m.place}`, lat: m.lat, lng: m.lng }));
    lookedUp.current = `${m.line}, ${m.place}`;
    setPinPlaced(true);
    setPinSource("auto");
    setMatches([]);
    setDirty(true);
  }
  // Error shake, transitions.dev 12-error-state-shake.
  function shake() {
    const el = bodyRef.current;
    if (!el) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
  }
  /** Field messages carry the detail, so the summary box is only for the rest. */
  function fail(message: string, fields: Errors = {}) {
    setFormError(Object.keys(fields).length ? "" : message);
    setErrors(fields);
    shake();
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
        genderPreference: l.genderPreference,
        availableFrom: l.availableFrom,
        availableTo: l.availableTo,
        amenities: l.amenities,
        photos: l.photos,
      });
      setPinPlaced(true);
      setPinSource("manual");
      lookedUp.current = l.address.trim();
      setDirty(false);
    }
  }, [data]);
  // Smart import and the chat helper hand the draft over in sessionStorage.
  // It is read once, on the way in, and the gaps are marked for the lister.
  const [params] = useSearchParams();
  useEffect(() => {
    if (id || params.get("from") !== "import") return;
    const stored = takeImport();
    if (!stored) return;
    const d = stored.draft;
    const text = (value: unknown) => (value == null ? "" : String(value));
    setDraft((current) => ({
      ...current,
      title: text(d.title) || current.title,
      description: text(d.description) || current.description,
      address: text(d.address) || current.address,
      lat: typeof d.lat === "number" ? d.lat : current.lat,
      lng: typeof d.lng === "number" ? d.lng : current.lng,
      price: text(d.price),
      deposit: text(d.deposit),
      originalPrice: text(d.originalPrice),
      bedrooms: d.bedrooms == null ? current.bedrooms : String(d.bedrooms),
      bathrooms: d.bathrooms == null ? current.bathrooms : String(d.bathrooms),
      roomType: d.roomType || current.roomType,
      availableFrom: text(d.availableFrom),
      availableTo: text(d.availableTo),
      amenities: Array.isArray(d.amenities) ? d.amenities : current.amenities,
    }));
    if (typeof d.lat === "number" && typeof d.lng === "number") {
      setPinPlaced(true);
      placedRef.current = true;
      setPinSource("auto");
      lookedUp.current = text(d.address).trim();
    }
    setImported(stored.missing);
    setBannerOpen(stored.missing.length > 0);
    setDirty(true);
    // Read once on the way in, so a refresh does not import it twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setFormError("");
    setErrors((e) => (e[key as string] ? { ...e, [key]: "" } : e));
  }
  /** Field level messages for one step. An empty object means the step is good. */
  function checkStep(part: number): Errors {
    const found: Errors = {};
    const price = Number(draft.price),
      deposit = Number(draft.deposit),
      original = Number(draft.originalPrice);
    if (part === 0 && draft.title.trim().length < 8)
      found.title = "Give your listing a clear title of at least 8 characters.";
    if (part === 1) {
      if (draft.address.trim().length < 5)
        found.address = "Add the street address or building name.";
      if (!placedRef.current)
        found.pin = "Place a pin on the map so students can find the area.";
      else if (
        !Number.isFinite(draft.lat) ||
        !Number.isFinite(draft.lng) ||
        Math.abs(draft.lat) > 90 ||
        Math.abs(draft.lng) > 180
      )
        found.pin = "Those coordinates are outside the map. Pick the spot again.";
    }
    if (part === 2) {
      if (!draft.price || price < 1 || price > 20000)
        found.price = "Enter a monthly rent between $1 and $20,000.";
      if (deposit < 0 || deposit > 50000)
        found.deposit = "Enter a deposit between $0 and $50,000.";
      if (draft.originalPrice && (original < 1 || original > 50000))
        found.originalPrice =
          "Enter what you pay now, between $1 and $50,000, or leave it blank.";
      if (!draft.availableFrom) found.availableFrom = "Pick a move-in date.";
      if (!draft.availableTo || draft.availableTo <= draft.availableFrom)
        found.availableTo = "Pick a move-out date after the move-in date.";
      else if (draft.availableTo < today())
        found.availableTo = "Choose an availability end date that has not passed.";
    }
    if (part === 3 && draft.description.trim().length < 40)
      found.description =
        "Write at least 40 characters about the place, roommates, and lease details.";
    if (part === 4 && !draft.photos.length)
      found.photos = "Add at least one photo before publishing.";
    return found;
  }
  const firstMessage = (found: Errors) => Object.values(found)[0] || "";
  function goTo(target: number) {
    if (target === step) return;
    if (target > step) {
      for (let i = step; i < target; i++) {
        const found = checkStep(i);
        if (Object.keys(found).length) {
          setStep(i);
          fail(firstMessage(found), found);
          return;
        }
      }
    }
    setErrors({});
    setFormError("");
    setDir(target > step ? "fwd" : "back");
    setStep(target);
    setReached((r) => Math.max(r, target));
    // Desktop scrolls the step body, the phone flow scrolls the page.
    bodyRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }
  async function next(e: FormEvent) {
    e.preventDefault();
    if (step === LAST) {
      publish();
      return;
    }
    if (step === 1 && !pinPlaced) {
      // Blur already started the lookup, give it a moment to land the pin.
      await (locate() || lookupPromise.current);
    }
    const found = checkStep(step);
    if (Object.keys(found).length) {
      fail(firstMessage(found), found);
      return;
    }
    goTo(step + 1);
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setFormError("");
    if (files.length + draft.photos.length > 8)
      return fail("Choose up to 8 photos in total.");
    if (Array.from(files).some((f) => f.size > 8 * 1024 * 1024))
      return fail("Each photo needs to be under 8 MB.");
    if (
      Array.from(files).some(
        (f) => !["image/jpeg", "image/png", "image/webp"].includes(f.type),
      )
    )
      return fail("Use JPG, PNG, or WebP photos.");
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
      setErrors((e) => ({ ...e, photos: "" }));
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
    setSaving(true);
    try {
      const payload = {
        ...draft,
        // Entire places are open to anyone. The server enforces this too.
        genderPreference:
          draft.roomType === "entire" ? "any" : draft.genderPreference,
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
      if (status === "draft") {
        notify("Draft saved. Pick it up from My listings.");
        navigate("/my-listings");
        return;
      }
      // Success check, transitions.dev 10-success-check, then hand over.
      setPublished(true);
      notify("Your listing is live.");
      timer.current = setTimeout(
        () => navigate(`/listings/${result.listing.id}`),
        1100,
      );
    } catch (e) {
      fail(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  async function publish() {
    setFormError("");
    for (let i = 0; i < LAST; i++) {
      const found = checkStep(i);
      if (Object.keys(found).length) {
        setStep(i);
        fail(firstMessage(found), found);
        return;
      }
    }
    if (!termsAccepted && !agreed) {
      fail("Please agree to the Terms of Service and Privacy Policy first.", {
        terms: "Tick the box to continue.",
      });
      return;
    }
    if (!termsAccepted) {
      setSaving(true);
      try {
        const result = await api<{ user: User }>("/auth/accept-terms", {
          method: "POST",
        });
        setUser(result.user);
      } catch (e) {
        setSaving(false);
        fail(errorMessage(e));
        return;
      }
      setSaving(false);
    }
    await save("active");
  }
  // Handoff has not opened at this student's school, so the wizard never
  // loads for them. They keep browsing, saving and requesting everywhere else.
  if (user && !user.campusId)
    return (
      <div className="page-container narrow">
        <SchoolNotLive />
      </div>
    );
  if (loading) return <Loading label="Loading your listing…" />;
  if (error)
    return (
      <div className="page-container narrow">
        <Link to="/my-listings" className="back-link">
          <ArrowLeft size={16} />
          My listings
        </Link>
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
  const current = STEPS[step];
  /** A field the import left empty, cleared as soon as the lister fills it. */
  const fieldFilled = (key: string) => {
    if (key === "photos") return draft.photos.length > 0;
    const value = (draft as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.length > 0;
    return String(value ?? "").trim() !== "";
  };
  const stillMissing = imported.filter((key) => !fieldFilled(key));
  const miss = (key: string) => stillMissing.includes(key);
  const flag = (key: string) => (miss(key) ? " is-missing" : "");
  const addHint = (key: string) =>
    miss(key) ? (
      <span className="field-add">
        <Sparkles size={12} aria-hidden="true" />
        Add this
      </span>
    ) : null;
  const stepHasMissing = (index: number) =>
    stillMissing.some((key) => FIELD_STEP[key] === index);
  const savingsAmount =
    Number(draft.originalPrice) > Number(draft.price) && Number(draft.price) > 0
      ? Number(draft.originalPrice) - Number(draft.price)
      : 0;
  return (
    <div className="editor-shell">
      <aside className="editor-rail">
        <div className="rail-head">
          <Link to="/my-listings" className="rail-back">
            <ArrowLeft size={15} />
            My listings
          </Link>
          <h1>{id ? "Edit listing" : "List your place"}</h1>
          <span className={`pill ${live ? "green" : "blue"}`}>
            {live ? "Live" : "Draft"}
          </span>
        </div>
        <ol className="step-rail">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            return (
              <li
                key={s.key}
                className={`step-item ${i === step ? "is-current" : ""} ${done ? "is-done" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  disabled={i > reached && i > step}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className="step-dot">
                    {done ? (
                      <span
                        className="t-success-check step-check"
                        data-state="in"
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12.5 10 17.5 19 7" />
                        </svg>
                      </span>
                    ) : (
                      <Icon size={14} strokeWidth={2} aria-hidden="true" />
                    )}
                    {stepHasMissing(i) && (
                      <span className="missing-dot" aria-hidden="true" />
                    )}
                  </span>
                  <span className="step-text">
                    <strong>
                      <em>{i + 1}.</em> {s.label}
                    </strong>
                    <small>{s.note}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="draft-note">
          {dirty
            ? "You have unsaved changes."
            : "Your draft stays private until you publish."}
          <Button
            type="button"
            variant="secondary"
            className="rail-save"
            onClick={() => save("draft")}
            busy={saving && step !== LAST}
            disabled={uploading || saving}
          >
            <Save size={15} />
            Save and exit
          </Button>
        </p>
      </aside>
      <section className="editor-main">
        <form
          id="listing-form"
          noValidate
          onSubmit={next}
          className="editor-form"
        >
          <header className="editor-head">
            <MobileAccount className="editor-account" />
            <div className="head-text">
              <span className="step-count">
                Step {step + 1} of {STEPS.length}
              </span>
              <h2>{current.title}</h2>
              <p>{current.sub}</p>
            </div>
          </header>
          <div className="mobile-progress" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`${i === step ? "is-current" : ""} ${i < step ? "is-done" : ""} ${stepHasMissing(i) ? "has-missing" : ""}`}
              />
            ))}
          </div>
          {bannerOpen && (
            <div className="import-banner" role="status">
              <Sparkles size={16} aria-hidden="true" />
              <p>
                Imported. Check the highlighted fields.{" "}
                {stillMissing.length
                  ? `${stillMissing.length} still to add.`
                  : "Everything is filled in."}
              </p>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss the import note"
                onClick={() => setBannerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div
            className="editor-body"
            data-dir={dir}
            ref={bodyRef}
            onAnimationEnd={() =>
              bodyRef.current?.classList.remove("is-shaking")
            }
          >
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className="t-page"
                data-pos={i === step ? "current" : i < step ? "before" : "after"}
                aria-hidden={i !== step}
                inert={i !== step ? true : undefined}
              >
                <div className="step-inner">
                  {i === 0 && (
                    <div className="stack">
                      <Field
                        label="Listing title"
                        hint="Name a feature, a neighborhood, or the building."
                        error={errors.title}
                        className={`${errors.title ? "is-error" : ""}${flag("title")}`}
                      >
                        <input
                          required
                          minLength={8}
                          maxLength={100}
                          value={draft.title}
                          onChange={(e) => update("title", e.target.value)}
                          placeholder="Sunny private room near campus"
                        />
                        {addHint("title")}
                      </Field>
                      <fieldset className="room-type-field">
                        <legend>
                          <House size={14} aria-hidden="true" />
                          What are you offering?
                        </legend>
                        <div className="room-options">
                          {Object.entries(ROOM_LABELS).map(([value, label]) => (
                            <label
                              key={value}
                              className={
                                draft.roomType === value ? "selected" : ""
                              }
                            >
                              <input
                                type="radio"
                                name="roomType"
                                value={value}
                                checked={draft.roomType === value}
                                onChange={() =>
                                  update(
                                    "roomType",
                                    value as Listing["roomType"],
                                  )
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
                      <PreferenceChoice
                        roomType={draft.roomType}
                        value={draft.genderPreference}
                        onChange={(value) =>
                          update("genderPreference", value)
                        }
                      />
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
                            onChange={(e) =>
                              update("bathrooms", e.target.value)
                            }
                          >
                            {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    </div>
                  )}
                  {i === 1 && (
                    <div className="stack">
                      <div className="address-wrap" ref={addressWrap}>
                      <Field
                        label="Street address or building"
                        hint="Shown on your listing, so leave out your unit number."
                        error={errors.address}
                        className={`${errors.address ? "is-error" : ""}${flag("address")}`}
                      >
                        <input
                          required
                          minLength={5}
                          maxLength={200}
                          autoComplete="street-address"
                          value={draft.address}
                          onChange={(e) => {
                            update("address", e.target.value);
                            setMatches([]);
                            setLookupNote("");
                            if (pinSource === "auto") setPinSource("");
                          }}
                          onBlur={() => locate()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              locate(true);
                            }
                          }}
                          placeholder="123 West 30th Street, Los Angeles"
                        />
                        {addHint("address")}
                      </Field>
                      {matches.length > 1 && (
                        <div
                          className="address-matches t-dropdown is-open"
                          role="group"
                          aria-label="Did you mean"
                        >
                          <span className="matches-title">Did you mean</span>
                          {matches.slice(0, 4).map((m) => (
                            <button
                              type="button"
                              key={`${m.lat},${m.lng}`}
                              className={
                                m.lat === draft.lat && m.lng === draft.lng ? "is-on" : ""
                              }
                              onClick={() => choose(m)}
                            >
                              <MapPin size={14} aria-hidden="true" />
                              <span>
                                <strong>{m.line}</strong>
                                <small>{m.place}</small>
                              </span>
                              {m.lat === draft.lat && m.lng === draft.lng && (
                                <Check size={14} aria-hidden="true" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      </div>
                      <div className="field map-field">
                        <div className="field-label">
                          <MapPin size={14} aria-hidden="true" />
                          Put it on the map
                        </div>
                        {campus && reached >= 1 && (
                          <div className="editor-map">
                            <Suspense
                              fallback={<Loading label="Loading map…" />}
                            >
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
                                  setPinSource("manual");
                                  setMatches([]);
                                  setLookupNote("");
                                  setDirty(true);
                                  setFormError("");
                                  setErrors((e) => ({ ...e, pin: "" }));
                                }}
                              />
                            </Suspense>
                          </div>
                        )}
                        <div className="map-foot">
                          <span
                            className={`pin-status ${locating ? "busy" : pinPlaced ? (pinSource === "auto" ? "check" : "placed") : ""}`}
                            aria-live="polite"
                          >
                            {locating ? (
                              <LocateFixed size={13} className="spin" />
                            ) : (
                              <MapPin size={13} />
                            )}
                            {locating
                              ? "Finding it on the map…"
                              : lookupNote
                                ? lookupNote
                                : pinPlaced
                                  ? pinSource === "auto"
                                    ? "Pin placed from your address. Check it and drag to adjust."
                                    : "Location pin placed"
                                  : "Type the address and we will place the pin, or tap the map."}
                          </span>
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
                                    setPinSource("manual");
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
                                    setPinSource("manual");
                                  }}
                                />
                              </Field>
                            </div>
                          </details>
                        </div>
                        {errors.pin && (
                          <span className="field-error">{errors.pin}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {i === 2 && (
                    <div className="stack">
                      <div className="field-row">
                        <div
                          className={`field ${errors.availableFrom ? "is-error" : ""}${flag("availableFrom")}`}
                        >
                          <label
                            className="field-label"
                            htmlFor="available-from"
                          >
                            Available from
                          </label>
                          <DateField
                            id="available-from"
                            name="availableFrom"
                            label="Available from"
                            required
                            placeholder="Pick a start date"
                            value={draft.availableFrom}
                            onChange={(v) => update("availableFrom", v)}
                          />
                          {errors.availableFrom && (
                            <span className="field-error">
                              {errors.availableFrom}
                            </span>
                          )}
                          {addHint("availableFrom")}
                        </div>
                        <div
                          className={`field ${errors.availableTo ? "is-error" : ""}${flag("availableTo")}`}
                        >
                          <label
                            className="field-label"
                            htmlFor="available-until"
                          >
                            Available until
                          </label>
                          <DateField
                            id="available-until"
                            name="availableTo"
                            label="Available until"
                            required
                            placeholder="Pick an end date"
                            min={draft.availableFrom || undefined}
                            value={draft.availableTo}
                            onChange={(v) => update("availableTo", v)}
                          />
                          {errors.availableTo && (
                            <span className="field-error">
                              {errors.availableTo}
                            </span>
                          )}
                          {addHint("availableTo")}
                        </div>
                      </div>
                      <div className="field-row">
                        <Field
                          label="Monthly rent"
                          error={errors.price}
                          className={`${errors.price ? "is-error" : ""}${flag("price")}`}
                        >
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
                          {addHint("price")}
                        </Field>
                        <Field
                          label="Security deposit"
                          hint="Enter 0 if there is no deposit."
                          error={errors.deposit}
                          className={`${errors.deposit ? "is-error" : ""}${flag("deposit")}`}
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
                              onChange={(e) =>
                                update("deposit", e.target.value)
                              }
                            />
                          </div>
                          {addHint("deposit")}
                        </Field>
                      </div>
                      <div className="savings-field">
                        <Field
                          label="What you pay now (optional)"
                          hint="Your rent on the original lease, shown as the savings."
                          error={errors.originalPrice}
                          className={errors.originalPrice ? "is-error" : ""}
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
                        {savingsAmount > 0 && (
                          <div className="savings-callout">
                            <strong>
                              <Sparkles size={15} aria-hidden="true" />
                              Subleasers save {money(savingsAmount)} a month
                            </strong>
                            <span>
                              That is{" "}
                              {Math.round(
                                (savingsAmount / Number(draft.originalPrice)) *
                                  100,
                              )}
                              % below your lease. Listings with savings are
                              highlighted on the map and sort to the top.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {i === 3 && (
                    <div className="stack">
                      <fieldset className="amenities-field">
                        <legend>
                          <ListChecks size={14} aria-hidden="true" />
                          What is included?
                        </legend>
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
                                        : draft.amenities.filter(
                                            (v) => v !== a,
                                          ),
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
                      <Field
                        label="Tell them about the place"
                        hint="Roommates, utilities, and lease requirements."
                        error={errors.description}
                        className={`${errors.description ? "is-error" : ""}${flag("description")}`}
                      >
                        <textarea
                          required
                          minLength={40}
                          maxLength={5000}
                          rows={5}
                          value={draft.description}
                          onChange={(e) =>
                            update("description", e.target.value)
                          }
                          placeholder="The room gets morning light and comes furnished. You would be living with…"
                        />
                        {addHint("description")}
                      </Field>
                    </div>
                  )}
                  {i === 4 && (
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
                          <ImagePlus size={22} />
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
                      {addHint("photos")}
                      {errors.photos && (
                        <span className="field-error">{errors.photos}</span>
                      )}
                      {(draft.photos.length > 0 || uploading) && (
                        <div className="photo-manager">
                          <div className="photo-upload-heading">
                            <strong>{draft.photos.length} of 8 photos</strong>
                            <span>The first photo is the cover.</span>
                          </div>
                          <div className="uploaded-photos">
                            {draft.photos.map((url, index) => (
                              <div key={url} className="uploaded-photo">
                                <img
                                  src={url}
                                  alt={`Listing photo ${index + 1}`}
                                />
                                {index === 0 && (
                                  <span className="cover-label">Cover</span>
                                )}
                                <div className="photo-tools">
                                  <button
                                    type="button"
                                    className="photo-tool"
                                    disabled={index === 0}
                                    aria-label={`Move photo ${index + 1} earlier`}
                                    onClick={() => {
                                      const p = [...draft.photos];
                                      [p[index - 1], p[index]] = [
                                        p[index],
                                        p[index - 1],
                                      ];
                                      update("photos", p);
                                    }}
                                  >
                                    <ChevronLeft size={16} />
                                  </button>
                                  {index > 0 && (
                                    <button
                                      type="button"
                                      className="photo-tool cover-tool"
                                      aria-label={`Make photo ${index + 1} the cover`}
                                      onClick={() =>
                                        update("photos", [
                                          url,
                                          ...draft.photos.filter(
                                            (p) => p !== url,
                                          ),
                                        ])
                                      }
                                    >
                                      <Star size={14} />
                                      Make cover
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="photo-tool"
                                    disabled={index === draft.photos.length - 1}
                                    aria-label={`Move photo ${index + 1} later`}
                                    onClick={() => {
                                      const p = [...draft.photos];
                                      [p[index + 1], p[index]] = [
                                        p[index],
                                        p[index + 1],
                                      ];
                                      update("photos", p);
                                    }}
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  className="photo-remove"
                                  aria-label={`Remove photo ${index + 1}`}
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
                              Array.from({ length: pending || 1 }).map(
                                (_, index) => (
                                  <div
                                    key={`pending-${index}`}
                                    className="uploaded-photo is-pending"
                                  >
                                    <div className="skeleton" />
                                  </div>
                                ),
                              )}
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
                  {i === 5 && (
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
                              {draft.availableFrom
                                ? `${dateLabel(draft.availableFrom)} to ${dateLabel(draft.availableTo)}`
                                : "Dates to come"}
                            </span>
                          </div>
                        </div>
                      </article>
                      <dl className="review-facts">
                        <div>
                          <dt>Deposit</dt>
                          <dd>{money(Number(draft.deposit))}</dd>
                        </div>
                        <div>
                          <dt>Savings</dt>
                          <dd>
                            {savingsAmount > 0
                              ? `${money(savingsAmount)} a month`
                              : "Not shared"}
                          </dd>
                        </div>
                        <div>
                          <dt>Roommates</dt>
                          <dd>
                            {
                              GENDER_PREFERENCE_LABELS[
                                draft.roomType === "entire"
                                  ? "any"
                                  : draft.genderPreference
                              ]
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>Amenities</dt>
                          <dd>{draft.amenities.length || "None"} listed</dd>
                        </div>
                        <div>
                          <dt>Photos</dt>
                          <dd>{draft.photos.length} uploaded</dd>
                        </div>
                      </dl>
                      <div className="review-block">
                        <h3>Description</h3>
                        <p className="preserve-lines">{draft.description}</p>
                      </div>
                      <div
                        className={`terms-box ${errors.terms ? "is-error" : ""}`}
                      >
                        {termsAccepted ? (
                          <p className="terms-done">
                            <Check size={15} aria-hidden="true" />
                            Terms accepted
                          </p>
                        ) : (
                          <>
                            <label className="terms-check">
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={agreed}
                                onChange={(e) => {
                                  setAgreed(e.target.checked);
                                  setErrors((x) => ({ ...x, terms: "" }));
                                  setFormError("");
                                }}
                              />
                              <span className="t-checkbox" aria-hidden="true">
                                <svg
                                  viewBox="0 0 24 24"
                                  width="14"
                                  height="14"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M5 12.5 10 17.5 19 7" />
                                </svg>
                              </span>
                              <span>
                                I agree to the{" "}
                                <a
                                  href="/terms"
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Terms of Service
                                </a>{" "}
                                and{" "}
                                <a
                                  href="/privacy"
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Privacy Policy
                                </a>
                                .
                              </span>
                            </label>
                            {errors.terms && (
                              <span className="field-error">
                                {errors.terms}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {formError && step === i && (
                    <ErrorBox message={formError} />
                  )}
                </div>
              </div>
            ))}
          </div>
          <footer className="editor-foot">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => goTo(step - 1)}
                disabled={saving}
              >
                <ArrowLeft size={16} />
                Back
              </Button>
            ) : (
              <Link className="button ghost" to="/my-listings">
                Cancel
              </Link>
            )}
            <div className="foot-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => save("draft")}
                busy={saving && step !== LAST}
                disabled={uploading || saving}
              >
                <Save size={16} />
                Save draft
              </Button>
              <Button type="submit" disabled={uploading} busy={saving}>
                {step === LAST ? (
                  <>
                    <Rocket size={16} />
                    {live ? "Save and publish" : "Publish"}
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          </footer>
        </form>
        {published && (
          <div className="editor-success" role="status">
            <span className="t-success-check" data-state="in" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="46"
                height="46"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5 10 17.5 19 7" />
              </svg>
            </span>
            <strong>Your listing is live</strong>
            <span>Taking you to it now.</span>
            <span className="editor-success-boost">
              Boost it there to sit at the top for seven days.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
