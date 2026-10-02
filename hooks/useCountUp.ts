"use client";

import { useEffect, useRef, useState } from "react";

/** Eases the displayed number toward `target` (from 0 on first render). */
export function useCountUp(target: number, ms = 1100): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const cur = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = cur;
      setValue(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
