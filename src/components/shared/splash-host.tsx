"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { AppSplash } from "@/components/shared/app-splash";

// One Zcore loader above everything (root layout). showSplash() starts it, e.g.
// right after a successful sign-in; it completes and wipes away once the
// route has changed (the app has rendered behind it).

type SplashState = { from: string; id: number } | null;

let state: SplashState = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showSplash(fromPath: string) {
  state = { from: fromPath, id: (state?.id ?? 0) + 1 };
  emit();
}

function hideSplash() {
  state = null;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function SplashHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
  const pathname = usePathname();
  if (!current) return null;
  return <AppSplash key={current.id} loaded={pathname !== current.from} onDone={hideSplash} />;
}
