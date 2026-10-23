import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: "text-muted-foreground", dot: "bg-muted-foreground/60" },
  info: { badge: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  success: { badge: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  warning: { badge: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  danger: { badge: "text-red-700 dark:text-red-300", dot: "bg-red-500" },
};

// Status pill with a colored dot: color is never the only signal (label is required).
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const styles = TONES[tone];
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn("gap-1.5 font-normal", styles.badge, className)}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", styles.dot)} />
      {children}
    </Badge>
  );
}
