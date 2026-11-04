import { ZcoreMark, ZcoreWordmark } from "@/components/shared/zcore-logo";
import { cn } from "@/lib/utils";

/**
 * Full-screen loading screen with the Zcore brand, shown after signing in
 * and while the app shell loads (like the website). Dark like the website in
 * both themes; the animation respects prefers-reduced-motion.
 */
export function AppSplash({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-[#05070c] text-[#eef2f8]",
        className,
      )}
    >
      <div className="relative">
        <span
          aria-hidden
          className="absolute inset-0 rounded-2xl bg-[#35e0ff]/30 blur-xl motion-safe:animate-pulse"
        />
        <ZcoreMark className="relative size-16" />
      </div>
      <ZcoreWordmark className="text-[#eef2f8]" />
      <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="splash-bar h-full w-1/3 rounded-full bg-linear-to-r from-[#35e0ff] to-[#4f7bff]" />
      </div>
      <span className="text-sm text-[#8d9bb2]">{label}</span>
    </div>
  );
}
