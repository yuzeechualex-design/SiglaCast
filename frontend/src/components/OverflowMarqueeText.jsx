import { useLayoutEffect, useRef, useState } from "react";

/**
 * Horizontal scroll “marquee” when text overflows the container (listening line / status notes).
 */
export default function OverflowMarqueeText({ text, className = "", innerClassName = "" }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || !text) {
      setActive(false);
      return undefined;
    }

    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ow = outer.clientWidth;
        const iw = inner.scrollWidth;
        const need = iw > ow + 2;
        setActive(need);
        if (need) {
          const dist = ow - iw;
          outer.style.setProperty("--om-shift", `${dist}px`);
          /** ~42px/sec, clamp for very long titles */
          const sec = Math.max(10, Math.min(48, iw / 42));
          outer.style.setProperty("--om-dur", `${sec}s`);
        } else {
          outer.style.removeProperty("--om-shift");
          outer.style.removeProperty("--om-dur");
        }
      });
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(outer);
      ro.observe(inner);
    }
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [text]);

  return (
    <span
      ref={outerRef}
      className={`overflow-marquee ${active ? "overflow-marquee--active" : ""} ${className}`.trim()}
      title={text}
    >
      <span ref={innerRef} className={`overflow-marquee__inner ${innerClassName}`.trim()}>
        {text}
      </span>
    </span>
  );
}
