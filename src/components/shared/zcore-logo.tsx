import { useId } from "react";
import { cn } from "@/lib/utils";

// Zcore brand from the website: "Z" mark and "Zcore" wordmark with the
// cyan → blue gradient (#35e0ff → #4f7bff). Same mark as src/app/icon.svg.

export function ZcoreMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" className={cn("size-10", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35e0ff" />
          <stop offset="1" stopColor="#4f7bff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#05070c" />
      <path
        d="M18 18h28L18 46h28"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="8"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function ZcoreWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-3xl font-extrabold tracking-tight", className)}>
      Z
      <span className="bg-linear-to-r from-[#35e0ff] to-[#4f7bff] bg-clip-text text-transparent">
        core
      </span>
    </span>
  );
}
