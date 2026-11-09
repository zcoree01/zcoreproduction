import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { compareDecimals, divideDecimal } from "@/lib/decimal";
import { seriesMax } from "@/modules/dashboard/stats";
import { formatKm, type PlatformHome } from "@/modules/platform/home";

type Revenue = NonNullable<PlatformHome["revenue"]>;

const W = 600;
const H = 160;
const LABEL_H = 22;
const SLOT = W / 12;
const BAR = 24;

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
        <svg
          viewBox={`0 0 ${W} ${H + LABEL_H}`}
          role="img"
          aria-label={t("alt")}
          className="h-auto w-full text-muted-foreground"
        >
          <line x1="0" x2={W} y1={H} y2={H} className="stroke-border" strokeWidth="1" />
          {months.map((m, i) => {
            const ratio = compareDecimals(max, "0") > 0 ? Number(divideDecimal(m.paid, max, 4)) : 0;
            const height = Math.max(ratio * (H - 12), ratio > 0 ? 2 : 0);
            const x = i * SLOT + (SLOT - BAR) / 2;
            const current = m.period === currentPeriod;
            return (
              <g key={m.period}>
                <rect
                  x={x}
                  y={H - height}
                  width={BAR}
                  height={height}
                  rx="3"
                  className={current ? "fill-primary/50" : "fill-primary"}
                >
                  <title>{`${monthLabel(m.period, "long")}: ${formatKm(m.paid)}`}</title>
                </rect>
                <text
                  x={i * SLOT + SLOT / 2}
                  y={H + 15}
                  textAnchor="middle"
                  fontSize="11"
                  className="fill-current"
                >
                  {monthLabel(m.period, "short")}
                </text>
              </g>
            );
          })}
        </svg>
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
