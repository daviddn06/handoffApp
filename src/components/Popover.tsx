import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Anchored popover rendered in a portal so scrolling or masked parents never
 * clip it. Uses the transitions.dev dropdown motion (open on the fast clock,
 * close on the quick clock) and flips above the trigger when there is no room.
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
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    origin: string;
    maxHeight: number;
  } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
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

  const place = useCallback(() => {
    const a = anchor.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const w = typeof width === "number" ? width : 300;
    const gap = 6;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(12, Math.min(left, vw - w - 12));
    const panelH = panel.current?.offsetHeight || 320;
    const below = vh - r.bottom - gap - 12;
    const flip = below < Math.min(panelH, 260) && r.top > below;
    const top = flip ? r.top - gap - panelH : r.bottom + gap;
    setPos({
      top: Math.max(12, top),
      left,
      origin: `${flip ? "bottom" : "top"} ${align === "right" ? "right" : "left"}`,
      maxHeight: flip ? r.top - gap - 12 : below,
    });
  }, [align, width]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onMove = () => place();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [isOpen, close, place]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className={`popover-anchor ${className}`} ref={anchor}>
      {trigger({
        onClick: () => (isOpen ? close() : setOpen(true)),
        "aria-expanded": isOpen,
        "aria-controls": id,
        "aria-haspopup": "dialog",
      })}
      {(isOpen || closing) &&
        createPortal(
          <div
            id={id}
            ref={panel}
            role="dialog"
            className={`popover t-dropdown ${isOpen ? "is-open" : "is-closing"}`}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width,
              maxHeight: pos?.maxHeight,
              transformOrigin: pos?.origin,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}
