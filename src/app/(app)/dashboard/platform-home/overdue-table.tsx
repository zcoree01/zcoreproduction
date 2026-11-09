import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { BillingStateBadge } from "@/app/(app)/platform/billing-state-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKm, type PlatformHome } from "@/modules/platform/home";

export function OverdueTable({ rows }: { rows: PlatformHome["overdue"] }) {
  const t = useTranslations("platformHome.overdue");
  const format = useFormatter();
  const month = (period: string) =>
    format.dateTime(new Date(`${period}T12:00:00Z`), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const head = "py-2 pr-4 font-normal";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={head}>
                    {t("columns.firm")}
                  </th>
                  <th scope="col" className={head}>
                    {t("columns.package")}
                  </th>
                  <th scope="col" className={head}>
                    {t("columns.month")}
                  </th>
                  <th scope="col" className={`${head} text-right`}>
                    {t("columns.amount")}
                  </th>
                  <th scope="col" className={`${head} text-right`}>
                    {t("columns.days")}
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    {t("columns.state")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.organization_id}-${row.period}`} className="border-t">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/platform/organizations/${row.organization_id}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{row.package_name ?? t("noPackage")}</td>
                    <td className="py-2 pr-4">{month(row.period)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatKm(row.amount)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.days_late}</td>
                    <td className="py-2">
                      <BillingStateBadge state={row.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
