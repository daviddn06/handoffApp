import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Anchored popover that grows from its trigger. Uses the transitions.dev
 * dropdown motion (open on the fast clock, close on the quick clock).
 */
export function Popover({
  trigger,
  children,
  align = "left",
  open,
  onOpenChange,
  width = 300,
  className = "",
}: {
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-controls": string;
    "aria-haspopup": "dialog";
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  width?: number | string;
  className?: string;
}) {
  const id = useId();
  const [internal, setInternal] = useState(false);
  const isOpen = open ?? internal;
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      if (open === undefined) setInternal(next);
    },
    [onOpenChange, open],
  );
  const close = useCallback(() => {
    if (!isOpen) return;
    setOpen(false);
    setClosing(true);
    const ms =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--dropdown-close-dur",
        ),
      ) || 150;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setClosing(false), ms);
  }, [isOpen, setOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, close]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className={`popover-anchor ${className}`} ref={ref}>
      {trigger({
        onClick: () => (isOpen ? close() : setOpen(true)),
        "aria-expanded": isOpen,
        "aria-controls": id,
        "aria-haspopup": "dialog",
      })}
      {(isOpen || closing) && (
        <div
          id={id}
          role="dialog"
          className={`popover t-dropdown ${isOpen ? "is-open" : "is-closing"}`}
          data-origin={align === "right" ? "top-right" : "top-left"}
          style={{
            width,
            ...(align === "right" ? { right: 0 } : { left: 0 }),
          }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
