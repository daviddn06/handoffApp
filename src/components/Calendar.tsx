import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Inline month calendar. Single mode (value / onChange) or range mode
 * (range / onRangeChange). Keyboard arrows move focus, Enter or Space picks.
 * Month changes swap the label on the transitions.dev text swap clock and
 * slide the grid in from the direction of travel.
 */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function toISO(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

export function parseISO(value?: string) {
  if (!value || value.length < 10) return null;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7)) - 1;
  const d = Number(value.slice(8, 10));
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function shiftDays(iso: string, delta: number) {
  const p = parseISO(iso);
  if (!p) return iso;
  const dt = new Date(p.y, p.m, p.d + delta);
  return toISO(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function shiftMonths(iso: string, delta: number) {
  const p = parseISO(iso);
  if (!p) return iso;
  const last = new Date(p.y, p.m + delta + 1, 0).getDate();
  const dt = new Date(p.y, p.m + delta, Math.min(p.d, last));
  return toISO(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function clamp(iso: string, min?: string, max?: string) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export type Range = { from: string; to: string };

export function Calendar({
  value = "",
  onChange,
  range,
  onRangeChange,
  min,
  max,
  initialMonth,
  autoFocus = false,
  className = "",
  labelledBy,
}: {
  value?: string;
  onChange?: (value: string) => void;
  range?: Range;
  onRangeChange?: (range: Range) => void;
  min?: string;
  max?: string;
  initialMonth?: string;
  autoFocus?: boolean;
  className?: string;
  labelledBy?: string;
}) {
  const isRange = Boolean(range || onRangeChange);
  const todayISO = useMemo(() => {
    const now = new Date();
    return toISO(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const anchor =
    (isRange ? range?.from || range?.to : value) ||
    initialMonth ||
    clamp(todayISO, min, max);
  const anchored = parseISO(anchor) || parseISO(todayISO)!;

  const [view, setView] = useState({ y: anchored.y, m: anchored.m });
  const [dir, setDir] = useState(0);
  const [focused, setFocused] = useState(() => clamp(anchor, min, max));
  const [hover, setHover] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(autoFocus);
  const seen = useRef(anchor);

  // Follow the value when it changes from outside (a cleared field, a new from).
  useEffect(() => {
    if (anchor === seen.current) return;
    seen.current = anchor;
    const p = parseISO(anchor);
    if (!p) return;
    setView((v) => (v.y === p.y && v.m === p.m ? v : { y: p.y, m: p.m }));
    setFocused(anchor);
  }, [anchor]);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    const el = grid.current?.querySelector<HTMLButtonElement>(
      'button[tabindex="0"]',
    );
    el?.focus();
  }, [focused]);

  const days = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = first.getDay();
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(view.y, view.m, 1 - offset + i);
      return {
        iso: toISO(dt.getFullYear(), dt.getMonth(), dt.getDate()),
        day: dt.getDate(),
        outside: dt.getMonth() !== view.m,
      };
    });
  }, [view]);

  const disabled = (iso: string) =>
    Boolean((min && iso < min) || (max && iso > max));

  function goto(delta: number) {
    setDir(delta);
    setView((v) => {
      const dt = new Date(v.y, v.m + delta, 1);
      return { y: dt.getFullYear(), m: dt.getMonth() };
    });
  }

  function moveFocus(next: string) {
    const target = clamp(next, min, max);
    const p = parseISO(target);
    if (!p) return;
    if (p.y !== view.y || p.m !== view.m) {
      setDir(p.y * 12 + p.m > view.y * 12 + view.m ? 1 : -1);
      setView({ y: p.y, m: p.m });
    }
    shouldFocus.current = true;
    setFocused(target);
  }

  function select(iso: string) {
    if (disabled(iso)) return;
    if (isRange) {
      const from = range?.from || "";
      const to = range?.to || "";
      if (!from || (from && to) || iso < from) onRangeChange?.({ from: iso, to: "" });
      else onRangeChange?.({ from, to: iso });
      setFocused(iso);
      return;
    }
    onChange?.(iso);
    setFocused(iso);
  }

  function onKeyDown(e: KeyboardEvent) {
    const keys: Record<string, () => string> = {
      ArrowLeft: () => shiftDays(focused, -1),
      ArrowRight: () => shiftDays(focused, 1),
      ArrowUp: () => shiftDays(focused, -7),
      ArrowDown: () => shiftDays(focused, 7),
      Home: () => shiftDays(focused, -(parseISO(focused)?.d ?? 1) + 1),
      End: () => {
        const p = parseISO(focused);
        return p ? toISO(p.y, p.m, new Date(p.y, p.m + 1, 0).getDate()) : focused;
      },
      PageUp: () => shiftMonths(focused, -1),
      PageDown: () => shiftMonths(focused, 1),
    };
    if (keys[e.key]) {
      e.preventDefault();
      moveFocus(keys[e.key]());
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(focused);
    }
  }

  const from = isRange ? range?.from || "" : "";
  const to = isRange ? range?.to || "" : "";
  const previewTo = to || (from && hover > from ? hover : "");
  const monthKey = `${view.y}-${view.m}`;

  const viewKeyNum = view.y * 12 + view.m;
  const minMonth = min ? parseISO(min) : null;
  const maxMonth = max ? parseISO(max) : null;
  const prevDisabled = Boolean(
    minMonth && minMonth.y * 12 + minMonth.m >= viewKeyNum,
  );
  const nextDisabled = Boolean(
    maxMonth && maxMonth.y * 12 + maxMonth.m <= viewKeyNum,
  );

  return (
    <div className={`cal ${className}`} style={{ ["--cal-dir" as string]: dir }}>
      <div className="cal-head">
        <button
          type="button"
          className="cal-nav"
          onClick={() => goto(-1)}
          disabled={prevDisabled}
          aria-label="Previous month"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="cal-title" aria-live="polite">
          <span key={monthKey} className="cal-title-text">
            {MONTHS[view.m]} {view.y}
          </span>
        </div>
        <button
          type="button"
          className="cal-nav"
          onClick={() => goto(1)}
          disabled={nextDisabled}
          aria-label="Next month"
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div
        className="cal-grid"
        key={monthKey}
        ref={grid}
        role="grid"
        aria-label={labelledBy ? undefined : `${MONTHS[view.m]} ${view.y}`}
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHover("")}
      >
        {days.map((d) => {
          const off = disabled(d.iso);
          const selected = isRange
            ? d.iso === from || d.iso === to
            : d.iso === value;
          const inRange = Boolean(
            isRange && from && previewTo && d.iso > from && d.iso < previewTo,
          );
          const isStart = Boolean(isRange && from && previewTo && d.iso === from);
          const isEnd = Boolean(isRange && from && previewTo && d.iso === previewTo);
          return (
            <button
              type="button"
              key={d.iso}
              className={[
                "cal-day",
                d.outside ? "is-outside" : "",
                d.iso === todayISO ? "is-today" : "",
                selected ? "is-selected" : "",
                inRange ? "is-in-range" : "",
                isStart ? "is-start" : "",
                isEnd ? "is-end" : "",
                off ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              tabIndex={d.iso === focused ? 0 : -1}
              aria-disabled={off || undefined}
              aria-selected={selected || undefined}
              aria-current={d.iso === todayISO ? "date" : undefined}
              onMouseEnter={() => setHover(d.iso)}
              onFocus={() => setFocused(d.iso)}
              onClick={() => select(d.iso)}
            >
              <span className="cal-day-inner">{d.day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
