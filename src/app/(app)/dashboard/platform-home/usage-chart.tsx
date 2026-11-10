import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PlatformHome } from "@/modules/platform/home";

type Usage = PlatformHome["usage"];

// Same plot as the revenue chart: bars are HTML so labels stay text-xs at every width.
const PLOT_PX = 130;
const PHONE_DAYS = 14;

export function UsageChart({ usage }: { usage: Usage }) {
  const t = useTranslations("platformHome.usageChart");
  const format = useFormatter();
  const days = [...usage.by_day].sort((a, b) => a.day.localeCompare(b.day));
  const max = Math.max(1, ...days.map((d) => d.users));
  const peak = days.findIndex((d) => d.users === max && max > 0);
  // Days are calendar dates already in the platform timezone: format them as UTC noon.
  const dayLabel = (day: string, style: "short" | "long") =>
    format.dateTime(
      new Date(`${day}T12:00:00Z`),
      style === "long"
        ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
        : { day: "numeric", month: "numeric", timeZone: "UTC" },
    );

  return (
    <Card data-testid="usage-card">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div role="img" aria-label={t("alt")} className="w-full">
          <div className="flex items-end gap-1 border-b" style={{ height: PLOT_PX + 20 }}>
            {days.map((d, index) => {
              const last = index === days.length - 1;
              const height = d.users > 0 ? Math.max(Math.round((d.users / max) * PLOT_PX), 2) : 0;
              return (
                <div
                  key={d.day}
                  title={`${dayLabel(d.day, "long")}: ${d.users}`}
                  className={cn(
                    "min-w-0 flex-1 flex-col items-center justify-end gap-1",
                    // Phones show the last 14 days; sm and up show all 30.
                    index < days.length - PHONE_DAYS ? "hidden sm:flex" : "flex",
                  )}
                >
                  {d.users > 0 && (index === peak || last) ? (
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {d.users}
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      "w-full max-w-5 rounded-t-md",
                      last ? "bg-primary" : "bg-muted-foreground/35",
                    )}
                    style={{ height }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-1">
            {days.map((d, index) => {
              const fromEnd = days.length - 1 - index;
              return (
                <span
                  key={d.day}
                  className={cn(
                    "min-w-0 flex-1 text-center text-xs whitespace-nowrap text-muted-foreground",
                    index < days.length - PHONE_DAYS && "hidden sm:block",
                    fromEnd === 0 && "font-medium text-foreground",
                  )}
                >
                  {fromEnd % 7 === 0 ? dayLabel(d.day, "short") : ""}
                </span>
              );
            })}
          </div>
        </div>
        <table className="sr-only">
          <caption>{t("alt")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("day")}</th>
              <th scope="col">{t("users")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <th scope="row">{dayLabel(d.day, "long")}</th>
                <td>{d.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
