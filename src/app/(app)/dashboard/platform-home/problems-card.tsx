import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlatformHome } from "@/modules/platform/home";

/** "1.5" days -> "1,5"; null -> "—". */
function averageDays(value: string | null): string | null {
  if (value === null) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole},${trimmed}` : whole;
}

export function ProblemsCard({ problems }: { problems: PlatformHome["problems"] }) {
  const t = useTranslations("platformHome.problems");
  const average = averageDays(problems.avg_resolution_days);
  const items: { key: string; label: string; value: string }[] = [
    { key: "open", label: t("open"), value: String(problems.open) },
    { key: "resolved", label: t("resolvedThisMonth"), value: String(problems.resolved_this_month) },
    {
      key: "average",
      label: t("average"),
      value: average === null ? "—" : t("days", { days: average }),
    },
  ];
  return (
    <Card className="h-full" data-testid="problems-card">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-3">
          {items.map((item) => (
            <div key={item.key} className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
        <Link
          href="/platform/reports"
          className="text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("openAll")} →
        </Link>
      </CardContent>
    </Card>
  );
}
