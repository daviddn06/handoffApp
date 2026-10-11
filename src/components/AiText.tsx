// Two transitions.dev pieces Smart import uses. Styles live in import.css.
import { useEffect, useRef } from "react";

const ms = (name: string, fallback: number) => {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
};

/**
 * transitions.dev 28, thinking states. One status line that shimmers while it
 * holds, then swaps up to the next one. The hidden sizer holds the longest
 * state so the box never resizes mid swap.
 */
export function ThinkingLine({ states }: { states: string[] }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || states.length < 2) return;
    let live = el.querySelector<HTMLSpanElement>(".t-think-text");
    let index = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (fn: () => void, delay: number) => {
      timers.push(setTimeout(fn, delay));
    };
    const cycle = () =>
      wait(() => {
        if (!live) return;
        const swap = ms("--think-swap", 150);
        const gap = ms("--think-gap", 50);
        const leaving = live;
        index = (index + 1) % states.length;
        leaving.classList.add("is-exit");
        const next = document.createElement("span");
        next.className = "t-think-text is-enter-start";
        next.textContent = states[index];
        next.setAttribute("data-text", states[index]);
        el.appendChild(next);
        live = next;
        const release = () => {
          void next.offsetWidth;
          next.classList.remove("is-enter-start");
        };
        if (gap > 0) wait(release, gap);
        else release();
        wait(() => {
          leaving.remove();
          cycle();
        }, swap + gap);
      }, ms("--think-hold", 2000));
    cycle();
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [states]);
  const longest = states.reduce((a, b) => (b.length > a.length ? b : a), "");
  return (
    <span className="t-think" ref={box} role="status" aria-live="polite">
      <span className="t-think-sizer" aria-hidden="true">
        {longest}
      </span>
      <span className="t-think-text" data-text={states[0]}>
        {states[0]}
      </span>
    </span>
  );
}

/**
 * transitions.dev 30, streaming text. The API answers in one piece, so the
 * words are revealed on a short interval to keep the reply feeling live.
 */
export function StreamingText({
  text,
  animate = true,
}: {
  text: string;
  animate?: boolean;
}) {
  const box = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const words = el.querySelectorAll<HTMLSpanElement>(".t-stream-w");
    if (!animate) {
      words.forEach((word) => word.classList.add("is-in"));
      return;
    }
    const gap = ms("--stream-gap", 60);
    const timers: ReturnType<typeof setTimeout>[] = [];
    words.forEach((word, i) => {
      word.classList.remove("is-in");
      timers.push(setTimeout(() => word.classList.add("is-in"), i * gap));
    });
    return () => timers.forEach(clearTimeout);
  }, [text, animate]);
  const words = text.split(/(\s+)/);
  return (
    <p className="t-stream" ref={box}>
      {words.map((word, i) =>
        /^\s+$/.test(word) ? (
          word
        ) : (
          <span className="t-stream-w" key={i}>
            {word}
          </span>
        ),
      )}
    </p>
  );
}
