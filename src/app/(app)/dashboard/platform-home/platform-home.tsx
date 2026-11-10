import { getTranslations } from "next-intl/server";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import type { PlatformHome as PlatformHomeData } from "@/modules/platform/home";
import { getPlatformHome } from "@/modules/platform/home-queries";
import { FirmStates } from "./firm-states";
import { KpiCards } from "./kpi-cards";
import { OverdueTable } from "./overdue-table";
import { ProblemsCard } from "./problems-card";
import { RevenueChart } from "./revenue-chart";
import { TodoTiles } from "./todo-tiles";
import { UsageChart } from "./usage-chart";

/** Zcore home: numbers across all firms. Revenue only with platform.revenue.read. */
export async function PlatformHome({
  canSeeRevenue,
  organizationName,
}: {
  canSeeRevenue: boolean;
  organizationName: string;
}) {
  const t = await getTranslations("platformHome");
  let data: PlatformHomeData;
  try {
    data = await getPlatformHome();
  } catch (error) {
    console.error(error);
    return <ErrorState title={t("errorTitle")} />;
  }
  const revenue = canSeeRevenue ? data.revenue : null;

  return (
    <>
      <PageHeader title={t("title")} description={`${organizationName} · ${t("description")}`} />
      <div className="flex flex-col gap-4">
        <KpiCards data={data} showRevenue={canSeeRevenue} />
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <TodoTiles todo={data.todo} />
          </div>
          <div className="xl:col-span-5">
            <FirmStates firms={data.firms} />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <UsageChart usage={data.usage} />
          </div>
          <div className="xl:col-span-4">
            <ProblemsCard problems={data.problems} />
          </div>
        </div>
        {revenue ? (
          <RevenueChart revenue={revenue} currentPeriod={`${data.today.slice(0, 7)}-01`} />
        ) : null}
        <OverdueTable rows={data.overdue} />
      </div>
    </>
  );
}
