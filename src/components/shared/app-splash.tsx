"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ZcoreMark } from "@/components/shared/zcore-logo";

/** Shortest time on screen, so the mark is fully assembled (as on the website). */
export const SPLASH_MIN_MS = 1600;

/**
 * The loader of www.zcore.ba: grid, the Zcore mark assembling, "ZCORE
 * PRODUCTION", a thin bar and a 000–100 counter; it wipes up when done.
 * Without `loaded` the bar creeps towards 90 % (the app is still loading);
 * with `loaded` it completes after SPLASH_MIN_MS and calls `onDone` after
 * the wipe. Styles: `.zsplash*` in globals.css (prefers-reduced-motion aware).
 */
export function AppSplash({ loaded = false, onDone }: { loaded?: boolean; onDone?: () => void }) {
  const t = useTranslations("common");
  const bar = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const loadedRef = useRef(loaded);
  const onDoneRef = useRef(onDone);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    loadedRef.current = loaded;
    onDoneRef.current = onDone;
  }, [loaded, onDone]);

  // Progress like the website: time-based, eased, capped at 90 % until loaded.
  useEffect(() => {
    const start = performance.now();
    let last = start;
    let shown = 0;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / SPLASH_MIN_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const target = loadedRef.current ? eased : Math.min(eased, 0.9);
      const dt = Math.min(100, now - last);
      last = now;
      shown += (target - shown) * Math.min(1, dt / 80);
      if (loadedRef.current && progress >= 1 && shown > 0.995) shown = 1;
      if (bar.current) bar.current.style.transform = `scaleX(${shown})`;
      if (count.current)
        count.current.textContent = String(Math.round(shown * 100)).padStart(3, "0");
      if (shown < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      // Without motion there is no wipe (and no animationend): done at once.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onDoneRef.current?.();
      else setWiping(true);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role="status"
      aria-label={t("loading")}
      className="zsplash"
      data-done={wiping || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && wiping) onDone?.();
      }}
    >
      <div className="zsplash__grid" aria-hidden />
      <div className="zsplash__inner" aria-hidden>
        <ZcoreMark className="zsplash__mark" />
        <div className="zsplash__word">ZCORE PRODUCTION</div>
        <div className="zsplash__bar">
          <span ref={bar} />
        </div>
        <div className="zsplash__meta">
          <span>{t("loadingCaps")}</span>
          <span ref={count}>000</span>
        </div>
      </div>
    </div>
  );
}
