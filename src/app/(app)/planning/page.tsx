import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { zonedDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { addDays, mondayOf } from "@/modules/attendance/schedule-rules";
import { buildBoard } from "@/modules/planning/board";
import { getPlanningData } from "@/modules/planning/queries";
import { basisSchema } from "@/modules/planning/schemas";
import { DowntimeButton } from "./downtime-sheet";
import { PlanningBoard } from "./planning-board";

// Production planning by days (D-041): machines × two weeks, operations
// not planned yet, operator load and overloaded days. orders.read to see,
// orders.manage to change.

const DAYS = 14;
/** Work going on after the last column still counts for forecasts. */
const LOOKAHEAD_DAYS = 180;

export default function PlanningPage({ searchParams }: PageProps<"/planning">) {
  return (
    <PageSuspense>
      <PlanningContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function PlanningContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("planning"), getMemberAccess(member)]);
  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("orders.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const params = await searchParams;
  const today = zonedDate(new Date(), member.organization.timezone);
  const from = mondayOf(
    z.iso
      .date()
      .catch(today)
      .parse(firstParam(params.from) ?? today),
  );
  const basis = basisSchema.catch("planned").parse(firstParam(params.basis) ?? "planned");
  const data = await getPlanningData(organizationId, from, addDays(from, DAYS + LOOKAHEAD_DAYS));
  const board = buildBoard(data, { from, days: DAYS, today, basis });
  const canManage = access.permissions.has("orders.manage");
  const canManageDowntime = canManage || access.permissions.has("machines.manage");

  const href = (next: { from?: string; basis?: string }) => {
    const query = new URLSearchParams({ from: next.from ?? from, basis: next.basis ?? basis });
    return `/planning?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManageDowntime && board.machines.length > 0 ? (
            <DowntimeButton
              machines={board.machines.map((m) => ({ id: m.id, label: `${m.code} · ${m.name}` }))}
              reasons={board.reasons}
              today={today}
            />
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href({ from: addDays(from, -DAYS) })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={t("previous")}
        >
          <ChevronLeftIcon />
        </Link>
        <Link
          href={href({ from: mondayOf(today) })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t("today")}
        </Link>
        <Link
          href={href({ from: addDays(from, DAYS) })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={t("next")}
        >
          <ChevronRightIcon />
        </Link>
        <div className="ml-auto flex items-center gap-1 text-sm" title={t("basis.hint")}>
          <span className="text-muted-foreground">{t("basis.label")}</span>
          {(["planned", "actual"] as const).map((value) => (
            <Link
              key={value}
              href={href({ basis: value })}
              aria-current={value === basis ? "true" : undefined}
              className={cn(
                buttonVariants({ variant: value === basis ? "secondary" : "ghost", size: "sm" }),
              )}
            >
              {t(`basis.${value}`)}
            </Link>
          ))}
        </div>
      </div>
      <PlanningBoard
        board={board}
        employees={data.employees.map((e) => ({
          id: e.id,
          name: e.name,
          machineIds: e.machineIds,
        }))}
        canManage={canManage}
        canManageDowntime={canManageDowntime}
      />
    </div>
  );
}
