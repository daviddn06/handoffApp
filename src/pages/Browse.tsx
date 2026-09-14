import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  X,
  Plus,
  GraduationCap,
  CalendarDays,
  BedDouble,
  Check,
  LogIn,
  Crosshair,
  ArrowRight,
} from "lucide-react";
import { useApp } from "../lib/context";
import { useResource, money } from "../lib/api";
import { AMENITIES, ROOM_LABELS, type Listing } from "../types";
import { Button, EmptyState, ErrorBox, Loading, Modal } from "../components/ui";
import { ListingCard } from "../components/ListingCard";
import { Popover } from "../components/Popover";
import { inBounds, type MapBounds } from "../lib/dps";
import { CampusPicker } from "../components/CampusPicker";
import { isEmbed } from "../components/Layout";
const Map = lazy(() => import("../components/Map"));

const filterKeys = [
  "minPrice",
  "maxPrice",
  "from",
  "to",
  "roomType",
  "bedrooms",
  "amenities",
] as const;
const PRICE_PRESETS = [
  { label: "Under $1,000", min: "", max: "1000" },
  { label: "$1,000 to $1,500", min: "1000", max: "1500" },
  { label: "$1,500 to $2,200", min: "1500", max: "2200" },
  { label: "$2,200 and up", min: "2200", max: "" },
];
const PANEL_KEY = "handoff:panel-width";
const CAMPUS_KEY = "handoff:campus";
function readCampus() {
  try {
    return localStorage.getItem(CAMPUS_KEY) || "";
  } catch {
    return "";
  }
}
function rememberCampus(id: string) {
  try {
    localStorage.setItem(CAMPUS_KEY, id);
  } catch {
    /* ignore */
  }
}
const PANEL_MIN = 360;
const PANEL_DEFAULT = 440;

function shortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function readPanelWidth() {
  try {
    const stored = Number(localStorage.getItem(PANEL_KEY));
    if (stored >= PANEL_MIN) return stored;
  } catch {
    /* Private mode or storage blocked. */
  }
  return PANEL_DEFAULT;
}

export default function Browse() {
  const { campuses, user } = useApp(),
    navigate = useNavigate(),
    [params, setParams] = useSearchParams();
  const remembered = readCampus();
  const campus =
    campuses.find(
      (c) =>
        c.id ===
        (params.get("campusId") || user?.campusId || remembered || "usc"),
    ) || campuses[0];
  // First visit without an account or a remembered campus asks where to look.
  const [pickCampus, setPickCampus] = useState(() => {
    if (user || isEmbed()) return false;
    try {
      if (sessionStorage.getItem("handoff:campus-picked")) return false;
    } catch {
      /* ignore */
    }
    return true;
  });
  const chooseCampus = (id: string) => {
    rememberCampus(id);
    try {
      sessionStorage.setItem("handoff:campus-picked", "1");
    } catch {
      /* ignore */
    }
    setParam("campusId", id);
    setPickCampus(false);
  };
  // Mobile bottom sheet. The listing panel slides over a full screen map and
  // snaps to three heights, a peek with search, half, and full.
  const [sheet, setSheet] = useState<"peek" | "half" | "full">("half");
  const [sheetY, setSheetY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const snapFor = useCallback((name: "peek" | "half" | "full") => {
    const h = pageRef.current?.clientHeight || window.innerHeight;
    return name === "full" ? 0 : name === "half" ? Math.round(h * 0.5) : h - 132;
  }, []);
  const startSheetDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (window.innerWidth > 760) return;
    const scroller = scrollRef.current;
    const fromScroll = (e.target as HTMLElement).closest(".panel-scroll");
    // Inside the list only a downward drag from the very top moves the sheet.
    if (fromScroll && sheet === "full" && (scroller?.scrollTop || 0) > 0) return;
    const startY = e.clientY,
      startOffset = snapFor(sheet),
      startTime = performance.now();
    let last = startY,
      lastTime = startTime,
      moved = false;
    const h = pageRef.current?.clientHeight || window.innerHeight;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 6) return;
      if (fromScroll && !moved && dy < 0) {
        stop();
        return;
      }
      moved = true;
      setDragging(true);
      setSheetY(Math.max(0, Math.min(h - 96, startOffset + dy)));
      last = ev.clientY;
      lastTime = performance.now();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (!moved) return;
      const dt = Math.max(1, performance.now() - lastTime);
      const velocity = (last - startY) / Math.max(1, performance.now() - startTime);
      const current = Math.max(0, Math.min(h - 96, startOffset + (last - startY)));
      const snaps: Array<["peek" | "half" | "full", number]> = [
        ["full", snapFor("full")],
        ["half", snapFor("half")],
        ["peek", snapFor("peek")],
      ];
      let next: "peek" | "half" | "full";
      if (Math.abs(velocity) > 0.45 && dt < 120) {
        // A flick moves one step in the flick direction.
        const order: Array<"full" | "half" | "peek"> = ["full", "half", "peek"];
        const i = order.indexOf(sheet);
        next = order[Math.max(0, Math.min(2, i + (velocity > 0 ? 1 : -1)))];
      } else {
        next = snaps.reduce((best, s) =>
          Math.abs(s[1] - current) < Math.abs(best[1] - current) ? s : best,
        )[0];
      }
      setDragging(false);
      setSheetY(null);
      setSheet(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const [search, setSearch] = useState(params.get("query") || "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inViewOnly, setInViewOnly] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const [resizing, setResizing] = useState(false);
  const cardRefs = useRef<globalThis.Map<string, HTMLElement>>(
    new globalThis.Map(),
  );
  const activeSource = useRef<"list" | "map">("list");

  // Only known filters reach the API. Marketing or tracking params are ignored.
  const query = new URLSearchParams();
  for (const key of [...filterKeys, "query", "sort"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  query.set("campusId", campus?.id || "usc");
  const { data, loading, error, refresh } = useResource<{
    listings: Listing[];
  }>(`/listings?${query}`);

  useEffect(() => setSearch(params.get("query") || ""), [params]);

  // Debounced search so typing filters without a submit.
  useEffect(() => {
    const current = params.get("query") || "";
    if (search.trim() === current) return;
    const t = window.setTimeout(() => setParam("query", search.trim()), 320);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const navigateListing = useCallback(
    (id: string) => navigate(`/listings/${id}`),
    [navigate],
  );
  const handleMapActive = useCallback((id: string | null) => {
    activeSource.current = "map";
    setActiveId(id);
    // On a phone a tapped pin shows its card above the peeking sheet.
    if (id && window.innerWidth <= 760) setSheet("peek");
  }, []);
  const handleListActive = useCallback((id: string | null) => {
    activeSource.current = "list";
    setActiveId(id);
  }, []);
  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);
  useEffect(() => {
    if (!activeId || activeSource.current !== "map") return;
    const card = cardRefs.current.get(activeId),
      scroller = scrollRef.current;
    if (!card || !scroller) return;
    // Center the card in the list so the highlight is never clipped.
    const cardRect = card.getBoundingClientRect(),
      box = scroller.getBoundingClientRect();
    const target =
      scroller.scrollTop +
      (cardRect.top - box.top) -
      (box.height - cardRect.height) / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeId]);

  // Sidebar resizing. Width is clamped and remembered per browser.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX,
      startWidth = panelWidth;
    const max = Math.min(820, Math.round(window.innerWidth * 0.6));
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const next = Math.max(
        PANEL_MIN,
        Math.min(max, startWidth + ev.clientX - startX),
      );
      setPanelWidth(next);
    };
    const stop = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setPanelWidth((w) => {
        try {
          localStorage.setItem(PANEL_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const resetResize = () => {
    setPanelWidth(PANEL_DEFAULT);
    try {
      localStorage.removeItem(PANEL_KEY);
    } catch {
      /* ignore */
    }
  };

  const filterCount = filterKeys.filter((key) => params.has(key)).length;
  function setParam(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  function setMany(entries: Record<string, string>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(entries)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }
  function clearFilters() {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        [...filterKeys, "query"].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true },
    );
    setSearch("");
  }

  const listings = data?.listings || [];
  const visible = useMemo(() => {
    if (!inViewOnly || !bounds) return listings;
    return listings.filter((l) => inBounds(bounds, l.lat, l.lng));
  }, [listings, inViewOnly, bounds]);
  const inViewCount = useMemo(
    () =>
      bounds
        ? listings.filter((l) => inBounds(bounds, l.lat, l.lng)).length
        : listings.length,
    [listings, bounds],
  );

  // Chip labels reflect the active value.
  const minPrice = params.get("minPrice") || "",
    maxPrice = params.get("maxPrice") || "",
    from = params.get("from") || "",
    to = params.get("to") || "",
    roomType = params.get("roomType") || "",
    bedrooms = params.get("bedrooms") || "",
    amenities = (params.get("amenities") || "").split(",").filter(Boolean);
  const priceLabel =
    minPrice && maxPrice
      ? `${money(+minPrice)} to ${money(+maxPrice)}`
      : minPrice
        ? `${money(+minPrice)}+`
        : maxPrice
          ? `Under ${money(+maxPrice)}`
          : "Price";
  const dateLabelText =
    from && to
      ? `${shortDate(from)} to ${shortDate(to)}`
      : from
        ? `From ${shortDate(from)}`
        : to
          ? `Until ${shortDate(to)}`
          : "Dates";
  const roomsLabel = [
    bedrooms ? (bedrooms === "0" ? "Studio+" : `${bedrooms}+ bd`) : "",
    roomType ? ROOM_LABELS[roomType as keyof typeof ROOM_LABELS] : "",
  ]
    .filter(Boolean)
    .join(", ");
  const amenityLabel =
    amenities.length === 0
      ? "Amenities"
      : amenities.length === 1
        ? amenities[0]
        : `${amenities.length} amenities`;

  if (!campus)
    return (
      <div className="page-container">
        <ErrorBox message="Campus information is unavailable. Please reload this page." />
      </div>
    );

  const hasQuery = !!params.get("query");
  const filtered = filterCount > 0 || hasQuery;
  const wide = panelWidth >= 680;

  return (
    <div
      ref={pageRef}
      className={`browse-page sheet-${sheet} ${resizing ? "is-resizing" : ""} ${dragging ? "is-dragging" : ""}`}
      style={
        {
          "--panel-w": `${panelWidth}px`,
          "--sheet-y": `${sheetY ?? snapFor(sheet)}px`,
        } as React.CSSProperties
      }
    >
      <aside
        className="browse-panel"
        aria-label="Listings"
        onPointerDown={startSheetDrag}
      >
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheet === "full" ? "Collapse the list" : "Expand the list"}
          onClick={() => setSheet(sheet === "full" ? "peek" : sheet === "half" ? "full" : "half")}
        >
          <span />
        </button>
        <div className="panel-head">
          <div className="head-row">
            <Popover
              width={360}
              trigger={(props) => (
                <button type="button" className="campus-switch" {...props}>
                  <span className="campus-icon">
                    <GraduationCap size={15} />
                  </span>
                  <span className="campus-text">
                    <strong>Near {campus.name}</strong>
                    <small>Tap to change campus</small>
                  </span>
                  <ChevronDown size={15} className="chip-chevron" />
                </button>
              )}
            >
              {(close) => (
                <div className="popover-body">
                  <CampusPicker
                    campuses={campuses}
                    current={campus.id}
                    onChoose={(id) => {
                      chooseCampus(id);
                      close();
                    }}
                  />
                </div>
              )}
            </Popover>
          </div>
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search listings"
              placeholder="Search by street, building, or keyword"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="icon-button clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearch("");
                  setParam("query", "");
                }}
              >
                <X size={15} />
              </button>
            )}
          </label>
          <div className="chip-row" role="group" aria-label="Filters">
            <Popover
              width={300}
              trigger={(props) => (
                <button
                  type="button"
                  className={`chip ${from || to ? "is-active" : ""}`}
                  {...props}
                >
                  <CalendarDays size={14} />
                  {dateLabelText}
                  <ChevronDown size={14} className="chip-chevron" />
                </button>
              )}
            >
              {(close) => (
              <div className="popover-body">
                <div className="popover-title">When do you need it?</div>
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">Move in</span>
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setParam("from", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Move out</span>
                    <input
                      type="date"
                      min={from || undefined}
                      value={to}
                      onChange={(e) => setParam("to", e.target.value)}
                    />
                  </label>
                </div>
                <div className="popover-footer">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setMany({ from: "", to: "" })}
                  >
                    Clear
                  </button>
                  <button type="button" className="button primary small" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
              )}
            </Popover>
            <Popover
              width={300}
              trigger={(props) => (
                <button
                  type="button"
                  className={`chip ${minPrice || maxPrice ? "is-active" : ""}`}
                  {...props}
                >
                  <SlidersHorizontal size={14} />
                  {priceLabel}
                  <ChevronDown size={14} className="chip-chevron" />
                </button>
              )}
            >
              {(close) => (
              <div className="popover-body">
                <div className="popover-title">Monthly rent</div>
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">Min</span>
                    <div className="input-prefix">
                      <span>$</span>
                      <input
                        type="number"
                        min="0"
                        max="20000"
                        placeholder="0"
                        value={minPrice}
                        onChange={(e) => setParam("minPrice", e.target.value)}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Max</span>
                    <div className="input-prefix">
                      <span>$</span>
                      <input
                        type="number"
                        min="0"
                        max="20000"
                        placeholder="Any"
                        value={maxPrice}
                        onChange={(e) => setParam("maxPrice", e.target.value)}
                      />
                    </div>
                  </label>
                </div>
                <div className="preset-list">
                  {PRICE_PRESETS.map((p) => {
                    const on = minPrice === p.min && maxPrice === p.max;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className={`option ${on ? "is-on" : ""}`}
                        onClick={() =>
                          setMany({ minPrice: p.min, maxPrice: p.max })
                        }
                      >
                        {p.label}
                        {on && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
                <div className="popover-footer">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setMany({ minPrice: "", maxPrice: "" })}
                  >
                    Clear
                  </button>
                  <button type="button" className="button primary small" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
              )}
            </Popover>
            <Popover
              width={300}
              trigger={(props) => (
                <button
                  type="button"
                  className={`chip ${bedrooms || roomType ? "is-active" : ""}`}
                  {...props}
                >
                  <BedDouble size={14} />
                  {roomsLabel || "Rooms"}
                  <ChevronDown size={14} className="chip-chevron" />
                </button>
              )}
            >
              {(close) => (
              <div className="popover-body">
                <div className="popover-title">Bedrooms</div>
                <div className="segment-grid">
                  {[
                    ["", "Any"],
                    ["0", "Studio"],
                    ["1", "1+"],
                    ["2", "2+"],
                    ["3", "3+"],
                    ["4", "4+"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`segment ${bedrooms === value ? "is-on" : ""}`}
                      aria-pressed={bedrooms === value}
                      onClick={() => setParam("bedrooms", value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="popover-title">Type of place</div>
                <div className="segment-grid four">
                  {[["", "Any"], ...Object.entries(ROOM_LABELS)].map(
                    ([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`segment ${roomType === value ? "is-on" : ""}`}
                        aria-pressed={roomType === value}
                        onClick={() => setParam("roomType", value)}
                      >
                        {label.replace(" room", "").replace(" place", "")}
                      </button>
                    ),
                  )}
                </div>
                <div className="popover-footer">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setMany({ bedrooms: "", roomType: "" })}
                  >
                    Clear
                  </button>
                  <button type="button" className="button primary small" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
              )}
            </Popover>
            <Popover
              width={320}
              align="right"
              trigger={(props) => (
                <button
                  type="button"
                  className={`chip ${amenities.length ? "is-active" : ""}`}
                  {...props}
                >
                  {amenityLabel}
                  {amenities.length > 1 && (
                    <span className="count-pill">{amenities.length}</span>
                  )}
                  <ChevronDown size={14} className="chip-chevron" />
                </button>
              )}
            >
              {(close) => (
              <div className="popover-body">
                <div className="popover-title">Amenities</div>
                <div className="check-grid">
                  {AMENITIES.map((amenity) => (
                    <label className="check-label" key={amenity}>
                      <input
                        type="checkbox"
                        checked={amenities.includes(amenity)}
                        onChange={(e) =>
                          setParam(
                            "amenities",
                            (e.target.checked
                              ? [...amenities, amenity]
                              : amenities.filter((a) => a !== amenity)
                            ).join(","),
                          )
                        }
                      />
                      {amenity}
                    </label>
                  ))}
                </div>
                <div className="popover-footer">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setParam("amenities", "")}
                  >
                    Clear
                  </button>
                  <button type="button" className="button primary small" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
              )}
            </Popover>
            {filtered && (
              <button
                type="button"
                className="chip clear-chip"
                onClick={clearFilters}
              >
                <X size={14} />
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="panel-scroll" ref={scrollRef}>
          {!user && (
            <Link to="/sign-in" className="signin-banner">
              <LogIn size={14} />
              <span>
                <strong>Sign in with your .edu</strong> to save places and
                request handoffs.
              </span>
            </Link>
          )}
          <div className="results-toolbar">
            <span className="results-count">
              <strong>{loading ? "…" : visible.length}</strong>{" "}
              {visible.length === 1 ? "place" : "places"}
              {!loading && bounds && inViewCount !== listings.length && (
                <button
                  type="button"
                  className={`inview-toggle ${inViewOnly ? "is-on" : ""}`}
                  aria-pressed={inViewOnly}
                  onClick={() => setInViewOnly((v) => !v)}
                >
                  <Crosshair size={12} />
                  {inViewOnly ? "Map area" : `${inViewCount} on the map`}
                </button>
              )}
            </span>
            <label className="sort-select">
              <span className="sr-only">Sort listings</span>
              <select
                value={params.get("sort") || "newest"}
                onChange={(e) => setParam("sort", e.target.value)}
              >
                <option value="newest">Newest</option>
                <option value="savings">Biggest savings</option>
                <option value="price_asc">Price, low to high</option>
                <option value="price_desc">Price, high to low</option>
              </select>
            </label>
          </div>
          {loading ? (
            <div
              className={`listing-list ${wide ? "wide" : ""}`}
              aria-label="Loading listings"
              role="status"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div className="skeleton" />
                  <div>
                    <span className="skeleton" />
                    <span className="skeleton" />
                    <span className="skeleton" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="panel-pad">
              <ErrorBox message={error} retry={refresh} />
            </div>
          ) : visible.length ? (
            <div className={`listing-list enter-stagger ${wide ? "wide" : ""}`}>
              {visible.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  campus={campus}
                  variant="compact"
                  active={listing.id === activeId}
                  onHover={handleListActive}
                  registerRef={registerRef}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                inViewOnly && listings.length
                  ? "Nothing in this part of the map."
                  : filtered
                    ? "No places match just yet."
                    : `Be the first at ${campus.name}.`
              }
              description={
                inViewOnly && listings.length
                  ? "Pan the map back toward campus or show every place."
                  : filtered
                    ? "Try a wider budget, different dates, or fewer filters."
                    : "There are no live listings here yet. Have a room opening up? Put it on the map."
              }
            >
              {inViewOnly && listings.length ? (
                <Button variant="secondary" onClick={() => setInViewOnly(false)}>
                  Show all places
                </Button>
              ) : filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/listings/new" className="button primary">
                  <Plus size={16} />
                  List your place
                </Link>
              )}
            </EmptyState>
          )}
        </div>
      </aside>
      <div
        className="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the listing panel"
        title="Drag to resize, double click to reset"
        onPointerDown={startResize}
        onDoubleClick={resetResize}
      >
        <span />
      </div>
      <section className="browse-map" aria-label="Campus map">
        <Suspense fallback={<Loading label="Loading map…" />}>
          <Map
            campus={campus}
            listings={listings}
            activeId={activeId}
            onActive={handleMapActive}
            onListing={navigateListing}
            onBounds={setBounds}
            bottomInset={
              window.innerWidth <= 760
                ? (pageRef.current?.clientHeight || window.innerHeight) -
                  snapFor("half")
                : 0
            }
          />
        </Suspense>
      </section>
      <Modal
        open={pickCampus}
        onClose={() => chooseCampus(campus.id)}
        title="Where are you looking?"
      >
        <p className="muted">Pick a campus to see subleases nearby.</p>
        <CampusPicker
          campuses={campuses}
          current={campus.id}
          onChoose={chooseCampus}
        />
      </Modal>
    </div>
  );
}
