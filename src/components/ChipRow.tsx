import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A single row of filter chips that scrolls sideways. The row fades on the
 * side that has more, and a small arrow at that edge scrolls a page of chips
 * for anyone on a mouse. Nothing wraps, so the strip is always one line.
 */
export function ChipRow({
  children,
  label = "Filters",
}: {
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setMore((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    Array.from(el.children).forEach((child) => ro.observe(child));
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [children]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <div
      className="chip-scroller"
      data-more-left={more.left || undefined}
      data-more-right={more.right || undefined}
    >
      <div className="chip-row" role="group" aria-label={label} ref={ref}>
        {children}
      </div>
      {more.left && (
        <button
          type="button"
          className="chip-more left"
          aria-label="Earlier filters"
          onClick={() => page(-1)}
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {more.right && (
        <button
          type="button"
          className="chip-more right"
          aria-label="More filters"
          onClick={() => page(1)}
        >
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
