import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { compareDecimals, divideDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { seriesMax } from "@/modules/dashboard/stats";
import { formatKm, type PlatformHome } from "@/modules/platform/home";

type Revenue = NonNullable<PlatformHome["revenue"]>;

// Fixed plot: bars are HTML so labels stay text-xs at every width.
const PLOT_PX = 130;

export function RevenueChart({
  revenue,
  currentPeriod,
}: {
  revenue: Revenue;
  /** First day of the current month in the platform timezone, 'YYYY-MM-01'. */
  currentPeriod: string;
}) {
  const t = useTranslations("platformHome.revenueChart");
  const format = useFormatter();
  const months = [...revenue.by_month].sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  const max = seriesMax(months.map((m) => m.paid));
  // Periods are calendar dates already in the platform timezone: format them as UTC noon.
  const monthLabel = (period: string, style: "short" | "long") =>
    format.dateTime(
      new Date(`${period}T12:00:00Z`),
      style === "long"
        ? { month: "long", year: "numeric", timeZone: "UTC" }
        : { month: "short", timeZone: "UTC" },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div role="img" aria-label={t("alt")} className="min-w-[640px]">
            <div className="flex items-end gap-2 border-b" style={{ height: PLOT_PX + 20 }}>
              {months.map((m) => {
                const positive = compareDecimals(m.paid, "0") > 0;
                const ratio = positive ? Number(divideDecimal(m.paid, max, 4)) : 0;
                const height = positive ? Math.max(Math.round(ratio * PLOT_PX), 2) : 0;
                return (
                  <div
                    key={m.period}
                    title={`${monthLabel(m.period, "long")}: ${formatKm(m.paid)}`}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  >
                    {positive ? (
                      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatKm(m.paid)}
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        "w-full max-w-8 rounded-t-md",
                        m.period === currentPeriod ? "bg-primary" : "bg-muted-foreground/35",
                      )}
                      style={{ height }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-2">
              {months.map((m) => (
                <span
                  key={m.period}
                  className={cn(
                    "min-w-0 flex-1 text-center text-xs text-muted-foreground",
                    m.period === currentPeriod && "font-medium text-foreground",
                  )}
                >
                  {monthLabel(m.period, "short")}
                </span>
              ))}
            </div>
          </div>
        </div>
        <table className="sr-only">
          <caption>{t("alt")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("month")}</th>
              <th scope="col">{t("paid")}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.period}>
                <th scope="row">{monthLabel(m.period, "long")}</th>
                <td>{formatKm(m.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
