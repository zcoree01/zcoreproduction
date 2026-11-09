import { LockIcon, TriangleAlertIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import type { BillingNotice } from "@/modules/platform/billing-notice";

/**
 * Strip above the content (management app and floor): the organization is
 * locked, or a payment is due soon / overdue (only shown to those who manage
 * the organization's settings; the database decides who gets which, D-049).
 */
export async function BillingNoticeBanner({
  notice,
  timezone,
}: {
  notice: BillingNotice;
  timezone: string;
}) {
  if (notice.state !== "locked" && notice.state !== "warning" && notice.state !== "overdue") {
    return null;
  }
  const [t, format] = await Promise.all([getTranslations("billingNotice"), getFormatter()]);
  // Noon UTC: the month and day stay the same in any organization timezone.
  const day = (value: string) => new Date(`${value}T12:00:00Z`);
  const month = notice.unpaidPeriod
    ? format.dateTime(day(notice.unpaidPeriod), {
        month: "long",
        year: "numeric",
        timeZone: timezone,
      })
    : "";
  // lockOn is the first locked day; the payment deadline is the day before.
  const date = notice.lockOn
    ? format.dateTime(new Date(day(notice.lockOn).getTime() - 86_400_000), {
        dateStyle: "long",
        timeZone: timezone,
      })
    : "";
  const locked = notice.state === "locked";
  const message = locked
    ? notice.reason === "unpaid"
      ? t("locked.unpaid", { month })
      : t("locked.manual")
    : notice.state === "warning"
      ? t("warning", { month, date })
      : t("overdue", { month });
  const Icon = locked ? LockIcon : TriangleAlertIcon;

  return (
    <div
      role={locked ? "alert" : "status"}
      data-testid="billing-notice"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm",
        locked
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/15",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", !locked && "text-amber-600 dark:text-amber-400")}
        aria-hidden
      />
      <span className="min-w-0 flex-1">{message}</span>
      {notice.contact ? (
        <span className="text-muted-foreground">{t("contact", { contact: notice.contact })}</span>
      ) : null}
    </div>
  );
}
