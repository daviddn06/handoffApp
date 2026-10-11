import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowRight,
  AlertCircle,
  LoaderCircle,
  SearchX,
  X,
  Check,
  ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";
import { MobileAccount } from "./AccountButton";
export function Button({
  children,
  busy = false,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${className}`}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle className="spin" size={17} />} {children}
    </button>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <div>
        <p>{message}</p>
        {retry && (
          <button className="text-button" onClick={retry}>
            Try again <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <Check size={18} />
      <div>{children}</div>
    </div>
  );
}
export function Loading({
  label = "Loading your space…",
  bar = true,
}: {
  label?: string;
  bar?: boolean;
}) {
  return (
    <div className="loading" role="status" aria-live="polite">
      {bar && <span className="route-progress" aria-hidden="true" />}
      <span className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="t-shimmer" data-text={label}>
        {label}
      </span>
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {icon || <SearchX size={28} strokeWidth={1.5} />}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
      <MobileAccount />
    </div>
  );
}
/** Reduced motion is checked at the moment it matters, never cached. */
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Opening a dialog must not move the page behind it. The scroll is locked and
 * the width the scrollbar gave up is handed back as padding, so nothing
 * reflows on open or close. Ref counted, because two dialogs can overlap.
 */
let scrollLocks = 0;
let savedOverflow = "";
let savedPadding = "";
function lockPageScroll() {
  if (scrollLocks++ > 0) return;
  const root = document.documentElement;
  const gap = window.innerWidth - root.clientWidth;
  savedOverflow = root.style.overflow;
  savedPadding = root.style.paddingRight;
  root.style.overflow = "hidden";
  if (gap > 0) root.style.paddingRight = `${gap}px`;
}
function unlockPageScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  const root = document.documentElement;
  root.style.overflow = savedOverflow;
  root.style.paddingRight = savedPadding;
}

/**
 * Every dialog in the app opens and closes the same way. The element stays
 * mounted and open through the whole close animation, and only then does
 * close() run, so the card and its backdrop leave together instead of
 * blinking out. Returns the class the host puts on the dialog.
 */
export function useDialogMotion(
  open: boolean,
  ref: RefObject<HTMLDialogElement | null>,
) {
  const [closing, setClosing] = useState(false);
  const restoreTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      setClosing(false);
      if (!el.open) {
        restoreTo.current = document.activeElement as HTMLElement | null;
        lockPageScroll();
        el.showModal();
      }
      return;
    }
    if (!el.open) return;
    const finish = () => {
      if (!el.open) return;
      el.close();
      setClosing(false);
      unlockPageScroll();
      // Back to whatever they clicked, so the keyboard keeps its place.
      restoreTo.current?.focus?.();
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    setClosing(true);
    // The animation end is the signal, the timer is only the safety net.
    const onEnd = (e: AnimationEvent) => {
      if (e.target === el) finish();
    };
    el.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(finish, 420);
    return () => {
      el.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
    };
  }, [open, ref]);
  useEffect(() => () => unlockPageScroll(), []);
  return closing ? "is-closing" : "";
}

/** Tab never leaves an open dialog. */
export function trapTab(e: React.KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab") return;
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ),
  ).filter((el) => el.offsetParent !== null && el.tabIndex !== -1);
  const first = items[0],
    last = items[items.length - 1];
  if (!first) return;
  if (
    e.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === e.currentTarget)
  ) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** A click outside the card, which on a dialog means outside its own box. */
export function backdropClick(
  e: React.MouseEvent<HTMLDialogElement>,
  onClose: () => void,
) {
  if (e.target !== e.currentTarget) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (
    e.clientX < r.left ||
    e.clientX > r.right ||
    e.clientY < r.top ||
    e.clientY > r.bottom
  )
    onClose();
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One muted line under the title. Longer support copy belongs in the body. */
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  const motion = useDialogMotion(open, ref);
  return (
    <dialog
      className={`modal ${wide ? "wide" : ""} ${className} ${motion}`.trim()}
      ref={ref}
      aria-labelledby={id}
      onKeyDown={trapTab}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => backdropClick(e, onClose)}
    >
      <span className="sheet-grip" aria-hidden="true">
        <span />
      </span>
      <button
        type="button"
        className="icon-button modal-close"
        onClick={onClose}
        aria-label="Close dialog"
      >
        <X size={20} />
      </button>
      <div className="modal-scroll">
        <div className="modal-heading">
          <h2 id={id}>{title}</h2>
        </div>
        {description && <p className="muted">{description}</p>}
        {children}
      </div>
    </dialog>
  );
}
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  let linked = false;
  function attach(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (
        !isValidElement<{
          children?: ReactNode;
          id?: string;
          "aria-describedby"?: string;
          "aria-invalid"?: boolean;
        }>(node)
      )
        return node;
      if (
        !linked &&
        typeof node.type === "string" &&
        ["input", "select", "textarea"].includes(node.type)
      ) {
        linked = true;
        return cloneElement(node, {
          id,
          "aria-describedby":
            [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
              .filter(Boolean)
              .join(" ") || undefined,
          "aria-invalid": error ? true : undefined,
        });
      }
      return node.props.children
        ? cloneElement(node, {}, attach(node.props.children))
        : node;
    });
  }
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {attach(children)}
      {hint && !error && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
export function BackLink({
  to = "/browse",
  children = "Back to browse",
}: {
  to?: string;
  children?: ReactNode;
}) {
  return (
    <Link to={to} className="back-link">
      <ArrowLeft size={16} />
      {children}
    </Link>
  );
}
