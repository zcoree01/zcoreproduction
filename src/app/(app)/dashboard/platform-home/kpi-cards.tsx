import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  Building2Icon,
  ClockIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  firmTrend,
  formatKm,
  overdueLockedCount,
  revenueProgress,
  type PlatformHome,
} from "@/modules/platform/home";

function Kpi({
  icon,
  label,
  value,
  tone,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: "danger";
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
          {icon}
          <span>{label}</span>
        </div>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "danger" && "text-destructive",
          )}
        >
          {value}
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ data, showRevenue }: { data: PlatformHome; showRevenue: boolean }) {
  const t = useTranslations("platformHome.kpi");
  const revenue = showRevenue ? data.revenue : null;
  const trend = firmTrend(data.firms.using, data.firms.using_last_month);
  const TrendIcon =
    trend.direction === "up"
      ? ArrowUpIcon
      : trend.direction === "down"
        ? ArrowDownIcon
        : ArrowRightIcon;
  const progress = revenue ? revenueProgress(revenue.paid, revenue.expected) : 0;

  return (
    <div
      className={cn("grid gap-4 sm:grid-cols-2", revenue ? "xl:grid-cols-4" : "xl:grid-cols-3")}
      data-testid="kpi-cards"
    >
      {revenue ? (
        <Kpi icon={<WalletIcon />} label={t("revenue")} value={formatKm(revenue.paid)}>
          <span>{t("revenueOf", { expected: formatKm(revenue.expected) })}</span>
          <div
            role="progressbar"
            aria-label={t("revenue")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1.5 rounded-full bg-muted"
          >
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </Kpi>
      ) : null}
      <Kpi icon={<Building2Icon />} label={t("using")} value={data.firms.using}>
        <span className="flex items-center gap-1">
          <TrendIcon className="size-3.5" aria-hidden />
          {t(`usingTrend.${trend.direction}`, { delta: Math.abs(trend.delta) })}
        </span>
        <span>{t("trial", { count: data.firms.trial })}</span>
      </Kpi>
      <Kpi icon={<UsersIcon />} label={t("users")} value={data.users}>
        <span>{t("usersHint")}</span>
        <span>{t("usersActive", { count: data.usage.active_7d })}</span>
      </Kpi>
      <Kpi
        icon={<ClockIcon />}
        label={t("late")}
        value={data.overdue.length}
        tone={data.overdue.length > 0 ? "danger" : undefined}
      >
        {revenue ? (
          <span>{t("lateTotal", { amount: formatKm(revenue.overdue_total) })}</span>
        ) : null}
        <span>{t("lateLocked", { count: overdueLockedCount(data.overdue) })}</span>
      </Kpi>
    </div>
  );
}
