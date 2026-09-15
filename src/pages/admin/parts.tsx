/** Shared dashboard primitives. Dense tables, sparklines, drawer, pagination. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button, Modal } from "../../components/ui";
import type { Point } from "./types";

export const when = (value: string | null | undefined, time = true) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};
export const day = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const size = value / 1024 ** index;
  return `${size >= 100 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}
export function duration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
export const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

const PILL_TONE: Record<string, string> = {
  active: "green",
  accepted: "green",
  live: "green",
  yes: "green",
  draft: "amber",
  pending: "amber",
  open: "amber",
  archived: "red",
  declined: "red",
  disabled: "red",
  no: "red",
  handed_off: "blue",
  resolved: "blue",
  admin: "blue",
};
const PILL_LABEL: Record<string, string> = {
  active: "Live",
  draft: "Draft",
  handed_off: "Handed off",
  archived: "Archived",
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  open: "Open",
  resolved: "Resolved",
};
export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`pill ${PILL_TONE[value] || ""}`}>
      {label || PILL_LABEL[value] || value}
    </span>
  );
}

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="admin-page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="admin-search">
      <Search size={15} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="admin-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export type Column = {
  key: string;
  label: string;
  numeric?: boolean;
  width?: string;
};
export function TableShell({
  columns,
  children,
  loading,
  empty,
  emptyLabel = "Nothing here yet.",
  rows = 8,
}: {
  columns: Column[];
  children: ReactNode;
  loading: boolean;
  empty: boolean;
  emptyLabel?: string;
  rows?: number;
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.numeric ? "num" : ""}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: rows }, (_, row) => (
              <tr key={row} aria-hidden="true">
                {columns.map((column) => (
                  <td key={column.key}>
                    <span className="skeleton admin-skeleton" />
                  </td>
                ))}
              </tr>
            ))
          ) : empty ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="admin-empty">{emptyLabel}</div>
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (next: number) => void;
}) {
  return (
    <div className="admin-pager">
      <span>
        {number(total)} {total === 1 ? "row" : "rows"}, page {page} of {pages}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}

/** Right side drawer, transitions.dev panel reveal with a blur and rise. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) setMounted(true);
    else {
      const timer = setTimeout(() => setMounted(false), 350);
      return () => clearTimeout(timer);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className={`admin-drawer-root ${open ? "is-open" : "is-closing"}`}>
      <button
        className="admin-drawer-scrim"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        className="admin-drawer"
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close panel">
            <X size={19} />
          </button>
        </header>
        <div className="admin-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function KeyValues({
  items,
}: {
  items: [string, ReactNode][];
}) {
  return (
    <dl className="admin-kv">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="admin-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** Inline SVG sparkline. No chart library, no layout thrash. */
export function Sparkline({ points, tone = "blue" }: { points: Point[]; tone?: string }) {
  if (!points.length) return null;
  const width = 132;
  const height = 34;
  const max = Math.max(1, ...points.map((p) => p.count));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coordinates = points.map((point, index) => [
    index * step,
    height - 2 - (point.count / max) * (height - 6),
  ]);
  const line = coordinates
    .map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg
      className={`admin-spark tone-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="admin-spark-area" d={area} />
      <path className="admin-spark-line" d={line} />
    </svg>
  );
}

/** Small 30 day bar chart with a hover title. Values are whole numbers. */
export function Bars({
  points,
  label,
  tone = "blue",
}: {
  points: Point[];
  label: string;
  tone?: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const total = points.reduce((sum, p) => sum + p.count, 0);
  return (
    <div className="admin-bars-card">
      <div className="admin-bars-head">
        <span className="eyebrow">{label}</span>
        <strong>{number(total)}</strong>
      </div>
      <div className={`admin-bars tone-${tone}`} role="img" aria-label={`${label}, ${total} over 30 days`}>
        {points.map((point) => (
          <span
            key={point.day}
            className="admin-bar"
            style={{ height: `${Math.max(3, (point.count / max) * 100)}%` }}
            title={`${day(point.day)}, ${number(point.count)}`}
          />
        ))}
      </div>
      <div className="admin-bars-axis">
        <span>{day(points[0]?.day || "")}</span>
        <span>{day(points[points.length - 1]?.day || "")}</span>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  points,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  points?: Point[];
  tone?: string;
}) {
  return (
    <div className="admin-stat">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
      {points && <Sparkline points={points} tone={tone} />}
    </div>
  );
}

export function StatSkeletons({ count = 8 }: { count?: number }) {
  return (
    <div className="admin-stat-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="admin-stat" key={index}>
          <span className="skeleton admin-skeleton wide" />
          <span className="skeleton admin-skeleton tall" />
        </div>
      ))}
    </div>
  );
}

/** Every destructive dashboard action confirms through the app's own modal. */
/** Raw database values are not labels. */
export const titleCase = (value: string | null | undefined) =>
  value ? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";

/** A bare UUID is unreadable, so it comes with a copy control. */
export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="admin-copy-id">
      <code>{value}</code>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export type Pending = {
  title: string;
  body: string;
  label: string;
  /* A destructive action keeps its red all the way to the confirm. */
  danger?: boolean;
  run: () => Promise<void>;
} | null;
export function ConfirmModal({
  pending,
  onClose,
}: {
  pending: Pending;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={Boolean(pending)}
      onClose={() => (busy ? undefined : onClose())}
      title={pending?.title || ""}
      description={pending?.body}
    >
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          busy={busy}
          variant={pending?.danger ? "danger" : "primary"}
          onClick={async () => {
            if (!pending) return;
            setBusy(true);
            try {
              await pending.run();
            } finally {
              setBusy(false);
              onClose();
            }
          }}
        >
          {pending?.label || "Confirm"}
        </Button>
      </div>
    </Modal>
  );
}

/** Search box state that only hits the API once typing pauses. */
export function useDebounced<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
