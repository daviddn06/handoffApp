import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Popover } from "./Popover";
import { Modal } from "./ui";
import { Calendar, parseISO, toISO } from "./Calendar";

/**
 * Input shaped button that opens a designed calendar. On desktop the calendar
 * sits in the shared Popover, on phones it opens as a bottom sheet through the
 * Modal primitive so the whole month gets full width and 44px targets.
 */

function useIsPhone() {
  const [phone, setPhone] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

function format(value: string) {
  const p = parseISO(value);
  if (!p) return "";
  return new Date(p.y, p.m, p.d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function DateField({
  id,
  name,
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  placeholder = "Pick a date",
  label,
  className = "",
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const now = new Date();
  const todayISO = toISO(now.getFullYear(), now.getMonth(), now.getDate());
  const todayAllowed = !(min && todayISO < min) && !(max && todayISO > max);
  const text = format(value);

  function pick(next: string) {
    onChange(next);
    if (!phone) {
      setOpen(false);
      button.current?.focus();
    }
  }

  const trigger = (props?: Record<string, unknown>) => (
    <span className="date-field-wrap">
      <button
        {...props}
        type="button"
        id={id}
        ref={button}
        disabled={disabled}
        className={`date-field ${value ? "has-value" : ""} ${className}`}
        aria-required={required || undefined}
        onClick={() => {
          const fromPopover = props?.onClick as (() => void) | undefined;
          if (fromPopover) fromPopover();
          else setOpen(true);
        }}
      >
        <CalendarDays size={16} className="date-field-icon" />
        <span className={`date-field-text ${value ? "" : "is-placeholder"}`}>
          {text || placeholder}
        </span>
      </button>
      {value && !disabled && (
        <button
          type="button"
          className="date-field-clear"
          aria-label="Clear date"
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      )}
      {name && <input type="hidden" name={name} value={value} />}
    </span>
  );

  if (phone) {
    return (
      <>
        {trigger()}
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={label || placeholder}
        >
          <div className="date-sheet">
            <Calendar
              value={value}
              onChange={onChange}
              min={min}
              max={max}
              className="is-sheet"
            />
            <div className="date-sheet-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => onChange("")}
              >
                Clear
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <Popover
      width={320}
      open={open}
      onOpenChange={setOpen}
      className="date-field-anchor"
      trigger={(props) => trigger(props as unknown as Record<string, unknown>)}
    >
      <div className="date-pop">
        <Calendar
          value={value}
          onChange={pick}
          min={min}
          max={max}
          autoFocus
        />
        <div className="popover-footer">
          <button
            type="button"
            className="text-button"
            onClick={() => onChange("")}
          >
            Clear
          </button>
          {todayAllowed && (
            <button
              type="button"
              className="text-button"
              onClick={() => pick(todayISO)}
            >
              Today
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}
