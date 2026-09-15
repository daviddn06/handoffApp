import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  X,
  Plus,
  Map as MapIcon,
  List,
  CalendarDays,
  BedDouble,
  Check,
  LogIn,
  Crosshair,
  ArrowRight,
} from "lucide-react";
import { useApp } from "../lib/context";
import { useResource, money, dateLabel, today } from "../lib/api";
import { AMENITIES, ROOM_LABELS, type Listing } from "../types";
import { Button, EmptyState, ErrorBox, Loading, Modal } from "../components/ui";
import { ListingCard } from "../components/ListingCard";
import { Popover } from "../components/Popover";
import { Calendar } from "../components/Calendar";
import { inBounds, milesBetween, type MapBounds } from "../lib/dps";
import {
  SchoolSearch,
  SchoolLogo,
  campusLogo,
} from "../components/SchoolSearch";
import { isEmbed } from "../components/Layout";
const Map = lazy(() => import("../components/Map"));

const filterKeys = [
  "minPrice",
  "maxPrice",
  "from",
  "to",
  "roomType",
  "gender",
  "bedrooms",
  "amenities",
] as const;
const GENDER_FILTERS = [
  ["", "Any"],
  ["women", "Open to women"],
  ["men", "Open to men"],
  ["women_only", "Women only"],
  ["men_only", "Men only"],
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
  const { campuses, user, openAuth, auth } = useApp(),
    navigate = useNavigate(),
    [params, setParams] = useSearchParams();
  const remembered = readCampus();
  // Everyone starts at the first live campus unless they chose another one.
  // A student whose own school is not open yet has no campusId, so the
  // default must never come from their email.
  const firstLive = campuses.find((c) => c.live !== false) || campuses[0];
  const campus =
    campuses.find(
      (c) =>
        c.id ===
        (params.get("campusId") ||
          remembered ||
          user?.campusId ||
          firstLive?.id),
    ) || firstLive;
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
  // The auth modal takes over the screen, so the campus picker steps aside.
  useEffect(() => {
    if (auth.open) {
      setPickCampus(false);
      setSwitchCampus(false);
    }
  }, [auth.open]);
  const chooseCampus = (id: string) => {
    rememberCampus(id);
    try {
      sessionStorage.setItem("handoff:campus-picked", "1");
    } catch {
      /* ignore */
    }
    setParam("campusId", id);
    setPickCampus(false);
    setSwitchCampus(false);
  };
  // The switch opens a popover on desktop and the sheet on phones, where a
  // popover would be too cramped for a search panel.
  const [switchCampus, setSwitchCampus] = useState(false);
  const [phone, setPhone] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const sync = () => setPhone(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // Phones choose between a full map with a card carousel and a full list.
  const [mobileView, setMobileView] = useState<"map" | "list">(() => {
    try {
      return sessionStorage.getItem("handoff:mobile-view") === "list"
        ? "list"
        : "map";
    } catch {
      return "map";
    }
  });
  const switchMobileView = (view: "map" | "list") => {
    setMobileView(view);
    try {
      sessionStorage.setItem("handoff:mobile-view", view);
    } catch {
      /* ignore */
    }
  };
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("query") || "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [homeSignal, setHomeSignal] = useState(0);
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
  // Every live listing comes down, the map viewport decides what the list
  // shows. The campus is the reference point for distance and travel time.
  if (query.get("sort") === "closest") query.delete("sort");
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
    // On a phone a tapped pin brings its card into the carousel.
    if (id && window.innerWidth <= 760) {
      const card = carouselRef.current?.querySelector<HTMLElement>(
        `[data-id="${id}"]`,
      );
      card?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
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
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
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
  const sortKey = params.get("sort") || "closest";
  const visible = useMemo(() => {
    const scoped = bounds
      ? listings.filter((l) => inBounds(bounds, l.lat, l.lng))
      : listings;
    if (sortKey !== "closest" || !campus) return scoped;
    // Boosted places stay on top, closest first inside each group.
    return [...scoped].sort(
      (a, b) =>
        Number(!!b.boosted) - Number(!!a.boosted) ||
        milesBetween(campus, a) - milesBetween(campus, b),
    );
  }, [listings, bounds, sortKey, campus]);
  const offMap = !loading && listings.length > 0 && visible.length === 0;

  // Chip labels reflect the active value.
  const minPrice = params.get("minPrice") || "",
    maxPrice = params.get("maxPrice") || "",
    from = params.get("from") || "",
    to = params.get("to") || "",
    roomType = params.get("roomType") || "",
    bedrooms = params.get("bedrooms") || "",
    genderFilter = params.get("gender") || "",
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
  // Bedrooms, type of place and roommate preference share one chip, so the
  // chip names the first one set and counts the rest.
  const roomsParts = [
    bedrooms ? (bedrooms === "0" ? "Studio+" : `${bedrooms}+ bd`) : "",
    roomType ? ROOM_LABELS[roomType as keyof typeof ROOM_LABELS] : "",
    GENDER_FILTERS.find(([value]) => value && value === genderFilter)?.[1] ||
      "",
  ].filter(Boolean);
  const roomsLabel = roomsParts[0] || "";
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
      className={`browse-page mobile-${mobileView} ${resizing ? "is-resizing" : ""}`}
      style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
    >
      <aside className="browse-panel" aria-label="Listings">
        <div className="panel-head">
          <div className="head-row">
            {phone ? (
              <button
                type="button"
                className="campus-switch"
                aria-haspopup="dialog"
                aria-expanded={switchCampus}
                onClick={() => setSwitchCampus(true)}
              >
                <SchoolLogo src={campusLogo(campus)} />
                <span className="campus-text">
                  <strong>Near {campus.name}</strong>
                  <small>Change school</small>
                </span>
                <ChevronDown size={15} className="chip-chevron" />
              </button>
            ) : (
              <Popover
                width={380}
                trigger={(props) => (
                  <button type="button" className="campus-switch" {...props}>
                    <SchoolLogo src={campusLogo(campus)} />
                    <span className="campus-text">
                      <strong>Near {campus.name}</strong>
                      <small>Change school</small>
                    </span>
                    <ChevronDown size={15} className="chip-chevron" />
                  </button>
                )}
              >
                {(close) => (
                  <div className="popover-body">
                    <SchoolSearch
                      campuses={campuses}
                      current={campus.id}
                      onClose={close}
                      onChoose={(id) => {
                        chooseCampus(id);
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
            )}
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
              width={340}
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
              <div className="popover-body date-range-pop">
                <div className="popover-title">When do you need it?</div>
                <div className="date-range-summary">
                  <span className="dr-cell">
                    <span className="dr-label">Move in</span>
                    <span className={`dr-value ${from ? "" : "is-empty"}`}>
                      {from ? dateLabel(from, true) : "Add a date"}
                    </span>
                  </span>
                  <ArrowRight size={14} className="dr-arrow" />
                  <span className="dr-cell">
                    <span className="dr-label">Move out</span>
                    <span className={`dr-value ${to ? "" : "is-empty"}`}>
                      {to ? dateLabel(to, true) : "Add a date"}
                    </span>
                  </span>
                </div>
                <Calendar
                  range={{ from, to }}
                  onRangeChange={(r) => setMany({ from: r.from, to: r.to })}
                  min={today()}
                />
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
                  className={`chip ${
                    bedrooms || roomType || genderFilter ? "is-active" : ""
                  }`}
                  {...props}
                >
                  <BedDouble size={14} />
                  {roomsLabel || "Rooms"}
                  {roomsParts.length > 1 && (
                    <span className="count-pill">{roomsParts.length}</span>
                  )}
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
                <div className="popover-title">Roommate preference</div>
                <div className="segment-grid preference-grid">
                  {GENDER_FILTERS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`segment ${genderFilter === value ? "is-on" : ""}`}
                      aria-pressed={genderFilter === value}
                      onClick={() => setParam("gender", value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="popover-footer">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setMany({ bedrooms: "", roomType: "", gender: "" })
                    }
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
            <button
              type="button"
              className="signin-banner"
              onClick={() => openAuth()}
            >
              <LogIn size={14} />
              <span>
                <strong>Sign in with your .edu</strong> to save places and
                request handoffs.
              </span>
            </button>
          )}
          <div className="results-toolbar">
            <span className="results-count">
              <strong>{loading ? "…" : visible.length}</strong>{" "}
              {visible.length === 1 ? "place" : "places"}
              <span className="results-scope">on the map</span>
            </span>
            <label className="sort-select">
              <span className="sr-only">Sort listings</span>
              <select
                value={sortKey}
                onChange={(e) => setParam("sort", e.target.value)}
              >
                <option value="newest">Newest</option>
                <option value="closest">Closest to campus</option>
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
                offMap
                  ? "Nothing in this part of the map."
                  : filtered
                    ? "No places match just yet."
                    : `Be the first at ${campus.name}.`
              }
              description={
                offMap
                  ? `Move the map or jump back to ${campus.name}.`
                  : filtered
                    ? "Try a wider budget, different dates, or fewer filters."
                    : "There are no live listings here yet. Have a room opening up? Put it on the map."
              }
            >
              {offMap ? (
                <Button
                  variant="secondary"
                  onClick={() => setHomeSignal((n) => n + 1)}
                >
                  <Crosshair size={15} />
                  Back to campus
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
            homeSignal={homeSignal}
            activeId={activeId}
            onActive={handleMapActive}
            onListing={navigateListing}
            onBounds={setBounds}
            bottomInset={window.innerWidth <= 760 ? 200 : 0}
            focusId={focusId}
          />
        </Suspense>
        {!loading && visible.length > 0 && (
          <div
            className="mobile-carousel"
            ref={carouselRef}
            aria-label="Listings on the map"
            onScroll={(e) => {
              const el = e.currentTarget;
              window.clearTimeout(
                (el as HTMLDivElement & { _t?: number })._t,
              );
              (el as HTMLDivElement & { _t?: number })._t = window.setTimeout(
                () => {
                  const center = el.scrollLeft + el.clientWidth / 2;
                  let best: HTMLElement | null = null,
                    bestDist = Infinity;
                  el.querySelectorAll<HTMLElement>("[data-id]").forEach((c) => {
                    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
                    if (d < bestDist) {
                      bestDist = d;
                      best = c;
                    }
                  });
                  const id = best ? (best as HTMLElement).dataset.id || null : null;
                  if (id && id !== activeId) {
                    activeSource.current = "list";
                    setActiveId(id);
                    setFocusId(id);
                  }
                },
                120,
              );
            }}
          >
            {visible.map((listing) => (
              <div className="carousel-item" data-id={listing.id} key={listing.id}>
                <ListingCard
                  listing={listing}
                  campus={campus}
                  variant="compact"
                  active={listing.id === activeId}
                />
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="mobile-view-toggle t-tabs" role="tablist" aria-label="Map or list">
        <button
          type="button"
          role="tab"
          className="t-tab"
          aria-selected={mobileView === "map"}
          onClick={() => switchMobileView("map")}
        >
          <MapIcon size={15} />
          Map
        </button>
        <button
          type="button"
          role="tab"
          className="t-tab"
          aria-selected={mobileView === "list"}
          onClick={() => switchMobileView("list")}
        >
          <List size={15} />
          List
        </button>
        <span className="t-tabs-pill" aria-hidden="true" data-pos={mobileView} />
      </div>
      <Modal
        open={pickCampus}
        onClose={() => chooseCampus(campus.id)}
        title="Where are you looking?"
      >
        <SchoolSearch
          campuses={campuses}
          current={campus.id}
          onChoose={chooseCampus}
          onClose={() => chooseCampus(campus.id)}
        />
      </Modal>
      {phone && (
        <Modal
          open={switchCampus}
          onClose={() => setSwitchCampus(false)}
          title="Change school"
        >
          <SchoolSearch
            campuses={campuses}
            current={campus.id}
            onChoose={chooseCampus}
            onClose={() => setSwitchCampus(false)}
          />
        </Modal>
      )}
    </div>
  );
}
