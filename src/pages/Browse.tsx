import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  Map as MapIcon,
  LayoutGrid,
  ChevronDown,
  MapPin,
  X,
  Plus,
  ArrowRight,
  House,
} from "lucide-react";
import { useApp } from "../lib/context";
import { useResource } from "../lib/api";
import { AMENITIES, ROOM_LABELS, type Listing } from "../types";
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Modal,
} from "../components/ui";
import { ListingCard } from "../components/ListingCard";
const Map = lazy(() => import("../components/Map"));
const filterKeys = [
  "minPrice",
  "maxPrice",
  "from",
  "to",
  "roomType",
  "bedrooms",
  "amenities",
];
type Filters = {
  minPrice: string;
  maxPrice: string;
  from: string;
  to: string;
  roomType: string;
  bedrooms: string;
  amenities: string[];
};
function readFilters(params: URLSearchParams): Filters {
  return {
    minPrice: params.get("minPrice") || "",
    maxPrice: params.get("maxPrice") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    roomType: params.get("roomType") || "",
    bedrooms: params.get("bedrooms") || "",
    amenities: (params.get("amenities") || "").split(",").filter(Boolean),
  };
}
export default function Browse() {
  const { campuses, user } = useApp(),
    navigate = useNavigate(),
    [params, setParams] = useSearchParams();
  const campus =
    campuses.find(
      (c) => c.id === (params.get("campusId") || user?.campusId || "usc"),
    ) || campuses[0];
  const [view, setView] = useState<"map" | "grid">(() =>
    window.matchMedia("(max-width: 760px)").matches ? "grid" : "map",
  );
  const [search, setSearch] = useState(params.get("query") || ""),
    [filterOpen, setFilterOpen] = useState(false),
    [filters, setFilters] = useState<Filters>(() => readFilters(params)),
    [filterError, setFilterError] = useState("");
  const query = new URLSearchParams(params);
  query.set("campusId", campus?.id || "usc");
  const { data, loading, error, refresh } = useResource<{
    listings: Listing[];
  }>(`/listings?${query}`);
  useEffect(() => setSearch(params.get("query") || ""), [params]);
  const navigateListing = useCallback(
    (id: string) => navigate(`/listings/${id}`),
    [navigate],
  );
  const filterCount = filterKeys.filter((key) => params.has(key)).length;
  function setParam(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  function clearFilters() {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      [...filterKeys, "query"].forEach((key) => next.delete(key));
      return next;
    });
    setSearch("");
  }
  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setParam("query", search.trim());
  }
  function applyFilters(e: FormEvent) {
    e.preventDefault();
    if (
      filters.minPrice &&
      filters.maxPrice &&
      Number(filters.minPrice) > Number(filters.maxPrice)
    ) {
      setFilterError("The maximum price needs to be higher than the minimum.");
      return;
    }
    if (filters.from && filters.to && filters.to <= filters.from) {
      setFilterError("Move-out needs to be after move-in.");
      return;
    }
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(filters).forEach(([key, value]) => {
        const val = Array.isArray(value) ? value.join(",") : value;
        if (val) next.set(key, val);
        else next.delete(key);
      });
      return next;
    });
    setFilterOpen(false);
  }
  if (!campus)
    return (
      <div className="page-container">
        <ErrorBox message="Campus information is unavailable. Please reload this page." />
      </div>
    );
  return (
    <div className="browse-page">
      <section className="browse-top">
        <div className="browse-title">
          <div>
            <div className="eyebrow">A place for your next chapter</div>
            <h1>Find your place.</h1>
            <p>Student subleases, close to campus.</p>
          </div>
          <label className="campus-picker">
            <span className="campus-icon">
              <House size={21} />
            </span>
            <span>
              <small>Your campus</small>
              <select
                aria-label="Your campus"
                value={campus.id}
                onChange={(e) => setParam("campusId", e.target.value)}
              >
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName} · {c.name}
                  </option>
                ))}
              </select>
            </span>
            <ChevronDown size={16} />
          </label>
        </div>
        <div className="browse-toolbar">
          <form className="search-form" onSubmit={submitSearch}>
            <Search size={19} />
            <input
              aria-label="Search listings"
              placeholder="Search a neighborhood, street, or place"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  setSearch("");
                  setParam("query", "");
                }}
                aria-label="Clear search"
              >
                <X size={17} />
              </button>
            )}
            <button type="submit" className="search-submit" aria-label="Search">
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className={`button secondary filter-button ${filterCount ? "has-filters" : ""}`}
            onClick={() => {
              setFilters(readFilters(params));
              setFilterError("");
              setFilterOpen(true);
            }}
          >
            <SlidersHorizontal size={17} />
            Filters
            {filterCount > 0 && (
              <span className="count-pill">{filterCount}</span>
            )}
          </button>
          <div className="view-toggle" role="group" aria-label="Listing view">
            <button
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <LayoutGrid size={17} />
              <span>Grid</span>
            </button>
            <button
              aria-label="Map view"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              <MapIcon size={17} />
              <span>Map</span>
            </button>
          </div>
        </div>
        {(filterCount > 0 || params.get("query")) && (
          <div className="active-filters">
            <span>{params.get("query") ? `“${params.get("query")}”` : ""}</span>
            {filterCount > 0 && (
              <span>
                {filterCount} filter{filterCount !== 1 ? "s" : ""} applied
              </span>
            )}
            <button onClick={clearFilters}>
              Clear all <X size={13} />
            </button>
          </div>
        )}
      </section>
      <div className={`browse-workspace ${view}`}>
        <section className="results-panel" aria-label="Listing results">
          <div className="results-toolbar">
            <span>
              <strong>{loading ? "…" : data?.listings.length || 0}</strong>{" "}
              places near {campus.shortName}
            </span>
            <label className="sort-select">
              <span className="sr-only">Sort listings</span>
              <select
                value={params.get("sort") || "newest"}
                onChange={(e) => setParam("sort", e.target.value)}
              >
                <option value="newest">Newest first</option>
                <option value="price_asc">Price, low to high</option>
                <option value="price_desc">Price, high to low</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          {loading ? (
            <div
              className="listings-grid"
              aria-label="Loading listings"
              role="status"
            >
              {[0, 1, 2, 3].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorBox message={error} retry={refresh} />
          ) : data?.listings.length ? (
            <div className="listings-grid">
              {data.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={
                filterCount || params.get("query") ? undefined : (
                  <House size={29} strokeWidth={1.4} />
                )
              }
              title={
                filterCount || params.get("query")
                  ? "No places match just yet."
                  : `Make the first move at ${campus.shortName}.`
              }
              description={
                filterCount || params.get("query")
                  ? "Try a wider budget, different dates, or fewer filters to find a place that fits."
                  : `There aren’t any live listings here yet. Have a room or place opening up? Put it on the map.`
              }
            >
              {filterCount || params.get("query") ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/listings/new" className="button primary">
                  <Plus size={17} />
                  List your place
                </Link>
              )}
            </EmptyState>
          )}
          <div className="results-note">
            <MapPin size={14} />
            <span>
              Explore {campus.shortName} and its surrounding neighborhoods.
            </span>
          </div>
        </section>
        {view === "map" && (
          <aside className="browse-map" aria-label="Campus map">
            <Suspense fallback={<Loading label="Loading map…" />}>
              <Map
                campus={campus}
                listings={data?.listings || []}
                onListing={navigateListing}
              />
            </Suspense>
            <div className="map-campus-label">
              <span className="blue-dot" />
              {campus.name}
            </div>
          </aside>
        )}
      </div>
      <Modal
        title="Find your fit"
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
      >
        <form onSubmit={applyFilters} className="filter-form">
          <p className="muted">A few details to narrow things down.</p>
          <div className="field-row">
            <Field label="Minimum monthly rent">
              <div className="input-prefix">
                <span>$</span>
                <input
                  type="number"
                  min="0"
                  max="20000"
                  placeholder="No minimum"
                  value={filters.minPrice}
                  onChange={(e) =>
                    setFilters({ ...filters, minPrice: e.target.value })
                  }
                />
              </div>
            </Field>
            <Field label="Maximum monthly rent">
              <div className="input-prefix">
                <span>$</span>
                <input
                  type="number"
                  min="0"
                  max="20000"
                  placeholder="No maximum"
                  value={filters.maxPrice}
                  onChange={(e) =>
                    setFilters({ ...filters, maxPrice: e.target.value })
                  }
                />
              </div>
            </Field>
          </div>
          <div className="field-row">
            <Field label="Move-in">
              <input
                type="date"
                value={filters.from}
                onChange={(e) =>
                  setFilters({ ...filters, from: e.target.value })
                }
              />
            </Field>
            <Field label="Move-out">
              <input
                type="date"
                min={filters.from || undefined}
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Type of place">
            <select
              value={filters.roomType}
              onChange={(e) =>
                setFilters({ ...filters, roomType: e.target.value })
              }
            >
              <option value="">Any type</option>
              {Object.entries(ROOM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bedrooms">
            <select
              value={filters.bedrooms}
              onChange={(e) =>
                setFilters({ ...filters, bedrooms: e.target.value })
              }
            >
              <option value="">Any number</option>
              <option value="0">Studio</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} bedroom{n !== 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="amenities-field">
            <legend>Amenities</legend>
            <div className="check-grid">
              {AMENITIES.map((amenity) => (
                <label className="check-label" key={amenity}>
                  <input
                    type="checkbox"
                    checked={filters.amenities.includes(amenity)}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        amenities: e.target.checked
                          ? [...filters.amenities, amenity]
                          : filters.amenities.filter((a) => a !== amenity),
                      })
                    }
                  />
                  {amenity}
                </label>
              ))}
            </div>
          </fieldset>
          {filterError && <ErrorBox message={filterError} />}
          <div className="modal-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFilters(readFilters(new URLSearchParams()))}
            >
              Reset
            </Button>
            <Button type="submit">
              Show places
              <ArrowRight size={17} />
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
