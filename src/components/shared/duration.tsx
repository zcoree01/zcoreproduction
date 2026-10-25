import { useTranslations } from "next-intl";
import { splitDuration } from "@/modules/products/rules";

/** Seconds as "3 h 25 min" (seconds only below one minute). */
export function Duration({ seconds, className }: { seconds: string; className?: string }) {
  const t = useTranslations("duration");
  const { hours, minutes, seconds: secs } = splitDuration(seconds);
  const text =
    hours > 0
      ? t("hoursMinutes", { hours, minutes })
      : minutes > 0
        ? t("minutes", { minutes })
        : t("seconds", { seconds: secs });
  return <span className={className ? `tabular-nums ${className}` : "tabular-nums"}>{text}</span>;
}
